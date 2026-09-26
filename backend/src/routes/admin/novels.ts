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
import { notFound, now, success } from '../../utils/response.js'
import { toSnakeCase } from '../../utils/transform.js'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { pageOf, userMap, dramaMap } from './shared.js'

const app = new Hono()

// ─── 15. 平台小说管理（检索/预览/删除/生成项目） ───

/** 小说列表投影列：不含正文（content 为 MEDIUMTEXT，列表禁止携带） */
const ADMIN_NOVEL_SLIM = {
  id: schema.novels.id,
  dramaId: schema.novels.dramaId,
  title: schema.novels.title,
  fileName: schema.novels.fileName,
  charCount: schema.novels.charCount,
  chapterCount: schema.novels.chapterCount,
  splitStatus: schema.novels.splitStatus,
  splitTemplateId: schema.novels.splitTemplateId,
  userId: schema.novels.userId,
  createdAt: schema.novels.createdAt,
  updatedAt: schema.novels.updatedAt,
}

// GET /admin/novels?username=&keyword=&from=&to=&page= — 过滤条件全部下推 SQL（COUNT + LIMIT/OFFSET）
app.get('/novels', async (c) => {
  const { page, pageSize } = pageOf(c)
  const username = (c.req.query('username') || '').trim().toLowerCase()
  const keyword = (c.req.query('keyword') || '').trim().toLowerCase()
  const from = c.req.query('from')
  const to = c.req.query('to')

  // 用户名检索 → id 集合（users 小表）；无命中直接空页，避免无效查询
  let userScope: number[] | null = null
  if (username) {
    const matched = await db.select({ id: schema.users.id }).from(schema.users)
      .where(or(
        sql`LOWER(${schema.users.username}) LIKE ${`%${username}%`}`,
        sql`LOWER(${schema.users.nickname}) LIKE ${`%${username}%`}`,
      ))
    userScope = matched.map(u => u.id)
    if (!userScope.length) return success(c, { total: 0, page, page_size: pageSize, items: [] })
  }

  const conds: any[] = [isNull(schema.novels.deletedAt)]
  if (userScope) conds.push(inArray(schema.novels.userId, userScope))
  if (keyword) conds.push(sql`LOWER(${schema.novels.title}) LIKE ${`%${keyword}%`}`)
  if (from) conds.push(sql`${schema.novels.createdAt} >= ${from}`)
  if (to) conds.push(sql`${schema.novels.createdAt} <= ${`${to}\uFFFF`}`)
  const where = and(...conds)

  const [countRow] = await db.select({ c: sql<number>`COUNT(*)` }).from(schema.novels).where(where)
  const total = Number(countRow?.c) || 0
  const rows = total
    ? await db.select(ADMIN_NOVEL_SLIM).from(schema.novels).where(where)
        .orderBy(sql`${schema.novels.createdAt} DESC, ${schema.novels.id} ASC`)
        .limit(pageSize).offset((page - 1) * pageSize)
    : []

  // 用户名与所属项目（页内点查）
  const users = await userMap()
  const dramaIds = [...new Set(rows.map(r => r.dramaId).filter((v): v is number => !!v))]
  const dramaRows = dramaIds.length
    ? await db.select({ id: schema.dramas.id, title: schema.dramas.title, status: schema.dramas.status, deletedAt: schema.dramas.deletedAt }).from(schema.dramas).where(inArray(schema.dramas.id, dramaIds))
    : []
  const dramaMap = new Map(dramaRows.filter(d => !d.deletedAt).map(d => [d.id, d]))

  return success(c, {
    total,
    page,
    page_size: pageSize,
    items: rows.map((r) => {
      const drama = r.dramaId ? dramaMap.get(r.dramaId) : undefined
      return {
        ...toSnakeCase(r),
        username: r.userId ? users.get(r.userId)?.username ?? null : null,
        drama_title: drama?.title ?? null,
        drama_status: drama?.status ?? null,
      }
    }),
  })
})

// GET /admin/novels/:id/content — 在线预览正文（含归属用户）
app.get('/novels/:id/content', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select({
    id: schema.novels.id,
    title: schema.novels.title,
    content: schema.novels.content,
    charCount: schema.novels.charCount,
    chapterCount: schema.novels.chapterCount,
    splitStatus: schema.novels.splitStatus,
    splitInfo: schema.novels.splitInfo,
    userId: schema.novels.userId,
    createdAt: schema.novels.createdAt,
    updatedAt: schema.novels.updatedAt,
    deletedAt: schema.novels.deletedAt,
  }).from(schema.novels).where(eq(schema.novels.id, id))
  if (!row || row.deletedAt) return notFound(c, '小说不存在')
  const users = await userMap()
  return success(c, {
    ...toSnakeCase(row),
    username: row.userId ? users.get(row.userId)?.username ?? null : null,
  })
})

// DELETE /admin/novels/:id — 软删除（已生成的项目不受影响）
app.delete('/novels/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select({ id: schema.novels.id, deletedAt: schema.novels.deletedAt }).from(schema.novels).where(eq(schema.novels.id, id))
  if (!row || row.deletedAt) return notFound(c, '小说不存在')
  await db.update(schema.novels).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.novels.id, id))
  return success(c, { id })
})

// GET /admin/novels/:id/dramas — 小说生成的项目列表（含集数统计）
app.get('/novels/:id/dramas', async (c) => {
  const id = Number(c.req.param('id'))
  const [novel] = await db.select({ id: schema.novels.id, dramaId: schema.novels.dramaId, deletedAt: schema.novels.deletedAt }).from(schema.novels).where(eq(schema.novels.id, id))
  if (!novel || novel.deletedAt) return notFound(c, '小说不存在')
  if (!novel.dramaId) return success(c, [])
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, novel.dramaId))
  if (!drama || drama.deletedAt) return success(c, [])
  const eps = await db.select({ id: schema.episodes.id, deletedAt: schema.episodes.deletedAt }).from(schema.episodes)
    .where(eq(schema.episodes.dramaId, novel.dramaId))
  const users = await userMap()
  return success(c, [{
    ...toSnakeCase(drama),
    username: drama.userId ? users.get(drama.userId)?.username ?? null : null,
    episode_count: eps.filter(e => !e.deletedAt).length,
  }])
})


export default app
