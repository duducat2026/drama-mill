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
import { getGatewayRateStats, getTaskQueueStats } from '../../services/generation.js'
import { now, success } from '../../utils/response.js'
import { count, desc, gte, sql } from 'drizzle-orm'

const app = new Hono()

// ─── 9. 生产面板 ───

// GET /admin/panel — 队列/任务状态聚合/各网关自适应限流统计/最近 429
app.get('/panel', async (c) => {
  const queue = getTaskQueueStats()
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

  // 全部聚合下推 SQL，不再将全表 sys_task 载入 Node
  const [statusRows, typeRows, recentTotalRow, recent429] = await Promise.all([
    db.select({ status: schema.sysTask.status, c: count() }).from(schema.sysTask).groupBy(schema.sysTask.status),
    db.select({ type: schema.sysTask.type, c: count() }).from(schema.sysTask)
      .where(gte(schema.sysTask.createdAt, dayAgo)).groupBy(schema.sysTask.type),
    db.select({ c: count() }).from(schema.sysTask).where(gte(schema.sysTask.createdAt, dayAgo)),
    db.select({
      id: schema.sysTask.id, type: schema.sysTask.type, provider: schema.sysTask.provider,
      model: schema.sysTask.model, errorMsg: schema.sysTask.errorMsg, updatedAt: schema.sysTask.updatedAt,
    }).from(schema.sysTask)
      .where(sql`${schema.sysTask.errorMsg} IS NOT NULL AND ${schema.sysTask.errorMsg} REGEXP '429|throttl|rate.?limit|too many requests'`)
      .orderBy(desc(schema.sysTask.updatedAt)).limit(20),
  ])

  const tasksByStatus: Record<string, number> = {}
  for (const r of statusRows) tasksByStatus[r.status || 'unknown'] = (tasksByStatus[r.status || 'unknown'] || 0) + Number(r.c)
  const recentByType: Record<string, number> = {}
  let recentTotal = 0
  for (const r of typeRows) { recentByType[r.type] = Number(r.c); recentTotal += Number(r.c) }

  const gateways = getGatewayRateStats()

  return success(c, {
    queue,
    tasks_by_status: tasksByStatus,
    recent_24h: { total: recentTotal, by_type: recentByType },
    gateways,
    recent_429: recent429.map(t => ({ id: t.id, type: t.type, provider: t.provider, model: t.model, error_msg: t.errorMsg, updated_at: t.updatedAt })),
  })
})


export default app
