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

/**
 * 项目门面路由（挂载于 /dramas）：列表 / 建档 / 状态统计 / 详情 / 修改 / 软删
 * 素材与批量端点在 dramas-assets.ts，共享助手在 dramas-shared.ts；
 * 三者合并注册，assets 子路由须先于 /:id 通配注册（Hono 按注册顺序匹配）
 */
import { Hono } from 'hono'
import { and, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { created, now, success } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { getDramaOwned } from '../services/ownership.js'
import { countByDrama, normalizeMetadata } from './dramas-shared.js'

const app = new Hono()

// POST /dramas — 创建剧集项目：只写项目行，不预建分集
// （集由用户在向导里显式添加，添加时会锁定该集的图片/视频生成配置）
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const stamp = now()

  const inserted = await db.insert(schema.dramas).values({
    title: body.title,
    description: body.description,
    genre: body.genre,
    style: body.style,
    aspectRatio: body.aspect_ratio || '16:9',
    tags: body.tags ? JSON.stringify(body.tags) : null,
    metadata: normalizeMetadata(body.metadata),
    status: 'draft',
    userId: user.id,
    createdAt: stamp,
    updatedAt: stamp,
  })
  const newId = Number((inserted as any)[0]?.insertId ?? (inserted as any).insertId)

  const [row] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, newId))
  return created(c, toSnakeCase(row))
})

// GET /dramas — 当前用户的项目分页列表
// 过滤条件全部下推 SQL：未删 + 属主为基底，status 支持逗号多值
// （active,producing：手动标记与生产编排自动写入的状态合并筛选），keyword 走标题模糊
app.get('/', async (c) => {
  const user = c.get('user')
  const statusParam = c.req.query('status')
  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('page_size') || 20)

  const conds: any[] = [isNull(schema.dramas.deletedAt), eq(schema.dramas.userId, user.id)]
  if (statusParam) {
    const values = String(statusParam).split(',').map(s => s.trim()).filter(Boolean)
    conds.push(values.length > 1 ? inArray(schema.dramas.status, values) : eq(schema.dramas.status, values[0]))
  }
  const keyword = c.req.query('keyword')
  if (keyword) conds.push(like(schema.dramas.title, `%${keyword}%`))
  const where = and(...conds)

  const [{ value: total }] = await db
    .select({ value: sql<number>`COUNT(*)` })
    .from(schema.dramas)
    .where(where)
  const items = await db
    .select()
    .from(schema.dramas)
    .where(where)
    .orderBy(desc(schema.dramas.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  // 当页项目一次聚合三张子表计数（3 条 COUNT GROUP BY 取代逐项 3N 次查询）
  // chars/scenes 不过滤 deleted_at，沿用旧版逐项查询的口径
  const dramaIds = items.map(d => d.id)
  const [epAgg, charAgg, sceneAgg] = await Promise.all([
    countByDrama(schema.episodes, dramaIds, true),
    countByDrama(schema.characters, dramaIds, false),
    countByDrama(schema.scenes, dramaIds, false),
  ])

  const list = items.map(drama => ({
    ...toSnakeCase(drama),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    total_episodes: epAgg.get(drama.id) || 0,
    episode_count: epAgg.get(drama.id) || 0,
    character_count: charAgg.get(drama.id) || 0,
    scene_count: sceneAgg.get(drama.id) || 0,
  }))

  return success(c, {
    items: list,
    pagination: {
      page,
      page_size: pageSize,
      total: Number(total),
      total_pages: Math.ceil(Number(total) / pageSize)
    },
  })
})

// GET /dramas/stats — 状态分组统计（必须先于 /:id 注册）
// GROUP BY 下推，一次拿齐分组计数与总数，不再拉全表回 Node 统计
app.get('/stats', async (c) => {
  const user = c.get('user')
  const rows = await db
    .select({ status: schema.dramas.status, count: sql<number>`COUNT(*)` })
    .from(schema.dramas)
    .where(and(isNull(schema.dramas.deletedAt), eq(schema.dramas.userId, user.id)))
    .groupBy(schema.dramas.status)

  const byStatus = rows.map(r => ({ status: r.status || 'draft', count: Number(r.count) }))
  let total = 0
  for (const s of byStatus) total += s.count
  return success(c, { total, by_status: byStatus })
})

// GET /dramas/:id — 项目详情
// summary=1：列表页/进度轮询用的轻量子查询，剧本正文与长文本字段不随集下发
// 真身：四表全行下发
app.get('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const drama = await getDramaOwned(id, user)

  if (c.req.query('summary') === '1') {
    const eps = await db.select({
      id: schema.episodes.id,
      episodeNumber: schema.episodes.episodeNumber,
      title: schema.episodes.title,
      status: schema.episodes.status,
      duration: schema.episodes.duration,
      resolution: schema.episodes.resolution,
      updatedAt: schema.episodes.updatedAt,
      hasScript: sql<number>`(script_content IS NOT NULL AND script_content <> '')`,
      hasVideo: sql<number>`(video_url IS NOT NULL AND video_url <> '')`,
    }).from(schema.episodes)
      .where(and(eq(schema.episodes.dramaId, id), isNull(schema.episodes.deletedAt)))

    // 三类资产同样只裁轻量列（排除 description/appearance/styling/prompt 等大文本）
    const [chars, scns, prps] = await Promise.all([
      db.select({
        id: schema.characters.id, dramaId: schema.characters.dramaId, name: schema.characters.name,
        role: schema.characters.role, imageUrl: schema.characters.imageUrl, sortOrder: schema.characters.sortOrder,
        localPath: schema.characters.localPath, createdAt: schema.characters.createdAt, updatedAt: schema.characters.updatedAt,
      }).from(schema.characters).where(eq(schema.characters.dramaId, id)),
      db.select({
        id: schema.scenes.id, dramaId: schema.scenes.dramaId, episodeId: schema.scenes.episodeId,
        location: schema.scenes.location, time: schema.scenes.time, imageUrl: schema.scenes.imageUrl,
        status: schema.scenes.status, storyboardCount: schema.scenes.storyboardCount,
        localPath: schema.scenes.localPath, createdAt: schema.scenes.createdAt, updatedAt: schema.scenes.updatedAt,
      }).from(schema.scenes).where(eq(schema.scenes.dramaId, id)),
      db.select({
        id: schema.props.id, dramaId: schema.props.dramaId, name: schema.props.name,
        type: schema.props.type, imageUrl: schema.props.imageUrl, localPath: schema.props.localPath,
        createdAt: schema.props.createdAt, updatedAt: schema.props.updatedAt,
      }).from(schema.props).where(eq(schema.props.dramaId, id)),
    ])

    return success(c, {
      ...toSnakeCase(drama),
      tags: drama.tags ? JSON.parse(drama.tags) : [],
      props: toSnakeCaseArray(prps),
      scenes: toSnakeCaseArray(scns),
      characters: toSnakeCaseArray(chars),
      episodes: eps.map(e => ({
        ...toSnakeCase(e),
        has_script: !!e.hasScript,
        has_video: !!e.hasVideo,
      })),
    })
  }

  const eps = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, id), isNull(schema.episodes.deletedAt)))
  const chars = await db.select().from(schema.characters).where(eq(schema.characters.dramaId, id))
  const scns = await db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, id))
  const prps = await db.select().from(schema.props).where(eq(schema.props.dramaId, id))

  return success(c, {
    ...toSnakeCase(drama),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    props: toSnakeCaseArray(prps),
    scenes: toSnakeCaseArray(scns),
    characters: toSnakeCaseArray(chars),
    episodes: toSnakeCaseArray(eps),
  })
})

// PUT /dramas/:id — 字段级更新：body 里出现哪个键就改哪个，未传的保持原值
app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getDramaOwned(id, user)
  const body = await c.req.json()

  const updates: Record<string, any> = { updatedAt: now() }
  if (body.title !== undefined) updates.title = body.title
  if (body.genre !== undefined) updates.genre = body.genre
  if (body.style !== undefined) updates.style = body.style
  if (body.status !== undefined) updates.status = body.status
  if (body.description !== undefined) updates.description = body.description
  if (body.aspect_ratio !== undefined) updates.aspectRatio = body.aspect_ratio
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags)
  if (body.metadata !== undefined) updates.metadata = normalizeMetadata(body.metadata)

  await db.update(schema.dramas).set(updates).where(eq(schema.dramas.id, id))
  return success(c)
})

// DELETE /dramas/:id — 软删：只打 deleted_at 标记，行与文件均保留
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getDramaOwned(id, user)
  await db.update(schema.dramas).set({ deletedAt: now() }).where(eq(schema.dramas.id, id))
  return success(c)
})

export default app
