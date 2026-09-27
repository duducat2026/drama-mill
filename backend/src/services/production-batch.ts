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
 * 批量生产编排 — 门面（对外 API 与入口不变）
 *
 * 一次上传多部小说，按上传顺序逐部完成「自动分集 → 7 步流水线生产」。
 * 两步走：mode=full 拆分后自动续接生产；mode=split_only 仅拆分，拆分完成后停下，
 * 用户确认拆分结果再经 /:id/produce 将 mode 改回 full 启动生产（拆分与创作生成拆成两步）
 *
 * 持久化在 DB（production_batches / production_batch_items），服务重启自动续跑：
 * - 分集状态以 novels.split_status 为准（已完成跳过，残留的 splitting 重新触发）
 * - 生产复用 production.ts 的断点续跑能力（按 DB 状态推导剩余步骤）
 *
 * 实现模块：
 * - production-batch-loop.ts    执行引擎：进程内状态、单条目处理、滑动窗口 + 错峰主循环
 * - production-batch-queries.ts 查询层：批次详情、批次列表（只读）
 *
 * 并发策略：滑动窗口 + 错峰启动（BATCH_DRAMA_CONCURRENCY 控制并发数，BATCH_STAGGER_DELAY_MS 控制启动间隔）；
 * 默认 BATCH_DRAMA_CONCURRENCY=1（严格按上传顺序逐部推进，最省配额）；
 * 各环节内部 TPM/QPM 控制由 rate-config / generation 的闸门体系兜底。
 */
import { eq, and, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { logTaskError, logTaskProgress } from '../utils/task-logger.js'
import { isLoopActive, startLoop, setStop, setBatchStatus, getBatchRow } from './production-batch-loop.js'

export type { BatchMode, BatchStatus, BatchItemStatus } from './production-batch-loop.js'
export { isBatchLoopActive } from './production-batch-loop.js'
export { getBatchDetail, listBatches } from './production-batch-queries.js'

import type { BatchMode } from './production-batch-loop.js'

/** 创建批次与条目（上传/批量建项目路由调用）；splitPrompt 为拆分提示词快照，
 * opts 携带两步走模式与拆分方式快照（自模版复制，模版后续修改不影响在途批次） */
export async function createBatch(
  userId: number,
  items: Array<{ novelId: number; dramaId: number }>,
  targetChars?: number,
  splitPrompt?: string,
  opts: { mode?: BatchMode; splitMode?: 'chars' | 'paragraphs'; paragraphsPerEpisode?: number } = {},
): Promise<number> {
  const ts = now()
  const res = await db.insert(schema.productionBatches).values({
    userId, status: 'pending', targetChars: targetChars || null, splitPrompt: splitPrompt || null,
    mode: opts.mode === 'split_only' ? 'split_only' : 'full',
    splitMode: opts.splitMode === 'paragraphs' ? 'paragraphs' : 'chars',
    paragraphsPerEpisode: opts.splitMode === 'paragraphs' && opts.paragraphsPerEpisode ? Math.round(opts.paragraphsPerEpisode) : null,
    createdAt: ts, updatedAt: ts,
  })
  const batchId = getInsertId(res)
  await Promise.all(items.map((it, i) => db.insert(schema.productionBatchItems).values({
    batchId, seq: i + 1, novelId: it.novelId, dramaId: it.dramaId, status: 'pending',
  })))
  return batchId
}

export function startBatch(batchId: number): { started: boolean; already_running?: boolean } {
  if (isLoopActive(batchId)) return { started: false, already_running: true }
  void setBatchStatus(batchId, 'running', { started: true }).then(() => startLoop(batchId))
  return { started: true }
}

/** 两步走第二步：拆分完成确认后启动创作生产 — 将 split_only 批次改回 full 再启动主循环（幂等：已是 full 直接启动） */
export async function produceBatch(batchId: number): Promise<{ started: boolean; already_running?: boolean }> {
  const row = await getBatchRow(batchId)
  if (!row) throw new Error('批次不存在')
  if (row.mode === 'split_only') {
    await db.update(schema.productionBatches).set({ mode: 'full', updatedAt: now() })
      .where(eq(schema.productionBatches.id, batchId))
  }
  return startBatch(batchId)
}

/** 暂停批次：同步停住正在生产的短剧（在步骤检查点停下，续跑时可恢复） */
export function pauseBatch(batchId: number): boolean {
  if (!isLoopActive(batchId)) return false
  setStop(batchId, 'paused')
  return true
}

/** 取消批次：在途条目按 seq 逐个标记 cancelled */
export function cancelBatch(batchId: number): boolean {
  if (!isLoopActive(batchId)) return false
  setStop(batchId, 'cancelled')
  return true
}

/** 服务启动时续跑所有中断前处于 running 的批次 */
export async function resumeRunningBatches() {
  try {
    const rows = await db.select().from(schema.productionBatches)
      .where(and(eq(schema.productionBatches.status, 'running'), isNull(schema.productionBatches.deletedAt)))
    for (const row of rows) {
      logTaskProgress('ProductionBatch', 'resume', { batchId: row.id })
      startLoop(row.id)
    }
  } catch (err: any) {
    logTaskError('ProductionBatch', 'resume', { error: err?.message })
  }
}
