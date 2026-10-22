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
import { toSnakeCase } from '../../utils/transform.js'
import { and, count, desc, eq, gte, inArray, isNull, like, lte, or } from 'drizzle-orm'
import { pageOf, tooDeep } from './shared.js'
import { cachedTotal, countKey } from './count-cache.js'

const app = new Hono()

// ─── 8. 平台拼接成片 ───

// GET /admin/merges?user_id=&keyword=&from=&to=&page=
app.get('/merges', async (c) => {
  const { page, pageSize } = pageOf(c)
  if (tooDeep(page, pageSize)) return badRequest(c, '翻页过深，请用用户/日期/关键词过滤后查询')
  const userId = Number(c.req.query('user_id')) || undefined
  const keyword = (c.req.query('keyword') || '').trim()
  const from = c.req.query('from')
  const to = c.req.query('to')

  // 软删/用户/日期/keyword 与排序分页全部下推 SQL；scenes（分镜 JSON 大字段）与 deletedAt 不选取
  const VM = schema.videoMerges
  const cols = {
    id: VM.id, episodeId: VM.episodeId, dramaId: VM.dramaId, title: VM.title,
    provider: VM.provider, model: VM.model, status: VM.status, mergedUrl: VM.mergedUrl,
    duration: VM.duration, taskId: VM.taskId, errorMsg: VM.errorMsg, userId: VM.userId,
    createdAt: VM.createdAt, completedAt: VM.completedAt,
  }
  const conds = [isNull(VM.deletedAt)]
  if (userId) conds.push(eq(VM.userId, userId))
  if (from) conds.push(gte(VM.createdAt, from))
  if (to) conds.push(lte(VM.createdAt, `${to}\uFFFF`))
  if (keyword) {
    const kw = `%${keyword}%`
    const titleDramaIds = (await db.select({ id: schema.dramas.id }).from(schema.dramas).where(like(schema.dramas.title, kw))).map(d => d.id)
    conds.push(or(
      like(VM.title, kw),
      titleDramaIds.length ? inArray(VM.dramaId, titleDramaIds) : undefined,
    )!)
  }
  const where = and(...conds)
  const [rows, total] = await Promise.all([
    db.select(cols).from(VM).where(where)
      .orderBy(desc(VM.createdAt), desc(VM.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    // COUNT(*) 缓存 60s（对齐 videos/storyboards 治理）：key 覆盖全部影响行数的过滤条件
    cachedTotal(countKey('admin:merges', userId, keyword, from, to), async () => {
      const [r] = await db.select({ c: count() }).from(VM).where(where)
      return Number(r?.c) || 0
    }),
  ])

  const uidSet = [...new Set(rows.map(m => m.userId).filter((v): v is number => !!v))]
  const didSet = [...new Set(rows.map(m => m.dramaId).filter((v): v is number => !!v))]
  const users = uidSet.length
    ? new Map((await db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users).where(inArray(schema.users.id, uidSet))).map(u => [u.id, u.username]))
    : new Map<number, string>()
  const dramaTitle = didSet.length
    ? new Map((await db.select({ id: schema.dramas.id, title: schema.dramas.title }).from(schema.dramas).where(inArray(schema.dramas.id, didSet))).map(d => [d.id, d.title]))
    : new Map<number, string>()

  return success(c, {
    total,
    page,
    page_size: pageSize,
    items: rows.map(m => ({
      ...toSnakeCase(m),
      drama_title: m.dramaId ? dramaTitle.get(m.dramaId) ?? null : null,
      username: m.userId ? users.get(m.userId) ?? null : null,
    })),
  })
})


export default app
