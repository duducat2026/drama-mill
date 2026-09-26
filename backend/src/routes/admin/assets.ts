/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/your-org/drama-mill)
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
import { success } from '../../utils/response.js'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { pageOf, paged, userMap, dramaMap } from './shared.js'

const app = new Hono()

// ─── 2. 资产管理 ───

// GET /admin/assets?user_id=&drama_id=&drama_keyword=&type=&keyword=&page= — 预览复用 /static
// assets 表为历史遗留死表（全代码库无写入点）：真实资产落在 characters/scenes/props/storyboards，
// 本接口按类型聚合四张表；过滤条件全部下推 SQL，各源限量拉取后内存合并分页（不做全表加载）
const ADMIN_ASSET_SOURCE_LIMIT = 2000

app.get('/assets', async (c) => {
  const { page, pageSize } = pageOf(c)
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

  const kwCond = (col: any) => keyword ? sql`LOWER(${col}) LIKE ${`%${keyword}%`}` : undefined
  const alive = (t: any) => isNull(t.deletedAt)
  const hasUrl = (col: any) => and(sql`${col} IS NOT NULL`, sql`${col} <> ''`)
  type AssetRow = { id: number; url: string | null; name: string | null; type: string; category: string | null; drama_id: number | null; user_id: number | null; created_at: string }
  const rows: AssetRow[] = []

  // 角色/场景/道具：三表结构同构（drama_id + name + image_url），各自带条件限量拉取
  if (!type || type === 'character') {
    const list = await db.select({
      id: schema.characters.id, name: schema.characters.name, url: schema.characters.imageUrl,
      category: schema.characters.role, dramaId: schema.characters.dramaId, createdAt: schema.characters.createdAt,
    }).from(schema.characters)
      .where(and(alive(schema.characters), hasUrl(schema.characters.imageUrl),
        dramaScope ? inArray(schema.characters.dramaId, dramaScope) : undefined, kwCond(schema.characters.name)))
      .orderBy(sql`${schema.characters.createdAt} DESC`).limit(ADMIN_ASSET_SOURCE_LIMIT)
    rows.push(...list.map(r => ({ id: r.id, url: r.url, name: r.name, type: 'character', category: r.category, drama_id: r.dramaId, user_id: null, created_at: r.createdAt })))
  }
  if (!type || type === 'scene') {
    const list = await db.select({
      id: schema.scenes.id, name: schema.scenes.location, url: schema.scenes.imageUrl,
      category: schema.scenes.time, dramaId: schema.scenes.dramaId, createdAt: schema.scenes.createdAt,
    }).from(schema.scenes)
      .where(and(alive(schema.scenes), hasUrl(schema.scenes.imageUrl),
        dramaScope ? inArray(schema.scenes.dramaId, dramaScope) : undefined, kwCond(schema.scenes.location)))
      .orderBy(sql`${schema.scenes.createdAt} DESC`).limit(ADMIN_ASSET_SOURCE_LIMIT)
    rows.push(...list.map(r => ({ id: r.id, url: r.url, name: r.name, type: 'scene', category: r.category, drama_id: r.dramaId, user_id: null, created_at: r.createdAt })))
  }
  if (!type || type === 'prop') {
    const list = await db.select({
      id: schema.props.id, name: schema.props.name, url: schema.props.imageUrl,
      category: schema.props.type, dramaId: schema.props.dramaId, createdAt: schema.props.createdAt,
    }).from(schema.props)
      .where(and(alive(schema.props), hasUrl(schema.props.imageUrl),
        dramaScope ? inArray(schema.props.dramaId, dramaScope) : undefined, kwCond(schema.props.name)))
      .orderBy(sql`${schema.props.createdAt} DESC`).limit(ADMIN_ASSET_SOURCE_LIMIT)
    rows.push(...list.map(r => ({ id: r.id, url: r.url, name: r.name, type: 'prop', category: r.category, drama_id: r.dramaId, user_id: null, created_at: r.createdAt })))
  }
  // 分镜图/视频：分镜表无 drama_id，经 episodes 关联；无 user_id 列，同样经项目归属反查（按需）
  if (!type || type === 'storyboard' || type === 'image' || type === 'video') {
    const sbBase = db.select({
      id: schema.storyboards.id, title: schema.storyboards.title,
      image: schema.storyboards.composedImage, video: schema.storyboards.videoUrl,
      category: schema.storyboards.shotType, dramaId: schema.episodes.dramaId, createdAt: schema.storyboards.createdAt,
    }).from(schema.storyboards)
      .innerJoin(schema.episodes, eq(schema.storyboards.episodeId, schema.episodes.id))
      .where(and(alive(schema.storyboards), dramaScope ? inArray(schema.episodes.dramaId, dramaScope) : undefined, kwCond(schema.storyboards.title)))
      .orderBy(sql`${schema.storyboards.createdAt} DESC`).limit(ADMIN_ASSET_SOURCE_LIMIT)
    const list = await sbBase
    if (!type || type === 'storyboard' || type === 'image') {
      rows.push(...list.filter(r => r.image).map(r => ({ id: r.id, url: r.image, name: r.title, type: 'image', category: r.category, drama_id: r.dramaId, user_id: null, created_at: r.createdAt })))
    }
    if (!type || type === 'video') {
      rows.push(...list.filter(r => r.video).map(r => ({ id: r.id, url: r.video, name: r.title, type: 'video', category: r.category, drama_id: r.dramaId, user_id: null, created_at: r.createdAt })))
    }
  }

  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  const users = await userMap()
  const dramas = await dramaMap()
  // 用户名：经项目归属反查（每页仅涉及少量项目，按需点查）
  const dramaOwners = new Map<number, number>()
  if (rows.length) {
    const ownerRows = await db.select({ id: schema.dramas.id, userId: schema.dramas.userId }).from(schema.dramas)
      .where(inArray(schema.dramas.id, [...new Set(rows.map(r => r.drama_id).filter((v): v is number => !!v))]))
    for (const d of ownerRows) if (d.userId) dramaOwners.set(d.id, d.userId)
  }
  const result = paged(rows, page, pageSize)
  return success(c, {
    ...result,
    items: result.items.map(a => {
      const ownerId = a.drama_id ? dramaOwners.get(a.drama_id) : undefined
      return { ...a, username: ownerId ? users.get(ownerId)?.username ?? null : null, drama_title: a.drama_id ? dramas.get(a.drama_id)?.title ?? null : null }
    }),
  })
})


export default app
