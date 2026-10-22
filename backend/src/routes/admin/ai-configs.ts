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
import { maskApiKey } from '../../services/cloud-tasks.js'
import { badRequest, success } from '../../utils/response.js'
import { toSnakeCase } from '../../utils/transform.js'
import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { pageOf, tooDeep } from './shared.js'
import { cachedTotal, countKey } from './count-cache.js'

const app = new Hono()

// ─── 3. AI 网关管理 ───

// GET /admin/ai-configs?user_id=&service_type=&keyword= — api_key 一律掩码
app.get('/ai-configs', async (c) => {
  const { page, pageSize } = pageOf(c)
  if (tooDeep(page, pageSize)) return badRequest(c, '翻页过深，请用用户/服务类型/关键词过滤后查询')
  const userId = Number(c.req.query('user_id')) || undefined
  const serviceType = c.req.query('service_type')
  const keyword = (c.req.query('keyword') || '').trim().toLowerCase()
  // 过滤/排序/分页全部下推 SQL，禁止全表载入后内存切页
  const A = schema.aiServiceConfigs
  const conds = []
  if (userId) conds.push(eq(A.userId, userId))
  if (serviceType) conds.push(eq(A.serviceType, serviceType))
  if (keyword) {
    const kw = `%${keyword}%`
    conds.push(or(
      sql`LOWER(${A.name}) LIKE ${kw}`,
      sql`LOWER(${A.provider}) LIKE ${kw}`,
      sql`LOWER(${A.model}) LIKE ${kw}`,
      sql`LOWER(${A.baseUrl}) LIKE ${kw}`,
    ))
  }
  const where = conds.length ? and(...conds) : undefined
  const [rows, total] = await Promise.all([
    db.select().from(A).where(where)
      .orderBy(desc(A.updatedAt), desc(A.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    cachedTotal(countKey('admin:ai-configs', userId, serviceType, keyword), async () => {
      const [r] = await db.select({ c: count() }).from(A).where(where)
      return Number(r?.c) || 0
    }),
  ])
  // 用户名只对当页涉及的用户点查，不再全表 userMap
  const ownerIds = [...new Set(rows.map(r => r.userId).filter((v): v is number => !!v))]
  const userRows = ownerIds.length
    ? await db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users)
        .where(inArray(schema.users.id, ownerIds))
    : []
  const users = new Map(userRows.map(u => [u.id, { username: u.username }]))
  return success(c, {
    total,
    page,
    page_size: pageSize,
    items: rows.map(r => ({
      ...toSnakeCase(r),
      api_key: maskApiKey(r.apiKey),
      username: r.userId ? users.get(r.userId)?.username ?? null : null,
    })),
  })
})


export default app
