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
import { getGatewayRateStats, getTaskQueueStats } from '../../services/generation.js'
import { getOverQuotaUsers } from '../../services/storage-quota.js'
import { getDiskUsage } from '../../services/storage-stats.js'
import { now, success } from '../../utils/response.js'
import { and, count, gte, isNull, sql } from 'drizzle-orm'

const app = new Hono()

// ─── 13. 运行监控（24h 任务趋势/状态分布/失败画像/网关健康） ───

/** 失败原因归类规则（error_msg 命中 MySQL REGEXP 即归入，按声明顺序优先匹配） */
const MONITOR_ERROR_RULES: { label: string; pattern: string }[] = [
  { label: '素材下载失败', pattern: 'Failed to download' },
  { label: '模型未开通', pattern: 'Unpurchased|AccessDenied' },
  { label: '绿网拦截', pattern: 'DataInspection|green|绿网|审核|违规|敏感|不当' },
  { label: '限流/配额', pattern: '429|throttl|rate|limit|quota|限流' },
  { label: '超时', pattern: 'timeout|timed|超时' },
]

/** 按小时聚合的分组表达式：时间字段为 ISO 字符串，取前 13 位即小时桶 */
const hourBucket = (col: any) => sql<string>`SUBSTRING(${col}, 1, 13)`

/** 小时桶键归一：兼容 "2026-08-29T06"（ISO）与 "2026-08-28 06"（早期本地格式） */
function normHourKey(raw: unknown): string {
  return String(raw ?? '').replace(' ', 'T').slice(0, 13)
}

app.get('/monitor-stats', async (c) => {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const errorCase = sql<string>`CASE ${sql.join(
    MONITOR_ERROR_RULES.map(r => sql`WHEN ${schema.sysTask.errorMsg} REGEXP ${r.pattern} THEN ${r.label}`),
    sql` `,
  )} ELSE '其他' END`

  const [statusRows, createdRows, completedRows, failedRows, errorRows, batchRows, itemRows] = await Promise.all([
    db.select({ status: schema.sysTask.status, c: sql<number>`COUNT(*)` }).from(schema.sysTask).groupBy(schema.sysTask.status),
    db.select({ h: hourBucket(schema.sysTask.createdAt), c: sql<number>`COUNT(*)` }).from(schema.sysTask)
      .where(sql`${schema.sysTask.createdAt} >= ${cutoff}`).groupBy(hourBucket(schema.sysTask.createdAt)),
    db.select({ h: hourBucket(schema.sysTask.completedAt), c: sql<number>`COUNT(*)` }).from(schema.sysTask)
      .where(sql`${schema.sysTask.completedAt} >= ${cutoff}`).groupBy(hourBucket(schema.sysTask.completedAt)),
    db.select({ h: hourBucket(schema.sysTask.updatedAt), c: sql<number>`COUNT(*)` }).from(schema.sysTask)
      .where(and(sql`${schema.sysTask.updatedAt} >= ${cutoff}`, sql`${schema.sysTask.status} = 'failed'`)).groupBy(hourBucket(schema.sysTask.updatedAt)),
    // 失败错误画像限定近 24h 窗口：REGEXP CASE 对每行求值，全历史扫描代价随 failed 行数线性增长
    db.select({ label: errorCase, c: sql<number>`COUNT(*)` }).from(schema.sysTask)
      .where(and(sql`${schema.sysTask.status} = 'failed'`, sql`${schema.sysTask.errorMsg} IS NOT NULL AND ${schema.sysTask.errorMsg} <> ''`, gte(schema.sysTask.createdAt, cutoff))).groupBy(sql`1`).orderBy(sql`2 DESC`),
    db.select({ status: schema.productionBatches.status, c: sql<number>`COUNT(*)` }).from(schema.productionBatches)
      .where(isNull(schema.productionBatches.deletedAt)).groupBy(schema.productionBatches.status),
    db.select({ status: schema.productionBatchItems.status, c: sql<number>`COUNT(*)` }).from(schema.productionBatchItems).groupBy(schema.productionBatchItems.status),
  ])

  // 24 个小时桶（含当前小时），缺失桶补 0，保证前端图表连续无断点
  const toMap = (rows: { h: string; c: number }[]) => new Map(rows.map(r => [normHourKey(r.h), Number(r.c) || 0]))
  const [createdMap, completedMap, failedMap] = [toMap(createdRows), toMap(completedRows), toMap(failedRows)]
  const anchor = Math.floor(Date.now() / 3600000) * 3600000
  const hourly = Array.from({ length: 24 }, (_, i) => {
    const t = new Date(anchor - (23 - i) * 3600000)
    const key = t.toISOString().slice(0, 13)
    return {
      label: `${String(t.getUTCHours()).padStart(2, '0')}:00`,
      created: createdMap.get(key) || 0,
      completed: completedMap.get(key) || 0,
      failed: failedMap.get(key) || 0,
    }
  })

  const toCounts = (rows: { status: string | null; c: number }[]) => {
    const out: Record<string, number> = {}
    for (const r of rows) out[r.status || 'unknown'] = Number(r.c) || 0
    return out
  }

  const mem = process.memoryUsage()
  return success(c, {
    system: {
      uptime_sec: Math.round(process.uptime()),
      node_version: process.version,
      memory_rss_mb: +(mem.rss / 1048576).toFixed(1),
      heap_used_mb: +(mem.heapUsed / 1048576).toFixed(1),
    },
    disk: await getDiskUsage(),
    queue: getTaskQueueStats(),
    tasks_by_status: toCounts(statusRows),
    hourly,
    error_classes: errorRows.map(r => ({ label: r.label, count: Number(r.c) || 0 })),
    gateways: getGatewayRateStats(),
    batches: { by_status: toCounts(batchRows), items_by_status: toCounts(itemRows) },
    // 存储配额超额告警（用量走共享缓存，重复探测代价极低）
    over_quota_users: await getOverQuotaUsers(),
    generated_at: now(),
  })
})


export default app
