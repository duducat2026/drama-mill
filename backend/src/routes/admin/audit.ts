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
import { badRequest, success } from '../../utils/response.js'
import { toSnakeCase } from '../../utils/transform.js'
import { and, count, desc, gte, like, lte } from 'drizzle-orm'
import { pageOf, tooDeep } from './shared.js'
import { cachedTotal, countKey } from './count-cache.js'

const app = new Hono()

// ─── 4. 操作审计 ───

// GET /admin/audit?username=&action=&path=&from=&to=&page=
app.get('/audit', async (c) => {
  const { page, pageSize } = pageOf(c)
  if (tooDeep(page, pageSize)) return badRequest(c, '翻页过深，请用用户名/操作/日期过滤后查询')
  const username = (c.req.query('username') || '').trim()
  const action = (c.req.query('action') || '').trim()
  const pathKw = (c.req.query('path') || '').trim()
  const from = c.req.query('from')
  const to = c.req.query('to')
  // 筛选/日期/排序/分页全部下推 SQL，避免将全表（含 detail TEXT）载入 Node 后内存切页
  const conds = []
  if (username) conds.push(like(schema.auditLogs.username, `%${username}%`))
  if (action) conds.push(like(schema.auditLogs.action, `%${action}%`))
  if (pathKw) conds.push(like(schema.auditLogs.path, `%${pathKw}%`))
  if (from) conds.push(gte(schema.auditLogs.createdAt, from))
  if (to) conds.push(lte(schema.auditLogs.createdAt, `${to}\uFFFF`))
  const where = conds.length ? and(...conds) : undefined
  const [rows, total] = await Promise.all([
    db.select().from(schema.auditLogs).where(where)
      .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    // 千万级下 COUNT(*) 是最贵操作：按过滤条件缓存 60s，翻页/刷新不重复计数
    cachedTotal(countKey('admin:audit', username, action, pathKw, from, to), async () => {
      const [r] = await db.select({ c: count() }).from(schema.auditLogs).where(where)
      return Number(r?.c) || 0
    }),
  ])
  return success(c, {
    total,
    page,
    page_size: pageSize,
    items: rows.map(r => toSnakeCase(r)),
  })
})


export default app
