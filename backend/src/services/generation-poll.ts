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
 * 异步任务轮询与完成落库链路（拆分自 generation.ts）：
 * 轮询循环 → 完成守卫落库 → 下载落盘/缩略图/海报帧 → 计价 → 回写业务表。
 */
import { db, schema } from '../db/index.js'
import { and, eq } from 'drizzle-orm'
import { getImageAdapter, getVideoAdapter } from './adapters/registry'
import { logTaskProgress, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'
import { now } from '../utils/response.js'
import { downloadFile, generateImageThumb, saveBase64Image, tenantNestedPath } from '../utils/storage.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { VIDEO_TASK_HARD_LIMIT_MS, VIDEO_TASK_TIMEOUT_MS } from '../utils/rate-config.js'
import type { AIConfig } from './adapters/types'
import { beginPolling, endPolling, taskLabel } from './generation-queue.js'
import { isConfigTestParams, parseTaskParams, POLL_PROFILES, CONFIG_TEST_MAX_MS } from './generation.js'
import { failTask } from './generation-selfheal.js'
import { recordTaskUsage } from './generation-helpers.js'
import type { TaskType, SysTaskRecord } from './generation.js'

export async function markPolling(id: number, taskId: string | undefined) {
  await db.update(schema.sysTask)
    .set({ taskId, status: 'processing', updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  logTaskProgress('SysTask', 'poll-start', { id, taskId })
}

/** 轮询包裹：跟踪“上游生成中”的在途量（终态无论成败/失败均递减，供面板展示） */
export function pollTaskTracked(record: SysTaskRecord, config: AIConfig, taskId: string) {
  const type = record.type as TaskType
  beginPolling(type)
  void pollTask(record, config, taskId).finally(() => { endPolling(type) })
}

export async function pollTask(record: SysTaskRecord, config: AIConfig, taskId: string) {
  const type = record.type as TaskType
  const label = taskLabel(type)
  const profile = POLL_PROFILES[type]
  const adapter = type === 'image' ? getImageAdapter(config.provider) : getVideoAdapter(config.provider)
  // lastHealthyAt：最后一次收到正常轮询响应（PENDING/RUNNING）的时间。
  // 只要上游持续返回健康状态就不超时，仅在连续无有效响应达 maxDurationMs 时才判失败。
  let lastHealthyAt = Date.now()
  // 硬性墙钟上限：从任务创建时起算，无论上游是否返回健康状态，超过该时长一律判失败。
  // 防止上游队列永久 PENDING 导致无限轮询（曾发生 137 个任务轮询 8+ 小时拖垮服务）。
  const createdAtMs = record.createdAt ? new Date(record.createdAt).getTime() : Date.now()
  // 单次生成测试：额外挂一道从创建起算的有限墙钟（图片轮询本无硬墙钟，测试必须有限结束，
  // 否则上游长期 PENDING 会让设置页弹层无限转圈，且测试任务不进看门狗没人兜底）
  const configTest = isConfigTestParams(parseTaskParams(record.params))

  for (let i = 0; ; i++) {
    // 硬性墙钟超时：优先检查，即使上游持续返回 PENDING 也要触发
    if (type === 'video' && Date.now() - createdAtMs >= VIDEO_TASK_HARD_LIMIT_MS) {
      await failTask(record.id, `硬性超时：任务运行超过 ${Math.round(VIDEO_TASK_HARD_LIMIT_MS / 60_000)} 分钟，已强制判失败`)
      return
    }
    if (configTest && Date.now() - createdAtMs >= CONFIG_TEST_MAX_MS) {
      await failTask(record.id, `生成测试超时：超过 ${Math.round(CONFIG_TEST_MAX_MS / 60_000)} 分钟未完成，请更换模型或稍后重新测试`)
      return
    }
    if (profile.maxDurationMs && Date.now() - lastHealthyAt >= profile.maxDurationMs) {
      await failTask(record.id, `Timeout: 连续 ${Math.round(profile.maxDurationMs / 60_000)} 分钟无有效轮询响应`)
      return
    }
    await new Promise(r => setTimeout(r, profile.intervalMs))
    try {
      const { url, method, headers } = adapter.buildPollRequest(config, taskId)
      logTaskProgress(label, 'poll-request', {
        id: record.id,
        taskId,
        provider: config.provider,
        method,
        url: redactUrl(url),
        attempt: i + 1,
      })
      const resp = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(60_000),
      })
      if (!resp.ok) continue
      const result = await resp.json() as any

      // 图片/视频 PollResponse 结构不同，这里统一按 any 取值后按 type 分支
      const pollResp: any = adapter.parsePollResponse(result)

      if (pollResp.status === 'completed') {
        if (type === 'image') {
          if (pollResp.imageUrl) {
            logTaskSuccess(label, 'poll-complete', { id: record.id, taskId, imageUrl: pollResp.imageUrl })
            await handleImageComplete(record, pollResp.imageUrl)
            return
          }
          if (adapter.provider === 'gemini') {
            // Gemini 可能返回 base64
            const b64 = (adapter as ReturnType<typeof getImageAdapter>).extractImageBase64(result)
            if (b64) {
              logTaskSuccess(label, 'poll-base64-complete', { id: record.id, taskId, mimeType: b64.mimeType })
              await handleImageCompleteBase64(record, b64.data, b64.mimeType)
              return
            }
          }
        } else if (pollResp.videoUrl) {
          logTaskSuccess(label, 'poll-complete', { id: record.id, taskId, videoUrl: pollResp.videoUrl })
          await handleVideoComplete(record, pollResp.videoUrl, null)
          return
        }
      }
      if (pollResp.status === 'failed') {
        // 上游明确失败（如内容审核拦截）属终态：立即落库，不重试不等待超时
        await failTask(record.id, pollResp.error || 'Generation failed')
        return
      }
      // PENDING / RUNNING 等中间状态：刷新健康时间戳，继续轮询
      lastHealthyAt = Date.now()
      // 每 30 次轮询（约 5 分钟）刷新一次 updated_at，向看门狗证明任务仍活跃
      if (i % 30 === 0 && i > 0) {
        await db.update(schema.sysTask)
          .set({ updatedAt: now() })
          .where(eq(schema.sysTask.id, record.id))
      }
    } catch (err: any) {
      const exhausted = profile.maxDurationMs != null && Date.now() - lastHealthyAt >= profile.maxDurationMs
      if (exhausted) {
        await failTask(record.id, `Timeout: 连续 ${Math.round((profile.maxDurationMs ?? 0) / 60_000)} 分钟无有效轮询响应 (${err.message})`)
        return
      }
      logTaskWarn(label, 'poll-retry', { id: record.id, taskId, attempt: i + 1, error: err.message })
    }
  }
}

/** 完成态落库守卫：仅当任务仍为 processing 才写终态（看门狗判失败/重试后旧轮询迟到时跳过，避免重复计价与覆盖写回） */
async function markTaskCompleted(id: number, fields: { resultUrl?: string | null; localPath: string }): Promise<boolean> {
  const [rs] = await db.update(schema.sysTask)
    .set({ ...fields, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(and(eq(schema.sysTask.id, id), eq(schema.sysTask.status, 'processing')))
  return (rs?.affectedRows ?? 0) > 0
}

export async function handleImageComplete(record: SysTaskRecord, imageUrl: string) {
  const localPath = await downloadFile(imageUrl, 'images', tenantNestedPath(record.userId, record.dramaId))
  // 列表页缩略图（前端按命名约定推导地址，失败不影响主流程）
  await generateImageThumb(localPath)

  if (!await markTaskCompleted(record.id, { resultUrl: imageUrl, localPath })) {
    logTaskWarn('ImageTask', 'complete-skipped-stale', { id: record.id, localPath })
    return
  }

  logTaskSuccess('ImageTask', 'downloaded', { id: record.id, provider: record.provider, localPath })

  await recordTaskUsage(record)
  await writeBackImageAssets(record, localPath)
}

export async function handleImageCompleteBase64(record: SysTaskRecord, base64Data: string, mimeType: string) {
  const localPath = await saveBase64Image(base64Data, mimeType, 'images', tenantNestedPath(record.userId, record.dramaId))
  await generateImageThumb(localPath)

  if (!await markTaskCompleted(record.id, { localPath })) {
    logTaskWarn('ImageTask', 'complete-skipped-stale', { id: record.id, localPath })
    return
  }

  logTaskSuccess('ImageTask', 'saved-base64', { id: record.id, provider: record.provider, mimeType, localPath })

  await recordTaskUsage(record)
  await writeBackImageAssets(record, localPath)
}

// 图片完成后回写业务表：分镜(按 frameType)、角色、场景、道具
export async function writeBackImageAssets(record: SysTaskRecord, localPath: string) {
  const params = parseTaskParams(record.params)
  if (record.storyboardId) {
    const sbUpdate: Record<string, any> = { updatedAt: now() }
    if (params.frameType === 'first_frame') sbUpdate.firstFrameImage = localPath
    else if (params.frameType === 'last_frame') sbUpdate.lastFrameImage = localPath
    else sbUpdate.composedImage = localPath
    await db.update(schema.storyboards).set(sbUpdate).where(eq(schema.storyboards.id, record.storyboardId))
  }
  if (record.characterId) {
    await db.update(schema.characters).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.characters.id, record.characterId))
  }
  if (record.sceneId) {
    await db.update(schema.scenes).set({ imageUrl: localPath, status: 'completed', updatedAt: now() }).where(eq(schema.scenes.id, record.sceneId))
  }
  if (record.propId) {
    await db.update(schema.props).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.props.id, record.propId))
  }
}

export async function handleVideoComplete(record: SysTaskRecord, videoUrl: string, duration: number | null | undefined) {
  const localPath = await downloadFile(videoUrl, 'videos', tenantNestedPath(record.userId, record.dramaId))
  // 海报帧供列表/封面展示，避免前端为显示首帧缓冲整个视频
  await extractVideoPoster(localPath)

  if (!await markTaskCompleted(record.id, { resultUrl: videoUrl, localPath })) {
    logTaskWarn('VideoTask', 'complete-skipped-stale', { id: record.id, localPath })
    return
  }

  logTaskSuccess('VideoTask', 'downloaded', { id: record.id, localPath, storyboardId: record.storyboardId, duration })

  await recordTaskUsage(record)

  if (record.storyboardId) {
    // record.model 为实际提交模型（多模型分流切换后已同步更新），直接落分镜，免去联表 sys_task
    await db.update(schema.storyboards)
      .set({ videoUrl: localPath, videoModel: record.model || undefined, duration: duration || undefined, updatedAt: now() })
      .where(eq(schema.storyboards.id, record.storyboardId))
  }
}
