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

/**
 * 任务恢复链路（拆分自 generation.ts）：重启恢复中断任务、历史任务结果探测、失败任务重试。
 */
import { db, schema } from '../db/index.js'
import { and, eq } from 'drizzle-orm'
import { getResumeConfigById } from './ai.js'
import { assertAiCallEnabled } from './ai-switch.js'
import { now } from '../utils/response.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import { VIDEO_TASK_HARD_LIMIT_MS } from '../utils/rate-config.js'
import { ABANDONED_RETRY_COUNT, isAbandonedTask } from './runtime-config.js'
import { getImageAdapter, getVideoAdapter } from './adapters/registry'
import { beginPolling, endPolling, enqueueExecution, taskLabel } from './generation-queue.js'
import { isConfigTestParams, parseTaskParams, CONFIG_TEST_MAX_MS } from './generation.js'
import type { TaskType } from './generation.js'
import { failTask, resolveResumeConfig } from './generation-selfheal.js'
import { handleImageComplete, handleVideoComplete, pollTask, pollTaskTracked } from './generation-poll.js'

/**
 * 服务重启后恢复中断的生成任务（任务已落库，不因进程重启而作废）：
 * - 已有上游 task_id（异步轮询中）→ 继续轮询
 * - 无 task_id（同步/流式请求被中断）→ 重新执行生成
 */
export async function resumeInterruptedTasks() {
  const rows = await db.select().from(schema.sysTask).where(eq(schema.sysTask.status, 'processing'))
  if (!rows.length) return

  let resumed = 0
  for (const record of rows) {
    const type = record.type as TaskType
    // 硬性墙钟：超龄视频任务不再复活（重提也必然失败，白耗并发槽位与配额），直接判失败并放弃，阻断重启复活循环。
    if (type === 'video' && record.createdAt) {
      const ageMs = Date.now() - new Date(record.createdAt).getTime()
      if (ageMs >= VIDEO_TASK_HARD_LIMIT_MS) {
        await failTask(record.id, `硬性超时：任务运行超过 ${Math.round(VIDEO_TASK_HARD_LIMIT_MS / 60_000)} 分钟，已强制判失败`, { abandon: true })
        continue
      }
    }
    // 单次生成测试：只按落库 configId 精确恢复「继续取结果」，绝不重新提交（重提等于再花一次测试费）
    const testParams = parseTaskParams(record.params)
    if (isConfigTestParams(testParams)) {
      const testAgeMs = record.createdAt ? Date.now() - new Date(record.createdAt).getTime() : 0
      if (!record.taskId || testAgeMs >= CONFIG_TEST_MAX_MS) {
        await failTask(record.id, record.taskId
          ? `生成测试超时：任务运行超过 ${Math.round(CONFIG_TEST_MAX_MS / 60_000)} 分钟未完成`
          : '服务重启，生成测试已中断，请到「设置中心 → AI 服务」重新发起一次测试')
        continue
      }
      const locked = testParams.configId ? await getResumeConfigById(Number(testParams.configId)) : null
      if (!locked) {
        await failTask(record.id, '生成测试所用的配置已停用或删除，无法继续取回结果')
        continue
      }
      resumed++
      logTaskProgress(taskLabel(type), 'resume-test-poll', { id: record.id, taskId: record.taskId, configId: locked.configId })
      beginPolling(type)
      pollTask(record, locked, record.taskId).catch(err => {
        logTaskError(taskLabel(type), 'resume-test-poll', { id: record.id, error: err.message })
      }).finally(() => { endPolling(type) })
      continue
    }
    const config = await resolveResumeConfig(type, record.provider, record.userId)
    if (!config) {
      await failTask(record.id, '服务重启，生成任务中断，请重试')
      continue
    }
    resumed++
    if (record.taskId) {
      logTaskProgress(taskLabel(type), 'resume-poll', { id: record.id, taskId: record.taskId })
      beginPolling(type)
      pollTask(record, config, record.taskId).catch(err => {
        logTaskError(taskLabel(type), 'resume-poll', { id: record.id, error: err.message })
      }).finally(() => { endPolling(type) })
    } else {
      logTaskProgress(taskLabel(type), 'resume-rerun', { id: record.id, provider: config.provider })
      enqueueExecution(record.id, config, type, record.model || config.model)
    }
  }
  if (resumed) console.log(`🔁 已恢复 ${resumed} 个中断的生成任务`)
}

/** 历史任务探测：单次轮询请求超时上限（探测多为轻量 GET，超时即视为探测失败转重提） */
const HISTORICAL_PROBE_TIMEOUT_MS = 15_000

/**
 * 历史任务结果探测：用任务落库时保存的上游 task_id 单次查询上游结果。
 * 适用「我方已判失败但上游可能仍在生成/已生成完」的任务，避免重提重复计费：
 * - completed → 直接走完成链路（下载/落库/计价/回写），返回 'completed'
 * - 仍在生成 → 恢复轮询（不占自动重试额度），返回 'pending'
 * - 上游已失败/记录已不存在/网络错误 → 返回 'resubmit' 由调用方重新提交（不更新错误信息，保留原判失败原因）
 */
export async function probeHistoricalTask(id: number): Promise<'completed' | 'pending' | 'resubmit'> {
  const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!record || record.status === 'completed') return 'resubmit'
  if (!record.taskId) return 'resubmit'
  // 硬性墙钟检查：超过上限的任务不再探测恢复轮询，直接走重提流程
  // （上游队列永久 PENDING 时探测也会返回 pending，导致无限循环恢复轮询）
  if (record.type === 'video' && record.createdAt) {
    const ageMs = Date.now() - new Date(record.createdAt).getTime()
    if (ageMs >= VIDEO_TASK_HARD_LIMIT_MS) return 'resubmit'
  }

  const type = record.type as TaskType
  const label = taskLabel(type)
  const config = await resolveResumeConfig(type, record.provider, record.userId)
  if (!config) return 'resubmit'

  const adapter = type === 'image' ? getImageAdapter(config.provider) : getVideoAdapter(config.provider)
  try {
    const { url, method, headers } = adapter.buildPollRequest(config, record.taskId)
    logTaskProgress(label, 'probe-historical', { id, taskId: record.taskId, provider: config.provider })
    const resp = await fetch(url, { method, headers, signal: AbortSignal.timeout(HISTORICAL_PROBE_TIMEOUT_MS) })
    if (!resp.ok) return 'resubmit'
    const result = await resp.json() as any
    const pollResp: any = adapter.parsePollResponse(result)

    if (pollResp.status === 'completed') {
      if (type === 'video' ? !pollResp.videoUrl : !pollResp.imageUrl) return 'resubmit'
      // markTaskCompleted 仅对 processing 写终态：先由 failed 翻回 processing，翻不动说明已被并发流程接管，直接视为救回
      const [rs] = await db.update(schema.sysTask)
        .set({ status: 'processing', errorMsg: null, updatedAt: now() })
        .where(and(eq(schema.sysTask.id, id), eq(schema.sysTask.status, 'failed')))
      if ((rs?.affectedRows ?? 0) === 0) return 'completed'
      if (type === 'video') {
        logTaskSuccess(label, 'probe-historical-complete', { id, taskId: record.taskId, videoUrl: pollResp.videoUrl })
        await handleVideoComplete(record, pollResp.videoUrl!, null)
        return 'completed'
      }
      logTaskSuccess(label, 'probe-historical-complete', { id, taskId: record.taskId, imageUrl: pollResp.imageUrl })
      await handleImageComplete(record, pollResp.imageUrl!)
      return 'completed'
    }
    if (pollResp.status === 'failed') {
      // 上游同样判失败：重提大概率同因失败，仅记录不再改错误信息，交由调用方决策是否重提
      logTaskWarn(label, 'probe-historical-failed', { id, taskId: record.taskId, error: pollResp.error || 'upstream failed' })
      return 'resubmit'
    }
    // 上游仍在生成：恢复轮询继续等待结果（不消耗重试额度，不算一次重提）
    logTaskProgress(label, 'probe-historical-pending', { id, taskId: record.taskId })
    await db.update(schema.sysTask)
      .set({ status: 'processing', errorMsg: null, updatedAt: now() })
      .where(and(eq(schema.sysTask.id, id), eq(schema.sysTask.status, 'failed')))
    pollTaskTracked(record, config, record.taskId)
    return 'pending'
  } catch (err: any) {
    // 上游记录已过期/网络错误：探测失败回退重提
    logTaskWarn(label, 'probe-historical-error', { id, taskId: record.taskId, error: err?.message || String(err) })
    return 'resubmit'
  }
}

/**
 * 重试失败任务：重置为 processing 后重新入队执行（复用原参数与原厂商配置）
 * - 自动恢复重提（auto=true）：重试计数 +1，达上限后不再自动重提，留给人工处理
 * - 手动重试：计数归零重新计次（用户主动接管，重新获得自动恢复额度）
 * - 前置探测：仍持有上游 task_id 的任务先探一次历史结果，救回则不再重新提交（避免重复计费）
 */
export async function retryTask(id: number, opts: { auto?: boolean } = {}): Promise<number> {
  const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!record) throw new Error('任务不存在')
  if (record.status === 'processing') throw new Error('任务执行中，无需重试')
  if (record.status === 'completed') throw new Error('任务已完成，无需重试')
  // 人工放弃的任务（管理后台标记）不允许直接重试，需先复活，防止无法处理的任务被反复提交
  if (isAbandonedTask(record.retryCount)) throw new Error('任务已被放弃，请先在管理后台“复活”该任务')
  // 单次生成测试任务不可重试：测试语义是「一次调用一份结果」，重提会重复计费且结果仍属同一配置
  if (isConfigTestParams(parseTaskParams(record.params))) {
    throw new Error('生成测试任务不支持重试，请到「设置中心 → AI 服务」重新发起一次测试')
  }

  // 前置探测旧上游任务：仍在生成则恢复轮询等结果，已出结果则直接完成，均不消耗重试额度也不重新提交；
  // 探测异常/上游已失败则继续走下方重提流程（不更新错误信息，保留原判失败原因）
  if (record.taskId) {
    const probe = await probeHistoricalTask(id)
    if (probe !== 'resubmit') {
      logTaskStart(taskLabel(record.type as TaskType), probe === 'completed' ? 'probe-rescued' : 'probe-resume-poll', { id, taskId: record.taskId })
      return id
    }
  }

  const type = record.type as TaskType
  // 重提前过模型调用总开关：关闭时直接抛错，不把任务置为 processing 后空跑一轮
  // （上方的历史结果探测/恢复轮询属在途任务取结果，不受开关影响）
  await assertAiCallEnabled(record.userId)
  const config = await resolveResumeConfig(type, record.provider, record.userId)
  if (!config) throw new Error('未找到可用的 AI 配置，请先到「设置」页启用服务')

  const retryCount = opts.auto ? (record.retryCount || 0) + 1 : 0
  await db.update(schema.sysTask)
    .set({ status: 'processing', errorMsg: null, taskId: null, retryCount, updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  // 场景资产状态回到 processing，与任务生命周期保持一致
  if (record.sceneId) {
    await db.update(schema.scenes)
      .set({ status: 'processing', updatedAt: now() })
      .where(eq(schema.scenes.id, record.sceneId))
  }
  logTaskStart(taskLabel(type), opts.auto ? 'auto-retry' : 'retry', { id, provider: config.provider, model: record.model, retryCount })
  enqueueExecution(id, config, type, record.model || config.model)
  return id
}
