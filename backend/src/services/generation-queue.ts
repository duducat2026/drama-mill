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
 * 生成任务并发队列（拆分自 generation.ts）：图片/视频独立槽位上限 + 按「类型|模型」独立队列。
 * processTask 由核心模块注入（setTaskProcessor），避免队列 ↔ 执行链的静态循环依赖。
 */
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { logTaskError, logTaskProgress } from '../utils/task-logger.js'
import { GEN_MAX_CONCURRENT_IMAGE, GEN_MAX_CONCURRENT_VIDEO } from '../utils/rate-config.js'
import type { AIConfig } from './adapters/types'
import { taskLabel } from './generation-shared.js'
export { taskLabel }
import type { SysTaskRecord, TaskType } from './generation-shared.js'

export type { SysTaskRecord, TaskType }

// ─── 并发控制：图片/视频各自独立的槽位上限（QPM 敏感，分开调节）；每个模型独立队列，避免不同模型混排互相阻塞 ───

const MAX_BY_TYPE: Record<TaskType, number> = {
  image: GEN_MAX_CONCURRENT_IMAGE,
  video: GEN_MAX_CONCURRENT_VIDEO,
}
const runningByType: Record<TaskType, number> = { image: 0, video: 0 }
interface QueuedSlot { type: TaskType; model: string; provider: string; enqueuedAt: number; resume: () => void }
// 按「类型|模型」分队列：不同模型不混排，慢模型/被退避限流的模型的积压不会堵住其他模型的任务；队列内保持 FIFO（taskQueues 键为 类型|模型）
const taskQueues = new Map<string, QueuedSlot[]>()
const queueKey = (type: TaskType, model: string) => `${type}|${model}`
const totalQueued = () => [...taskQueues.values()].reduce((n, q) => n + q.length, 0)
const totalRunning = () => runningByType.image + runningByType.video

// processTask 由 generation.ts 注入：占槽位执行（异步轮询阶段不占槽位），失败兑底落库
let taskProcessor: ((id: number, config: AIConfig) => Promise<void>) | null = null

export function setTaskProcessor(fn: (id: number, config: AIConfig) => Promise<void>) { taskProcessor = fn }

// 入队执行：model 决定排哪条队列，provider 供网关维度统计
export function enqueueExecution(id: number, config: AIConfig, type: TaskType, model: string) {
  void withTaskSlot(type, model, config.provider, () => taskProcessor!(id, config)).catch(err => {
    logTaskError('SysTask', 'process', { id, error: err.message })
    console.error(`SysTask ${id} failed:`, err)
  })
}

/** 满槽提示：创建任务时若该类型已满，记录排队日志（原 createTask 内联判定） */
export function logQueueWait(type: TaskType, id: number, model: string) {
  if (runningByType[type] >= MAX_BY_TYPE[type]) {
    logTaskProgress(taskLabel(type), 'queue-wait', { id, model, running: runningByType[type], queued: totalQueued() + 1, max: MAX_BY_TYPE[type] })
  }
}

// 轮询在途量跟踪：已提交上游、正在轮询等待结果的任务数（不占并发槽位，供面板展示）
export const pollingCount: Record<TaskType, number> = { image: 0, video: 0 }

export function beginPolling(type: TaskType) { pollingCount[type]++ }
export function endPolling(type: TaskType) { pollingCount[type]-- }

export function getTaskQueueStats() {
  const byModel: Record<string, { type: TaskType; queued: number }> = {}
  const byGateway: Record<string, { queued: number; models: string[] }> = {}
  for (const [key, q] of taskQueues) {
    if (!q.length) continue
    const [type, model] = key.split('|')
    byModel[model] = { type: type as TaskType, queued: q.length }
    // 按网关（百炼/火山等）聚合排队长度：取队内任务的 provider（同一模型队列必属同一网关）
    const gw = q[0].provider
    const entry = byGateway[gw] || { queued: 0, models: [] }
    entry.queued += q.length
    if (!entry.models.includes(model)) entry.models.push(model)
    byGateway[gw] = entry
  }
  return {
    running: totalRunning(),
    queued: totalQueued(),
    max: MAX_BY_TYPE.image + MAX_BY_TYPE.video,
    polling: pollingCount.image + pollingCount.video,
    by_type: {
      image: { running: runningByType.image, polling: pollingCount.image, max: MAX_BY_TYPE.image },
      video: { running: runningByType.video, polling: pollingCount.video, max: MAX_BY_TYPE.video },
    },
    by_model: byModel,
    by_gateway: byGateway,
  }
}

/** 槽位派发：所有模型队列中，取“队首等待最久且所属类型仍有余量”的任务放行（派发时即占槽，防超发）。
 * 每次派发后该队列队首更新为更晚的入队时间，多模型自然交替获得槽位，不会相互阻塞 */
function releaseNextSlot() {
  let best: { key: string; slot: QueuedSlot } | null = null
  for (const [key, queue] of taskQueues) {
    const head = queue[0]
    if (!head || runningByType[head.type] >= MAX_BY_TYPE[head.type]) continue
    if (!best || head.enqueuedAt < best.slot.enqueuedAt) best = { key, slot: head }
  }
  if (!best) return
  taskQueues.get(best.key)!.shift()
  runningByType[best.slot.type]++
  best.slot.resume()
}

async function withTaskSlot<T>(type: TaskType, model: string, provider: string, fn: () => Promise<T>): Promise<T> {
  if (runningByType[type] >= MAX_BY_TYPE[type]) {
    // 排队：进本模型自己的队列，槽位在 releaseNextSlot 派发时认领，醒来即持有，无需再自增
    await new Promise<void>(resolve => {
      const key = queueKey(type, model)
      const queue = taskQueues.get(key) || []
      queue.push({ type, model, provider, enqueuedAt: Date.now(), resume: resolve })
      taskQueues.set(key, queue)
    })
  } else {
    runningByType[type]++
  }
  try {
    return await fn()
  } finally {
    runningByType[type]--
    releaseNextSlot()
  }
}

export async function createTask(
  type: TaskType,
  config: AIConfig,
  fields: {
    storyboardId?: number
    dramaId?: number
    sceneId?: number
    characterId?: number
    propId?: number
    prompt: string
    model?: string | null
    userId?: number
  },
  params: Record<string, unknown>,
): Promise<number> {
  const ts = now()
  const res = await db.insert(schema.sysTask).values({
    type,
    ...fields,
    provider: config.provider,
    // configId 随参数落库：完成时成本计价归属用（重启恢复链路也可复用）
    params: JSON.stringify({ ...params, configId: config.configId ?? null }),
    status: 'processing',
    createdAt: ts,
    updatedAt: ts,
  })

  const id = getInsertId(res)
  if (runningByType[type] >= MAX_BY_TYPE[type]) {
    logTaskProgress(taskLabel(type), 'queue-wait', { id, model: fields.model || config.model, running: runningByType[type], queued: totalQueued() + 1, max: MAX_BY_TYPE[type] })
  }
  enqueueExecution(id, config, type, fields.model || config.model)
  return id
}
