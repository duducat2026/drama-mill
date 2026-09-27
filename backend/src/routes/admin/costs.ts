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
import { aggregateCosts } from '../../services/cost.js'
import { success } from '../../utils/response.js'
import { toSnakeCase } from '../../utils/transform.js'
import { and, count, desc, eq, inArray, like, sql } from 'drizzle-orm'
import { pageOf, userMap, dramaMap } from './shared.js'

const app = new Hono()

// ─── 10. 平台成本查询 ───

// GET /admin/costs?user_id=&drama_id=&drama_keyword=&episode_id=&page= — 汇总 + 明细分页
app.get('/costs', async (c) => {
  const { page, pageSize } = pageOf(c)
  const userId = Number(c.req.query('user_id')) || undefined
  const dramaId = Number(c.req.query('drama_id')) || undefined
  const episodeId = Number(c.req.query('episode_id')) || undefined
  const dramaKeyword = (c.req.query('drama_keyword') || '').trim().toLowerCase()

  // 按项目名称检索匹配的 drama_id 集合（dramas 表规模受控，LIKE 下推）
  let dramaIds: Set<number> | null = null
  if (dramaKeyword) {
    const matched = await db.select({ id: schema.dramas.id }).from(schema.dramas).where(like(schema.dramas.title, `%${dramaKeyword}%`))
    dramaIds = new Set(matched.map(d => d.id))
  }

  const agg = await aggregateCosts({ userId, dramaId, episodeId, limit: 0, dramaIds })

  // 明细分页：筛选 + 排序 + LIMIT/OFFSET + COUNT 全部下推 SQL，不再全表 usage_records 载入 Node
  const dConds = []
  if (userId) dConds.push(eq(schema.usageRecords.userId, userId))
  if (dramaId) dConds.push(eq(schema.usageRecords.dramaId, dramaId))
  if (episodeId) dConds.push(eq(schema.usageRecords.episodeId, episodeId))
  if (dramaIds) {
    const ids = [...dramaIds]
    if (!ids.length) dConds.push(sql`1 = 0`)
    else dConds.push(inArray(schema.usageRecords.dramaId, ids))
  }
  const dWhere = dConds.length ? and(...dConds) : undefined
  const [detailRows, totalRow] = await Promise.all([
    db.select().from(schema.usageRecords).where(dWhere)
      .orderBy(desc(schema.usageRecords.createdAt), desc(schema.usageRecords.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    db.select({ c: count() }).from(schema.usageRecords).where(dWhere),
  ])

  const users = await userMap()
  const dramas = await dramaMap()
  const { details: _omit, ...summary } = agg
  // 为 by_drama 汇总注入项目名称
  const byDrama = (summary.by_drama || []).map((d: any) => ({
    ...d,
    drama_title: dramas.get(d.drama_id)?.title ?? null,
  }))
  return success(c, {
    ...summary,
    by_drama: byDrama,
    details_total: Number(totalRow[0]?.c) || 0,
    page,
    page_size: pageSize,
    details: detailRows.map(r => ({
      ...toSnakeCase(r),
      username: r.userId ? users.get(r.userId)?.username ?? null : null,
      drama_title: r.dramaId ? dramas.get(r.dramaId)?.title ?? null : null,
    })),
  })
})


export default app
