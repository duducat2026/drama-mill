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
import { notFound, success } from '../../utils/response.js'
import { toSnakeCase } from '../../utils/transform.js'
import { and, count, desc, eq, gte, inArray, isNull, like, lte, or } from 'drizzle-orm'
import { pageOf } from './shared.js'

const app = new Hono()

// ─── 5. 平台剧本查看（原始内容 + AI 改写内容） ───

// GET /admin/dramas?user_id=&keyword=&from=&to=&page=
app.get('/dramas', async (c) => {
  const { page, pageSize } = pageOf(c)
  const userId = Number(c.req.query('user_id')) || undefined
  const keyword = (c.req.query('keyword') || '').trim()
  const from = c.req.query('from')
  const to = c.req.query('to')

  // 软删/用户/keyword/日期与排序分页全部下推 SQL，不再全表 dramas+episodes 载入 Node
  const DR = schema.dramas
  const conds = [isNull(DR.deletedAt)]
  if (userId) conds.push(eq(DR.userId, userId))
  if (keyword) conds.push(or(like(DR.title, `%${keyword}%`), like(DR.description, `%${keyword}%`))!)
  if (from) conds.push(gte(DR.createdAt, from))
  if (to) conds.push(lte(DR.createdAt, `${to}\uFFFF`))
  const where = and(...conds)
  const [rows, totalRow] = await Promise.all([
    db.select().from(DR).where(where).orderBy(desc(DR.createdAt), desc(DR.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ c: count() }).from(DR).where(where),
  ])

  const dramaIds = rows.map(d => d.id)
  const epCount = dramaIds.length
    ? new Map((await db.select({ dramaId: schema.episodes.dramaId, c: count() }).from(schema.episodes)
        .where(and(isNull(schema.episodes.deletedAt), inArray(schema.episodes.dramaId, dramaIds)))
        .groupBy(schema.episodes.dramaId)).map(r => [r.dramaId, Number(r.c)]))
    : new Map<number, number>()
  const uidSet = [...new Set(rows.map(d => d.userId).filter((v): v is number => !!v))]
  const users = uidSet.length
    ? new Map((await db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users).where(inArray(schema.users.id, uidSet))).map(u => [u.id, u.username]))
    : new Map<number, string>()

  return success(c, {
    total: Number(totalRow[0]?.c) || 0,
    page,
    page_size: pageSize,
    items: rows.map(d => ({
      ...toSnakeCase(d),
      username: d.userId ? users.get(d.userId) ?? null : null,
      episode_count: epCount.get(d.id) || 0,
    })),
  })
})

// GET /admin/dramas/:id/episodes — 剧集明细：原始内容(content) + AI 改写内容(script_content)
app.get('/dramas/:id/episodes', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama || drama.deletedAt) return notFound(c, '剧集不存在')
  let rows = await db.select().from(schema.episodes).where(eq(schema.episodes.dramaId, dramaId))
  rows = rows.filter(e => !e.deletedAt).sort((a, b) => a.episodeNumber - b.episodeNumber)
  return success(c, rows.map(e => toSnakeCase(e)))
})


export default app
