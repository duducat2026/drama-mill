/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
 * Copyright (C) 2026 Drama Mill <52859273@qq.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Hono } from 'hono'
import { db, schema } from '../../db/index.js'
import { badRequest, success } from '../../utils/response.js'
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import { pageOf, tooDeep } from './shared.js'
import { cachedTotal, countKey } from './count-cache.js'

const app = new Hono()

// ─── 2. 资产管理 ───

// GET /admin/assets?user_id=&drama_id=&drama_keyword=&type=&keyword=&page= — 预览复用 /static
// assets 表为历史遗留死表（全代码库无写入点）：真实资产落在 characters/scenes/props/storyboards，
// 本接口按类型把各源查询组成 UNION ALL，排序/计数/分页全部在 SQL 层完成（不做内存合并切页）
const kwCond = (col: any, keyword: string) => sql`LOWER(${col}) LIKE ${`%${keyword}%`}`
const alive = (t: any) => isNull(t.deletedAt)
const hasUrl = (col: any) => and(sql`${col} IS NOT NULL`, sql`${col} <> ''`)

// 统一投影别名：各源列名不同（image_url/composed_image/video_url），必须 AS 对齐才能进 UNION
const proj = (id: any, name: any, url: any, typeLit: string, category: any, dramaId: any, createdAt: any) => ({
  id: sql`${id}`.as('id'),
  name: sql`${name}`.as('name'),
  url: sql`${url}`.as('url'),
  type: sql`${typeLit}`.as('type'),
  category: sql`${category}`.as('category'),
  drama_id: sql`${dramaId}`.as('drama_id'),
  created_at: sql`${createdAt}`.as('created_at'),
})

app.get('/assets', async (c) => {
  const { page, pageSize } = pageOf(c)
  if (tooDeep(page, pageSize)) return badRequest(c, '翻页过深，请用项目/类型/关键词过滤后查询')
  const userId = Number(c.req.query('user_id')) || undefined
  const dramaId = Number(c.req.query('drama_id')) || undefined
  const type = c.req.query('type')
  const keyword = (c.req.query('keyword') || '').trim().toLowerCase()
  const dramaKeyword = (c.req.query('drama_keyword') || '').trim().toLowerCase()

  // 用户过滤经项目归属解析（资产表无 user_id 列）；无归属项目直接返回空，避免全表扫描
  let dramaScope: number[] | null = null
  if (userId) {
    const owned = await db.select({ id: schema.dramas.id }).from(schema.dramas)
      .where(and(eq(schema.dramas.userId, userId), isNull(schema.dramas.deletedAt)))
    dramaScope = owned.map(d => d.id)
    if (!dramaScope.length) return success(c, { total: 0, page, page_size: pageSize, items: [] })
  }
  // 项目名称检索：按标题模糊匹配出项目集，与用户作用域取交集
  if (dramaKeyword) {
    const matched = await db.select({ id: schema.dramas.id }).from(schema.dramas)
      .where(and(isNull(schema.dramas.deletedAt), sql`LOWER(${schema.dramas.title}) LIKE ${`%${dramaKeyword}%`}`))
    const ids = matched.map(d => d.id)
    dramaScope = dramaScope ? dramaScope.filter(id => ids.includes(id)) : ids
    if (!dramaScope.length) return success(c, { total: 0, page, page_size: pageSize, items: [] })
  }
  if (dramaId) dramaScope = dramaScope ? dramaScope.filter(id => id === dramaId) : [dramaId]
  if (dramaScope && !dramaScope.length) return success(c, { total: 0, page, page_size: pageSize, items: [] })

  const scopeCond = (col: any) => dramaScope ? inArray(col, dramaScope) : undefined
  const kw = (col: any) => keyword ? kwCond(col, keyword) : undefined
  type SourceDef = { query: any; countQuery: () => Promise<{ c: number }[]> }
  const defs: SourceDef[] = []

  // 角色/场景/道具：三表结构同构（drama_id + name + image_url），各成一个 UNION 分支
  const simpleSource = (table: any, nameCol: any, catCol: any, typeLit: string): SourceDef => {
    const where = and(alive(table), hasUrl(table.imageUrl), scopeCond(table.dramaId), kw(nameCol))
    return {
      query: db.select(proj(table.id, nameCol, table.imageUrl, typeLit, catCol, table.dramaId, table.createdAt)).from(table).where(where),
      countQuery: () => db.select({ c: count() }).from(table).where(where),
    }
  }
  if (!type || type === 'character') defs.push(simpleSource(schema.characters, schema.characters.name, schema.characters.role, 'character'))
  if (!type || type === 'scene') defs.push(simpleSource(schema.scenes, schema.scenes.location, schema.scenes.time, 'scene'))
  if (!type || type === 'prop') defs.push(simpleSource(schema.props, schema.props.name, schema.props.type, 'prop'))

  // 分镜图/视频：分镜表无 drama_id，经 episodes 关联；image/video 两个分支各带非空 URL 条件
  const sbSource = (urlCol: any, typeLit: string): SourceDef => {
    const where = and(alive(schema.storyboards), hasUrl(urlCol), scopeCond(schema.episodes.dramaId), kw(schema.storyboards.title))
    return {
      query: db.select(proj(schema.storyboards.id, schema.storyboards.title, urlCol, typeLit, schema.storyboards.shotType, schema.episodes.dramaId, schema.storyboards.createdAt))
        .from(schema.storyboards).innerJoin(schema.episodes, eq(schema.storyboards.episodeId, schema.episodes.id)).where(where),
      countQuery: () => db.select({ c: count() }).from(schema.storyboards).innerJoin(schema.episodes, eq(schema.storyboards.episodeId, schema.episodes.id)).where(where),
    }
  }
  if (!type || type === 'storyboard' || type === 'image') defs.push(sbSource(schema.storyboards.composedImage, 'image'))
  if (!type || type === 'video') defs.push(sbSource(schema.storyboards.videoUrl, 'video'))
  if (!defs.length) return success(c, { total: 0, page, page_size: pageSize, items: [] })

  // UNION ALL + 尾部 ORDER BY/LIMIT：整库排序分页交给 MySQL（created_at/id 为 UNION 别名）
  let unioned: any = defs[0].query
  for (let i = 1; i < defs.length; i++) unioned = unioned.unionAll(defs[i].query)
  const [rows, total] = await Promise.all([
    unioned.orderBy(sql`created_at DESC, id DESC`).limit(pageSize).offset((page - 1) * pageSize),
    // 总数 = 各分支 COUNT 之和，按过滤条件缓存 60s，翻页不重复计数
    cachedTotal(countKey('admin:assets', userId, dramaId, type, keyword, dramaKeyword), async () => {
      const counts = await Promise.all(defs.map(d => d.countQuery()))
      return counts.reduce((sum, r) => sum + Number(r[0]?.c || 0), 0)
    }),
  ])

  // 用户名/项目名只对当页涉及的少量行点查，不再全表 userMap/dramaMap
  const pageDramaIds: number[] = [...new Set((rows as any[]).map(r => r.drama_id).filter((v): v is number => !!v))]
  const ownerRows = pageDramaIds.length
    ? await db.select({ id: schema.dramas.id, userId: schema.dramas.userId, title: schema.dramas.title })
        .from(schema.dramas).where(inArray(schema.dramas.id, pageDramaIds))
    : []
  const dramas = new Map(ownerRows.map(d => [d.id, { title: d.title, userId: d.userId }]))
  const ownerIds = [...new Set(ownerRows.map(d => d.userId).filter((v): v is number => !!v))]
  const userRows = ownerIds.length
    ? await db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users)
        .where(inArray(schema.users.id, ownerIds))
    : []
  const users = new Map(userRows.map(u => [u.id, { username: u.username }]))
  return success(c, {
    total,
    page,
    page_size: pageSize,
    items: rows.map((r: any) => {
      const ownerId = r.drama_id ? dramas.get(r.drama_id)?.userId : undefined
      return {
        ...r,
        user_id: null,
        username: ownerId ? users.get(ownerId)?.username ?? null : null,
        drama_title: r.drama_id ? dramas.get(r.drama_id)?.title ?? null : null,
      }
    }),
  })
})


export default app
