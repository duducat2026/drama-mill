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
 * 超时判定与失败自动恢复取数（拆分自 generation.ts，供 task-recovery-watchdog 调用）。
 */
import { db, schema } from '../db/index.js'
import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm'
import { watchdogConsentSql } from './watchdog-switch.js'
import { GEN_TASK_AUTO_RETRY_MIN_AGE_MS, GEN_TASK_AUTO_RETRY_WINDOW_MS, VIDEO_TASK_TIMEOUT_MS, VIDEO_TASK_HARD_LIMIT_MS } from '../utils/rate-config.js'
import { getAutoRetryMax } from './runtime-config.js'
import type { SysTaskRecord } from './generation-shared.js'

/** 终态错误识别：内容审核/凭证无效等重提也不会成功的错误，不进入自动恢复 */
export function isPermanentError(msg: string | null | undefined): boolean {
  if (!msg) return false
  return /sensitive|moderation|content.?policy|green.?net|审核|违规|违禁|涉政|unauthorized|invalid.*(api)?key|401|403/i.test(msg)
}

/** 卡在 processing 的孤儿任务（重启/崩溃后丢失轮询线程）：以 updated_at 为基准，超过 2 倍视频超时阈值仍无更新才判卡死；
 *  时间窗口直接下推 SQL（updated_at 为空串时回退 created_at，与内存过滤语义一致），只捞命中窗口的少量行。
 *  另外也捞超过硬性墙钟上限（VIDEO_TASK_HARD_LIMIT_MS）的任务，即使 updated_at 仍被轮询线程刷新也要判死——
 *  防止上游队列永久 PENDING 导致无限轮询。 */
export async function findStuckVideoTasks(): Promise<SysTaskRecord[]> {
  const stuckWindowMs = VIDEO_TASK_TIMEOUT_MS * 2
  const cutoff = new Date(Date.now() - stuckWindowMs).toISOString()
  const hardCutoff = new Date(Date.now() - VIDEO_TASK_HARD_LIMIT_MS).toISOString()
  return db.select().from(schema.sysTask)
    .where(and(
      eq(schema.sysTask.type, 'video'),
      eq(schema.sysTask.status, 'processing'),
      sql`(COALESCE(NULLIF(${schema.sysTask.updatedAt}, ''), ${schema.sysTask.createdAt}) < ${cutoff} OR ${schema.sysTask.createdAt} < ${hardCutoff})`,
    ))
}

/** 可自动重提的失败任务：冷却期已过、窗口期内、未超自动重试上限、非终态错误，且归属人已授权本看门狗；
 *  时间窗口/重试额度/用户授权/排序限量全部下推 SQL，failed 历史累积时不全表加载，
 *  每轮限量也不会被未授权用户的失败占满；
 *  终态错误靠正则识别无法下推，留在 SQL 限量后再过滤（下轮看门狗继续消化） */
export async function getFailedTasksForAutoRetry(maxCount: number): Promise<SysTaskRecord[]> {
  // 重提上限动态可配：管理后台运行时配置优先（0~9，0 = 关闭）；放弃任务 retry_count=99 天然出局
  const maxRetry = await getAutoRetryMax()
  if (maxRetry <= 0) return []
  const upper = new Date(Date.now() - GEN_TASK_AUTO_RETRY_MIN_AGE_MS).toISOString()
  const lower = new Date(Date.now() - GEN_TASK_AUTO_RETRY_WINDOW_MS).toISOString()
  const rows = await db.select().from(schema.sysTask)
    .where(and(
      eq(schema.sysTask.status, 'failed'),
      gte(schema.sysTask.updatedAt, lower),
      lte(schema.sysTask.updatedAt, upper),
      lt(schema.sysTask.retryCount, maxRetry),
      // 归属人已授权「失败任务自动重提」才进入候选：每轮限量按 updated_at DESC 取最新 N 条，
      // 不下推的话未授权用户的失败会占满名额，已授权用户的任务会在时间窗口内一直排不进
      watchdogConsentSql('retry', schema.sysTask.userId),
      // 设置页单次生成测试任务永不自动重提（测试语义 = 一次调用一份结果），同样下推 SQL 不占每轮限量
      sql`(${schema.sysTask.params} IS NULL OR ${schema.sysTask.params} NOT LIKE '%"configTest":true%')`,
    ))
    .orderBy(desc(schema.sysTask.updatedAt))
    .limit(maxCount)
  return rows.filter(t => !isPermanentError(t.errorMsg))
}
