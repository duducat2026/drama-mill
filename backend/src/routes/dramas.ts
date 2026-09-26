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

/**
 * 项目 CRUD 门面路由（挂载于 /dramas）
 * 素材类端点（assets-status / characters / episodes 批量保存）拆至 dramas-assets.ts，
 * 共享纯函数与聚合查询在 dramas-shared.ts；挂载顺序见 src/index.ts（assets 子路由先注册，
 * 保证 /:id/assets-status 等具体路径先于 /:id 通配路由匹配）
 */
import { Hono } from 'hono'
import { and, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, now } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { getDramaOwned } from '../services/ownership.js'
import { countByDrama, normalizeMetadata } from './dramas-shared.js'

const app = new Hono()

// GET /dramas - List dramas（仅当前用户的项目；真实分页 + COUNT 聚合，不再返回完整数组）
app.get('/', async (c) => {
  const user = c.get('user')
  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('page_size') || 20)
  const status = c.req.query('status')
  const keyword = c.req.query('keyword')

  const conds: any[] = [isNull(schema.dramas.deletedAt), eq(schema.dramas.userId, user.id)]
  // 支持逗号分隔多值（如 active,producing：手动标记与生产编排自动写入的状态合并筛选）
  if (status) {
    const values = String(status).split(',').map(s => s.trim()).filter(Boolean)
    conds.push(values.length > 1 ? inArray(schema.dramas.status, values) : eq(schema.dramas.status, values[0]))
  }
  if (keyword) conds.push(like(schema.dramas.title, `%${keyword}%`))
  const where = and(...conds)

  const [{ value: total }] = await db.select({ value: sql<number>`COUNT(*)` }).from(schema.dramas).where(where)
  const items = await db.select().from(schema.dramas)
    .where(where)
    .orderBy(desc(schema.dramas.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  // 当页项目批量聚合集/角色/场景计数（3 条 COUNT GROUP BY 替代逐项 3N 次查询）；
  // characters/scenes 不过滤 deleted_at，与原逐项目查询语义保持一致
  const dramaIds = items.map(d => d.id)
  const [epCounts, charCounts, sceneCounts] = await Promise.all([
    countByDrama(schema.episodes, dramaIds, true),
    countByDrama(schema.characters, dramaIds, false),
    countByDrama(schema.scenes, dramaIds, false),
  ])

  const enriched = items.map(drama => ({
    ...toSnakeCase(drama),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    total_episodes: epCounts.get(drama.id) || 0,
    episode_count: epCounts.get(drama.id) || 0,
    character_count: charCounts.get(drama.id) || 0,
    scene_count: sceneCounts.get(drama.id) || 0,
  }))

  return success(c, {
    items: enriched,
    pagination: { page, page_size: pageSize, total: Number(total), total_pages: Math.ceil(Number(total) / pageSize) },
  })
})

// POST /dramas - Create drama
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const ts = now()
  const res = await db.insert(schema.dramas).values({
    title: body.title,
    description: body.description,
    genre: body.genre,
    style: body.style,
    aspectRatio: body.aspect_ratio || '16:9',
    tags: body.tags ? JSON.stringify(body.tags) : null,
    metadata: normalizeMetadata(body.metadata),
    status: 'draft',
    userId: user.id,
    createdAt: ts,
    updatedAt: ts,
  })

  const [result] = await db.select().from(schema.dramas)
    .where(eq(schema.dramas.id, getInsertId(res)))

  // 不再预建集 — 用户通过「添加集」流程创建（该流程会锁定图片/视频生成配置）
  return created(c, toSnakeCase(result))
})

// GET /dramas/stats — must be before /:id
// SQL 下推聚合：GROUP BY status 一次出分组计数与总数，不再拉全项目行入 Node 统计
app.get('/stats', async (c) => {
  const user = c.get('user')
  const rows = await db.select({
    status: schema.dramas.status,
    count: sql<number>`COUNT(*)`,
  }).from(schema.dramas)
    .where(and(isNull(schema.dramas.deletedAt), eq(schema.dramas.userId, user.id)))
    .groupBy(schema.dramas.status)
  const byStatus = rows.map(r => ({ status: r.status || 'draft', count: Number(r.count) }))
  const total = byStatus.reduce((sum, s) => sum + s.count, 0)
  return success(c, { total, by_status: byStatus })
})

// GET /dramas/:id - Get drama detail（?summary=1 时返回轻字段：集只带布尔标记与展示字段，不带剧本全文）
app.get('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const drama = await getDramaOwned(id, user)
  const summary = c.req.query('summary') === '1'

  if (summary) {
    const eps = await db.select({
      id: schema.episodes.id,
      episodeNumber: schema.episodes.episodeNumber,
      title: schema.episodes.title,
      status: schema.episodes.status,
      resolution: schema.episodes.resolution,
      duration: schema.episodes.duration,
      updatedAt: schema.episodes.updatedAt,
      hasScript: sql<number>`(script_content IS NOT NULL AND script_content <> '')`,
      hasVideo: sql<number>`(video_url IS NOT NULL AND video_url <> '')`,
    }).from(schema.episodes)
      .where(and(eq(schema.episodes.dramaId, id), isNull(schema.episodes.deletedAt)))
    // summary 模式下资产只取轻量列（排除 description/appearance/styling/prompt 等 TEXT 大字段）
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
      episodes: eps.map(e => ({
        ...toSnakeCase(e),
        has_script: !!e.hasScript,
        has_video: !!e.hasVideo,
      })),
      characters: toSnakeCaseArray(chars),
      scenes: toSnakeCaseArray(scns),
      props: toSnakeCaseArray(prps),
    })
  }

  const eps = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, id), isNull(schema.episodes.deletedAt)))
  const chars = await db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, id))
  const scns = await db.select().from(schema.scenes)
    .where(eq(schema.scenes.dramaId, id))
  const prps = await db.select().from(schema.props)
    .where(eq(schema.props.dramaId, id))

  return success(c, {
    ...toSnakeCase(drama),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    episodes: toSnakeCaseArray(eps),
    characters: toSnakeCaseArray(chars),
    scenes: toSnakeCaseArray(scns),
    props: toSnakeCaseArray(prps),
  })
})

// PUT /dramas/:id - Update drama
app.put('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getDramaOwned(id, user)
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.genre !== undefined) updates.genre = body.genre
  if (body.style !== undefined) updates.style = body.style
  if (body.aspect_ratio !== undefined) updates.aspectRatio = body.aspect_ratio
  if (body.status !== undefined) updates.status = body.status
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags)
  if (body.metadata !== undefined) updates.metadata = normalizeMetadata(body.metadata)
  await db.update(schema.dramas).set(updates).where(eq(schema.dramas.id, id))
  return success(c)
})

// DELETE /dramas/:id - Soft delete
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await getDramaOwned(id, user)
  await db.update(schema.dramas).set({ deletedAt: now() }).where(eq(schema.dramas.id, id))
  return success(c)
})

export default app
