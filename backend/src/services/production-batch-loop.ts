/**
 * Drama Mill — AI 短剧生成平台
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
/*
 * Drama Mill — production-batch 执行引擎：状态管理、条目处理、批次滑动窗口主循环
 */
import { eq, and, asc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { startNovelSplit, getNovelSplitStatus, hasActiveSplitTask } from './novel-split.js'
import { startProduction, resumeProduction, pauseProduction, getProductionRun } from './production.js'
import { BATCH_DRAMA_CONCURRENCY, BATCH_STAGGER_DELAY_MS, BATCH_STOP_ON_ERROR } from '../utils/rate-config.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

export type BatchMode = 'full' | 'split_only'
export type BatchStatus = 'pending' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'
export type BatchItemStatus = 'pending' | 'splitting' | 'split_failed' | 'split_done' | 'producing' | 'done' | 'failed' | 'cancelled'

const RETRYABLE_ITEM_STATUSES: BatchItemStatus[] = ['pending', 'splitting', 'split_failed', 'split_done', 'producing', 'failed']
const SPLIT_ONLY_RETRYABLE_STATUSES: BatchItemStatus[] = ['pending', 'splitting', 'split_failed']

// ─── 进程内状态 ───
const activeLoops = new Set<number>()
const stopFlags = new Map<number, 'paused' | 'cancelled'>()

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const SPLIT_TIMEOUT_MS = 2 * 60 * 60 * 1000
const PRODUCE_TIMEOUT_MS = 24 * 60 * 60 * 1000

// ─── 状态读写 helper ───

async function getBatchRow(batchId: number) {
  const [row] = await db.select().from(schema.productionBatches).where(eq(schema.productionBatches.id, batchId))
  return row || null
}

async function setBatchStatus(batchId: number, status: BatchStatus, extra: { error?: string | null; started?: boolean; finished?: boolean } = {}) {
  const patch: Record<string, any> = { status, updatedAt: now() }
  if (extra.error !== undefined) patch.error = extra.error
  if (extra.started) patch.startedAt = now()
  if (extra.finished) patch.finishedAt = now()
  await db.update(schema.productionBatches).set(patch).where(eq(schema.productionBatches.id, batchId))
}

async function getItems(batchId: number) {
  return db.select().from(schema.productionBatchItems)
    .where(eq(schema.productionBatchItems.batchId, batchId)).orderBy(asc(schema.productionBatchItems.seq))
}

async function setItemStatus(itemId: number, status: BatchItemStatus, error?: string | null) {
  const patch: Record<string, any> = { status }
  if (error !== undefined) patch.error = error
  if (status === 'producing' || status === 'splitting') patch.startedAt = now()
  if (status === 'done' || status === 'failed' || status === 'split_failed' || status === 'cancelled') patch.finishedAt = now()
  await db.update(schema.productionBatchItems).set(patch).where(eq(schema.productionBatchItems.id, itemId))
}

function checkStop(batchId: number): 'paused' | 'cancelled' | null {
  return stopFlags.get(batchId) || null
}

// ─── 单条目处理 ───

async function ensureNovelSplit(
  novelId: number,
  targetChars: number | undefined,
  userId: number,
  batchId: number,
  splitPrompt?: string | null,
  splitMode?: 'chars' | 'paragraphs',
  paragraphsPerEpisode?: number | null,
) {
  const deadline = Date.now() + SPLIT_TIMEOUT_MS
  let triggered = false
  while (true) {
    const stop = checkStop(batchId)
    if (stop) throw new Error(`__STOP__${stop}`)
    const st = await getNovelSplitStatus(novelId)
    if (!st) throw new Error('小说记录不存在')
    if (st.status === 'split') return
    if (st.status === 'failed') throw new Error(`分集失败：${st.error || '未知错误'}`)
    if (st.status !== 'splitting' || !hasActiveSplitTask(novelId)) {
      if (!triggered) {
        await startNovelSplit(novelId, {
          targetChars, userId, splitPrompt: splitPrompt || undefined,
          splitMode, paragraphsPerEpisode: paragraphsPerEpisode ?? undefined,
        })
        triggered = true
      } else if (!hasActiveSplitTask(novelId)) {
        await sleep(3000)
        continue
      }
    }
    if (Date.now() > deadline) throw new Error('分集超时（2 小时）')
    await sleep(5000)
  }
}

async function waitDramaProduction(dramaId: number, batchId: number) {
  const deadline = Date.now() + PRODUCE_TIMEOUT_MS
  const res = startProduction(dramaId)
  if (!res.started && !res.already_running) throw new Error('生产启动失败')
  while (true) {
    const stop = checkStop(batchId)
    if (stop) throw new Error(`__STOP__${stop}`)
    const run = getProductionRun(dramaId)
    if (!run) {
      startProduction(dramaId)
    } else if (run.status === 'done') {
      return
    } else if (run.status === 'error') {
      throw new Error(run.error || '生产失败')
    } else if (run.status === 'paused') {
      await resumeProduction(dramaId)
    }
    if (Date.now() > deadline) throw new Error('生产超时（24 小时）')
    await sleep(10_000)
  }
}

async function processItem(
  item: { id: number; novelId: number; dramaId: number },
  batch: { id: number; mode: BatchMode; targetChars: number | null; userId: number; splitPrompt: string | null; splitMode: string | null; paragraphsPerEpisode: number | null },
) {
  logTaskStart('ProductionBatch', 'item', { batchId: batch.id, itemId: item.id, dramaId: item.dramaId, mode: batch.mode })
  try {
    await setItemStatus(item.id, 'splitting')
    await ensureNovelSplit(
      item.novelId, batch.targetChars ?? undefined, batch.userId, batch.id, batch.splitPrompt,
      batch.splitMode === 'paragraphs' ? 'paragraphs' : 'chars', batch.paragraphsPerEpisode,
    )
    if (batch.mode === 'split_only') {
      await setItemStatus(item.id, 'split_done')
      logTaskSuccess('ProductionBatch', 'item-split', { batchId: batch.id, itemId: item.id, dramaId: item.dramaId })
      return
    }
    await setItemStatus(item.id, 'producing')
    await waitDramaProduction(item.dramaId, batch.id)
    await setItemStatus(item.id, 'done')
    logTaskSuccess('ProductionBatch', 'item', { batchId: batch.id, itemId: item.id, dramaId: item.dramaId })
  } catch (err: any) {
    const msg: string = err?.message || '未知错误'
    if (msg.startsWith('__STOP__')) throw err
    const failedAt = msg.startsWith('分集') ? 'split_failed' : 'failed'
    await setItemStatus(item.id, failedAt as BatchItemStatus, msg)
    logTaskError('ProductionBatch', 'item', { batchId: batch.id, itemId: item.id, dramaId: item.dramaId, error: msg })
    if (BATCH_STOP_ON_ERROR) throw new Error(`__STOP__cancelled`)
  }
}

// ─── 批次主循环 ───

async function batchLoop(batchId: number) {
  if (activeLoops.has(batchId)) return
  activeLoops.add(batchId)
  stopFlags.delete(batchId)
  logTaskStart('ProductionBatch', 'loop', { batchId, concurrency: BATCH_DRAMA_CONCURRENCY })
  try {
    while (true) {
      const stop = checkStop(batchId)
      if (stop === 'paused') {
        await setBatchStatus(batchId, 'paused')
        logTaskProgress('ProductionBatch', 'paused', { batchId })
        return
      }
      if (stop === 'cancelled') {
        const items = await getItems(batchId)
        for (const it of items) {
          if (it.status === 'pending' || it.status === 'splitting' || it.status === 'producing') {
            await setItemStatus(it.id, 'cancelled')
          }
        }
        await setBatchStatus(batchId, 'cancelled', { finished: true })
        logTaskProgress('ProductionBatch', 'cancelled', { batchId })
        return
      }

      const items = await getItems(batchId)
      const batchModeRow = await getBatchRow(batchId)
      if (!batchModeRow) return
      const retryableStatuses = batchModeRow.mode === 'split_only' ? SPLIT_ONLY_RETRYABLE_STATUSES : RETRYABLE_ITEM_STATUSES
      const runnable = items.filter(it => retryableStatuses.includes(it.status as BatchItemStatus))

      if (!runnable.length) {
        await setBatchStatus(batchId, 'done', { finished: true })
        logTaskSuccess('ProductionBatch', 'loop', { batchId, total: items.length, failed: items.filter(i => i.status === 'failed' || i.status === 'split_failed').length })
        return
      }

      let idx = 0
      const running = new Set<Promise<void>>()
      let fatalError: Error | null = null

      while (idx < runnable.length || running.size > 0) {
        if (fatalError) throw fatalError
        const stop = checkStop(batchId)
        if (stop) throw new Error(`__STOP__${stop}`)
        const batch = await getBatchRow(batchId)
        if (!batch) return

        while (running.size < Math.max(1, BATCH_DRAMA_CONCURRENCY) && idx < runnable.length) {
          const it = runnable[idx++]
          if (BATCH_STAGGER_DELAY_MS > 0 && running.size > 0) {
            await sleep(BATCH_STAGGER_DELAY_MS)
          }
          const p = processItem(
            { id: it.id, novelId: it.novelId, dramaId: it.dramaId },
            {
              id: batchId,
              mode: (batch.mode as BatchMode) || 'full',
              targetChars: batch.targetChars,
              userId: batch.userId,
              splitPrompt: batch.splitPrompt,
              splitMode: batch.splitMode,
              paragraphsPerEpisode: batch.paragraphsPerEpisode,
            }
          ).catch((err: any) => {
            if (err?.message?.startsWith('__STOP__')) {
              fatalError = err
            }
          }).finally(() => running.delete(p))
          running.add(p)
        }
        if (running.size > 0) {
          await Promise.race(running)
        }
      }
    }
  } catch (err: any) {
    const msg: string = err?.message || '未知错误'
    if (msg === '__STOP__paused') {
      await setBatchStatus(batchId, 'paused')
    } else if (msg === '__STOP__cancelled') {
      const items = await getItems(batchId)
      for (const it of items) {
        if (it.status === 'pending' || it.status === 'splitting' || it.status === 'producing') {
          await setItemStatus(it.id, 'cancelled')
        }
      }
      await setBatchStatus(batchId, 'cancelled', { finished: true })
    } else {
      await setBatchStatus(batchId, 'error', { error: msg, finished: true })
      logTaskError('ProductionBatch', 'loop', { batchId, error: msg })
    }
  } finally {
    activeLoops.delete(batchId)
    stopFlags.delete(batchId)
  }
}

/** 暂停/取消批次时同步停住正在生产的短剧 */
async function pauseProducingItems(batchId: number) {
  try {
    const items = await getItems(batchId)
    for (const it of items) {
      if (it.status === 'producing') pauseProduction(it.dramaId)
    }
  } catch {}
}

// ─── 供核心模块调用的接口 ───

export function isLoopActive(batchId: number): boolean { return activeLoops.has(batchId) }
export { isLoopActive as isBatchLoopActive }
export function clearStop(batchId: number) { stopFlags.delete(batchId) }
export function startLoop(batchId: number) { clearStop(batchId); void batchLoop(batchId) }
export function setStop(batchId: number, reason: 'paused' | 'cancelled') { stopFlags.set(batchId, reason); void pauseProducingItems(batchId) }
export { setBatchStatus, getBatchRow }
