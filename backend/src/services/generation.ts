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
 * 统一生成任务服务 — 图片/视频生成共用 sys_task 表与同一条生命周期：
 * 创建(processing) → 适配器构建请求 → 同步完成或异步轮询 → 下载落盘 → 回写业务表
 *
 * 拆分结构（按职责单向依赖，循环点在本文件收口）：
 * - generation-queue.ts      并发槽位与按模型分队列（processTask 由本模块注入）
 * - generation-gateway.ts    网关速率闸门与 429 退避
 * - generation-router.ts     上游水位闸 & 多视频模型分流
 * - generation-selfheal.ts   提交预检与配置故障自愈、failTask
 * - generation-poll.ts       异步轮询与完成落库
 * - generation-helpers.ts    完成计价与图片资产回写
 * - generation-recovery.ts   重启恢复 / 历史探测 / 重试
 * - generation-watchdog-queries.ts  看门狗取数（超时判定/卡死/可重提清单）
 * - generation-shared.ts       类型/节奏/测试标记等共享基础件（无回环）
 * - generation-generate.ts     图片/视频生成任务提交入口
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

// ─── 对外 API 收口：原 generation.ts 的全部导出保持兼容（外部按职责模块或本文件 import 均可） ───
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



// ─── 任务执行主流程：开关校验 → 预检 → 分流 → 构建请求 → 提交（限流退避）→ 同步完成或转轮询 ───
async function processTask(id: number, config: AIConfig) {
  try {
    let [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (!record) return
    // 排队期间状态已被改写（同资产重复任务被合并清理/判失败）：跳过执行，不再提交上游
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

    // 提交前本地预检（仅视频）：拦截明显会触发上游内容审核的提示词，
    // 避免无效提交占用上游队列槽位（排队后才被判失败的整轮等待会白白作废）
    if (type === 'video') {
      const fixedPrompt = await preSubmitVideoPrecheck(record, params)
      if (fixedPrompt) {
        Object.assign(params, parseTaskParams((await db.select({ params: schema.sysTask.params }).from(schema.sysTask).where(eq(schema.sysTask.id, id)))[0]?.params))
        record = { ...record, prompt: fixedPrompt }
      }
    }

    // 多模型分流（仅视频）：配置内多个视频模型时按上游在途量把任务分给压力小的模型池（候选先按素材形态过滤）；
    // 用户锁定模型（noBalance）时跳过分流，直接按任务落库模型提交（手动指定或配置默认均不切换）
    if (type === 'video' && params.noBalance) {
      logTaskProgress(label, 'model-locked', { id, model: record.model || config.model })
    } else if (type === 'video') {
      const refImagesRaw = params.referenceImageUrls
      let refCount = 0
      if (Array.isArray(refImagesRaw)) refCount = refImagesRaw.filter((u: any) => typeof u === 'string' && u.trim()).length
      else if (typeof refImagesRaw === 'string' && refImagesRaw.trim()) {
        try {
          const arr = JSON.parse(refImagesRaw)
          if (Array.isArray(arr)) refCount = arr.filter((u: any) => typeof u === 'string' && u.trim()).length
        } catch { refCount = 1 }
      }
      const media = {
        hasReferenceImages: refCount > 0,
        hasFirstFrame: !!(params.firstFrameUrl || params.imageUrl),
      }
      const picked = await pickLeastLoadedVideoModel(id, config, record.model || config.model, media)
      if (picked && picked !== record.model) {
        record = { ...record, model: picked }
        await db.update(schema.sysTask)
          .set({ model: picked, updatedAt: now() })
          .where(eq(schema.sysTask.id, id))
      }
    }

    logTaskProgress(label, 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      sceneId: record.sceneId,
      characterId: record.characterId,
    })

    let url: string, method: string, headers: Record<string, string>, body: unknown
    let imageRecord: ImageGenerationRecord | null = null
    let imageAdapter: ReturnType<typeof getImageAdapter> | null = null

    if (type === 'image') {
      const adapter = getImageAdapter(config.provider)
      imageAdapter = adapter
      const resolvedReferenceImages = await normalizeReferenceImages(params.referenceImages)
      imageRecord = {
        id: record.id,
        model: record.model,
        prompt: record.prompt,
        size: params.size,
        frameType: params.frameType,
        referenceImages: resolvedReferenceImages.length ? JSON.stringify(resolvedReferenceImages) : null,
      }
      ;({ url, method, headers, body } = adapter.buildGenerateRequest(config, imageRecord))
    } else {
      const adapter = getVideoAdapter(config.provider)
      const resolvedImageUrl = await normalizeVideoReferenceUrl(params.imageUrl)
      const resolvedFirstFrameUrl = await normalizeVideoReferenceUrl(params.firstFrameUrl)
      const resolvedLastFrameUrl = await normalizeVideoReferenceUrl(params.lastFrameUrl)
      const resolvedReferenceImageUrls = await normalizeVideoReferenceUrls(params.referenceImageUrls)
      // 参考视频/音频文件较大，不适合 dataURL 内联，需解析为公网可访问 URL
      const resolvedReferenceVideoUrls = resolvePublicMediaUrls(params.referenceVideoUrls, 'video')
      const resolvedReferenceAudioUrls = resolvePublicMediaUrls(params.referenceAudioUrls, 'audio')
      ;({ url, method, headers, body } = adapter.buildGenerateRequest(config, {
        id: record.id,
        model: record.model,
        prompt: record.prompt,
        referenceMode: params.referenceMode,
        imageUrl: resolvedImageUrl,
        firstFrameUrl: resolvedFirstFrameUrl,
        lastFrameUrl: resolvedLastFrameUrl,
        referenceImageUrls: resolvedReferenceImageUrls.length ? JSON.stringify(resolvedReferenceImageUrls) : null,
        referenceVideoUrls: resolvedReferenceVideoUrls.length ? JSON.stringify(resolvedReferenceVideoUrls) : null,
        referenceAudioUrls: resolvedReferenceAudioUrls.length ? JSON.stringify(resolvedReferenceAudioUrls) : null,
        generateAudio: params.generateAudio,
        duration: params.duration,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
      }))
    }

    logTaskProgress(label, 'request', {
      id,
      provider: config.provider,
      method,
      url: redactUrl(url),
      model: record.model,
    })
    logTaskPayload(label, 'request payload', { id, method, url, headers, body })

    let result: any
    // 水位闸门：上游 PENDING 达水位线时暂缓提交，降到水位线以下再放行（仅百炼视频）
    if (type === 'video') await waitForUpstreamWatermark(id, config, record.model || config.model)
    if (imageAdapter?.executeGenerate) {
      // 流式模型（如百炼 wan2.6-image）由适配器自行消费 SSE 流并收敛为最终结果；限流同样走退避重试
      logTaskProgress(label, 'stream-request', { id, provider: config.provider, url: redactUrl(url), model: record.model })
      result = await submitWithRetry(() => imageAdapter!.executeGenerate!(config, imageRecord!), label, id, config, !!params.configTest, record.userId)
    } else {
      result = await submitWithRetry(async () => {
        const resp = await fetch(url, {
          method,
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(600_000),
        })

        if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`)
        return await resp.json() as any
      }, label, id, config, !!params.configTest, record.userId)
    }
    logTaskPayload(label, 'response payload', { id, provider: config.provider, result })

    if (type === 'image') {
      const adapter = getImageAdapter(config.provider)
      const { isAsync, taskId, imageUrl } = adapter.parseGenerateResponse(result)

      if (!isAsync && imageUrl) {
        logTaskProgress(label, 'sync-complete', { id, imageUrl })
        await handleImageComplete(record, imageUrl)
        return
      }

      if (!isAsync && !imageUrl) {
        // 同步模式但无 URL（Gemini 等返回 base64）
        const b64 = adapter.extractImageBase64(result)
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

    const adapter = getVideoAdapter(config.provider)
    const { isAsync, taskId, videoUrl } = adapter.parseGenerateResponse(result)

    if (!isAsync && videoUrl) {
      logTaskProgress(label, 'sync-complete', { id, videoUrl })
      await handleVideoComplete(record, videoUrl, params.duration)
      return
    }

    await markPolling(id, taskId)
    pollTaskTracked(record, config, taskId!)
  } catch (err: any) {
    // 配置故障识别（提交阶段同步返回）：模型未开通等重提也不会成功的配置错误，
    // 解掉集级配置锁定后自动重排到可用配置，避免无效配置持续占用队列槽位；无可换配置时落失败留给人工
    if (await maybeHandleConfigFailure(id, err.message)) return
    await failTask(id, err.message)
  }
}

// 拆分收口：processTask 注入队列模块（避免 queue ↔ 核心的静态循环依赖）
setTaskProcessor(processTask)
