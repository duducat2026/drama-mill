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
 * 统一生成任务服务（对外门面 + 执行主流程）
 * 图片/视频共用 sys_task 表和同一条任务生命周期：
 * 建任务(processing) → 适配器组请求 → 提交上游 → 同步回写或转异步轮询 → 落盘回填业务表。
 *
 * 实现按职责拆成兄弟模块（依赖单向，循环点在底部 setTaskProcessor 注入处收口）：
 * - generation-queue.ts      并发槽位 + 按模型分队列（执行函数由本模块注入）
 * - generation-gateway.ts    网关速率闸门与 429 退避重试
 * - generation-router.ts     上游水位闸 & 多视频模型分流
 * - generation-selfheal.ts   提交预检、配置故障自愈与 failTask
 * - generation-poll.ts       异步轮询与完成落库
 * - generation-helpers.ts    完成计价与图片资产回写
 * - generation-recovery.ts   重启恢复 / 历史探测 / 重试
 * - generation-watchdog-queries.ts  看门狗取数（超时判定/卡死/可重提清单）
 * - generation-shared.ts     类型/节奏/测试标记等共享基础件（不回依赖）
 * - generation-generate.ts   图片/视频生成任务提交入口
 */
import { db, getInsertId, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { getImageAdapter, getVideoAdapter } from './adapters/registry'
import type { AIConfig, ImageGenerationRecord } from './adapters/types'
import { normalizeReferenceImages, normalizeVideoReferenceUrl, normalizeVideoReferenceUrls, resolvePublicMediaUrls } from './generation-refs.js'
import { failTask, isConfigTestTask, maybeHandleConfigFailure, preSubmitVideoPrecheck } from './generation-selfheal.js'
import { assertAiCallEnabled, isAiCallEnabled, AI_CALL_DISABLED_MESSAGE } from './ai-switch.js'
import { logTaskPayload, logTaskProgress, logTaskStart, logTaskWarn, redactUrl } from '../utils/task-logger.js'
import { setTaskProcessor } from './generation-queue.js'
import { handleImageComplete, handleImageCompleteBase64, handleVideoComplete, markPolling, pollTaskTracked } from './generation-poll.js'
import { submitWithRetry } from './generation-gateway.js'
import { parseTaskParams, taskLabel } from './generation-shared.js'
import { pickLeastLoadedVideoModel, waitForUpstreamWatermark } from './generation-router.js'
import type { SysTaskRecord, TaskType } from './generation-shared.js'

// ─── 对外 API 门面：原单文件时代的全部导出在此收口，外部从本文件或各职责模块 import 皆可 ───
export type { SysTaskRecord, TaskType } from './generation-shared.js'
export { CONFIG_TEST_MAX_MS, isConfigTestParams, parseTaskParams, POLL_PROFILES, taskLabel } from './generation-shared.js'
export { beginPolling, createTask, endPolling, enqueueExecution, getTaskQueueStats, pollingCount, setTaskProcessor } from './generation-queue.js'
export { getGatewayRateStats } from './generation-gateway.js'
export { isModelCompatibleWithMedia, pickLeastLoadedVideoModel, waitForUpstreamWatermark } from './generation-router.js'
export { failTask, isAssetExpiryError, isConfigTestTask, isUnpurchasedError, maybeHandleConfigFailure, preSubmitVideoPrecheck, requeueExpiredAssetTask, resolveResumeConfig } from './generation-selfheal.js'
export { handleImageComplete, handleImageCompleteBase64, handleVideoComplete, markPolling, pollTask, pollTaskTracked, writeBackImageAssets } from './generation-poll.js'
export { recordTaskUsage, resolveTaskEpisodeId } from './generation-helpers.js'
export { probeHistoricalTask, resumeInterruptedTasks, retryTask } from './generation-recovery.js'
export { findStuckVideoTasks, getFailedTasksForAutoRetry, isPermanentError } from './generation-watchdog-queries.js'
export { generateConfigTest, generateImage, generateVideo } from './generation-generate.js'
export { submitWithRetry } from './generation-gateway.js'



// ─── 执行主流程：开关校验 → 预检 → 分流 → 组请求 → 限流提交 → 同步完成或转轮询 ───

/** 参考图清单里的有效 URL 条数；兼容数组与 JSON 字符串两种存量形态，坏 JSON 按单张计 */
function countValidUrls(raw: unknown): number {
  const of = (list: unknown) =>
    Array.isArray(list) ? list.filter((u: any) => typeof u === 'string' && u.trim()).length : 0
  if (Array.isArray(raw)) return of(raw)
  if (typeof raw === 'string' && raw.trim()) {
    try { return of(JSON.parse(raw)) } catch { return 1 }
  }
  return 0
}

/** 多视频模型分流：按上游在途量挑一个素材形态兼容且压力最小的模型，改写任务并落库；未换模型返回 null */
async function balanceVideoModel(
  id: number, config: AIConfig, record: SysTaskRecord, params: Record<string, any>,
): Promise<SysTaskRecord | null> {
  const media = {
    hasReferenceImages: countValidUrls(params.referenceImageUrls) > 0,
    hasFirstFrame: !!(params.firstFrameUrl || params.imageUrl),
  }
  const picked = await pickLeastLoadedVideoModel(id, config, record.model || config.model, media)
  if (!picked || picked === record.model) return null
  record = { ...record, model: picked }
  await db.update(schema.sysTask)
    .set({ model: picked, updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  return record
}

/** 图片任务：归一化参考图后交给图片适配器组请求 */
async function buildImageRequest(config: AIConfig, record: SysTaskRecord, params: Record<string, any>) {
  const adapter = getImageAdapter(config.provider)
  const refs = await normalizeReferenceImages(params.referenceImages)
  const imageRecord: ImageGenerationRecord = {
    id: record.id,
    model: record.model,
    prompt: record.prompt,
    size: params.size,
    frameType: params.frameType,
    referenceImages: refs.length ? JSON.stringify(refs) : null,
  }
  return { adapter, imageRecord, request: adapter.buildGenerateRequest(config, imageRecord) }
}

/** 视频任务：首尾帧/参考图走 dataURL 归一化，参考视频/音频文件太大只解析成公网 URL */
async function buildVideoRequest(config: AIConfig, record: SysTaskRecord, params: Record<string, any>) {
  const adapter = getVideoAdapter(config.provider)
  const refImages = await normalizeVideoReferenceUrls(params.referenceImageUrls)
  const refVideos = resolvePublicMediaUrls(params.referenceVideoUrls, 'video')
  const refAudios = resolvePublicMediaUrls(params.referenceAudioUrls, 'audio')
  const request = adapter.buildGenerateRequest(config, {
    id: record.id,
    model: record.model,
    prompt: record.prompt,
    referenceMode: params.referenceMode,
    imageUrl: await normalizeVideoReferenceUrl(params.imageUrl),
    firstFrameUrl: await normalizeVideoReferenceUrl(params.firstFrameUrl),
    lastFrameUrl: await normalizeVideoReferenceUrl(params.lastFrameUrl),
    referenceImageUrls: refImages.length ? JSON.stringify(refImages) : null,
    referenceVideoUrls: refVideos.length ? JSON.stringify(refVideos) : null,
    referenceAudioUrls: refAudios.length ? JSON.stringify(refAudios) : null,
    generateAudio: params.generateAudio,
    duration: params.duration,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
  })
  return { adapter, request }
}

/** 常规 HTTP 提交：非 2xx 把状态码和响应体一起抛出（供失败分类识别 not_found/rate_limit 等） */
async function postProviderRequest(req: { url: string; method: string; headers: Record<string, string>; body: unknown }) {
  const resp = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(600_000),
  })
  if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`)
  return await resp.json() as any
}

async function processTask(id: number, config: AIConfig) {
  try {
    let [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (!record) return
    // 排队期间状态已被改写（重复任务被合并/判失败）：本轮直接作废，不再提交上游
    if (record.status !== 'processing') {
      logTaskWarn(taskLabel(record.type as TaskType), 'skip-non-processing', { id, status: record.status })
      return
    }
    const type = record.type as TaskType
    const label = taskLabel(type)
    const params = parseTaskParams(record.params)

    // 排队/重排期间用户关闭了模型调用总开关：不提交上游，直接判失败并说明原因（重新打开后可重试）。
    // 放在此处而非配置解析处：覆盖手动重试、看门狗自动重提、素材失效重排、重启恢复重跑等全部提交路径。
    if (!await isAiCallEnabled(record.userId)) {
      await failTask(id, AI_CALL_DISABLED_MESSAGE)
      return
    }

    // 提交前本地预检（仅视频）：明显会被上游内容审核拒绝的提示词就地拦截/修正，
    // 无效提交白占上游排队（排完队才被判失败会整轮作废）
    if (type === 'video') {
      const fixedPrompt = await preSubmitVideoPrecheck(record, params)
      if (fixedPrompt) {
        const [latest] = await db.select({ params: schema.sysTask.params }).from(schema.sysTask).where(eq(schema.sysTask.id, id))
        Object.assign(params, parseTaskParams(latest?.params))
        record = { ...record, prompt: fixedPrompt }
      }
    }

    // 多模型分流（仅视频）：配置勾了多个模型时把任务派给压力最小的兼容模型池；
    // 用户锁定模型（noBalance）则跳过分流，严格按任务落库模型提交
    if (type === 'video' && params.noBalance) {
      logTaskProgress(label, 'model-locked', { id, model: record.model || config.model })
    } else if (type === 'video') {
      const balanced = await balanceVideoModel(id, config, record, params)
      if (balanced) record = balanced
    }

    logTaskProgress(label, 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      sceneId: record.sceneId,
      characterId: record.characterId,
    })

    const imageCall = type === 'image' ? await buildImageRequest(config, record, params) : null
    const videoCall = type === 'video' ? await buildVideoRequest(config, record, params) : null
    const request = (imageCall || videoCall)!.request
    const { url, method, headers, body } = request

    logTaskProgress(label, 'request', {
      id,
      provider: config.provider,
      method,
      url: redactUrl(url),
      model: record.model,
    })
    logTaskPayload(label, 'request payload', { id, method, url, headers, body })

    // 水位闸门：上游 PENDING 达水位线时暂缓提交，降回去再放行（仅百炼视频）
    if (type === 'video') await waitForUpstreamWatermark(id, config, record.model || config.model)

    let result: any
    if (imageCall?.adapter.executeGenerate) {
      // 流式模型（如百炼 wan2.6-image）由适配器自己消费 SSE 并收敛结果；限流退避同样要走 submitWithRetry
      logTaskProgress(label, 'stream-request', { id, provider: config.provider, url: redactUrl(url), model: record.model })
      result = await submitWithRetry(
        () => imageCall.adapter.executeGenerate!(config, imageCall.imageRecord),
        label, id, config, !!params.configTest, record.userId)
    } else {
      result = await submitWithRetry(
        () => postProviderRequest(request),
        label, id, config, !!params.configTest, record.userId)
    }
    logTaskPayload(label, 'response payload', { id, provider: config.provider, result })

    if (type === 'image') {
      const { isAsync, taskId, imageUrl } = imageCall!.adapter.parseGenerateResponse(result)
      if (!isAsync) {
        if (imageUrl) {
          logTaskProgress(label, 'sync-complete', { id, imageUrl })
          await handleImageComplete(record, imageUrl)
          return
        }
        // 同步返回但没 URL：Gemini 这类直接回 base64，走 base64 落盘分支
        const b64 = imageCall!.adapter.extractImageBase64(result)
        if (b64) {
          logTaskProgress(label, 'sync-base64-complete', { id, mimeType: b64.mimeType })
          await handleImageCompleteBase64(record, b64.data, b64.mimeType)
          return
        }
        throw new Error('No image URL or base64 data in response')
      }
      await markPolling(id, taskId)
      pollTaskTracked(record, config, taskId!)
      return
    }

    const { isAsync, taskId, videoUrl } = videoCall!.adapter.parseGenerateResponse(result)
    if (!isAsync && videoUrl) {
      logTaskProgress(label, 'sync-complete', { id, videoUrl })
      await handleVideoComplete(record, videoUrl, params.duration)
      return
    }

    await markPolling(id, taskId)
    pollTaskTracked(record, config, taskId!)
  } catch (err: any) {
    // 配置故障识别（提交阶段同步返回）：模型未开通这类重提也不会成功的错误，
    // 解掉集级配置锁定后自动重排到可用配置，不让无效配置持续吃队列槽位；无可换配置时才落失败交人工
    if (await maybeHandleConfigFailure(id, err.message)) return
    await failTask(id, err.message)
  }
}

// 拆分收口：把 processTask 注入队列模块，避免 queue ↔ 核心之间的静态循环依赖
setTaskProcessor(processTask)
