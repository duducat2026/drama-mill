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
 * 火山 Seedance 2.0 生视频适配。
 * 提交口 /api/v3/contents/generations/tasks 只回任务号，成片靠轮询收割。
 * 模式收敛为纯多模态参考：≤9 张参考图 + ≤3 段参考视频 + ≤3 条参考音频叠文本；
 * 挂了参考音频就必须至少挂一路视觉素材；只收 doubao-seedance-2-0-* 系模型。
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { joinProviderUrl } from './url'

/** 模型白名单：仅 doubao-seedance-2-0-* 前缀 */
const SEEDANCE2_MODEL_PREFIX = 'doubao-seedance-2-0'
const DEFAULT_MODEL = 'doubao-seedance-2-0-fast-260128'

/** 多模态参考素材上限：图片 9、视频 3、音频 3 */
const REF_LIMITS = { images: 9, videos: 3, audios: 3 } as const

/** JSON 字符串数组 → 去空 Trim 的 URL 列表；坏 JSON 按空集处理 */
function parseUrlArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter(u => typeof u === 'string' && u.trim()) : []
  } catch {
    return []
  }
}

/** 轮询 succeeded 响应里成片 URL 的三种可能落点 */
function pickVideoUrl(payload: any): string | undefined {
  return payload.video_url || payload.content?.video_url || payload.data?.video_url
}

/** 上游 error 归一为字符串：对象形态保留 [code] 前缀（如 OutputVideoSensitiveContentDetected） */
function pollError(err: any): string {
  if (typeof err === 'string') return err
  const text = err?.message || JSON.stringify(err) || 'Video generation failed'
  return err && typeof err === 'object' && err.code ? `[${err.code}] ${text}` : text
}

/** 素材清单 → Seedance content 数组：文本领头，图/视/音按 role 追加 */
function buildContent(prompt: string, images: string[], videos: string[], audios: string[]): any[] {
  const content: any[] = []
  if (prompt) content.push({ type: 'text', text: prompt })
  for (const url of images) {
    content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
  }
  for (const url of videos) {
    content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' })
  }
  for (const url of audios) {
    content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })
  }
  return content
}

export class VolcEngineVideoAdapter implements VideoProviderAdapter {
  provider = 'volcengine'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || DEFAULT_MODEL
    if (!model.startsWith(SEEDANCE2_MODEL_PREFIX)) {
      throw new Error(`仅支持 Seedance 2.0 系列模型（${SEEDANCE2_MODEL_PREFIX}-*），当前: ${model}`)
    }

    const prompt = (record.prompt || '').trim()
    const images = parseUrlArray(record.referenceImageUrls)
    const videos = parseUrlArray(record.referenceVideoUrls)
    const audios = parseUrlArray(record.referenceAudioUrls)
    this.assertBudget(prompt, images, videos, audios)

    const body: any = {
      model,
      content: buildContent(prompt, images, videos, audios),
      generate_audio: record.generateAudio !== 0 && record.generateAudio !== false,
      ratio: record.aspectRatio || 'adaptive',
      duration: clampDuration(record.duration),
      resolution: record.resolution === '480p' ? '480p' : '720p',
      watermark: false,
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', '/contents/generations/tasks'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body,
    }
  }

  /** 提交前的三道闸：素材配额、音频依赖视觉、非空输入 */
  private assertBudget(prompt: string, images: string[], videos: string[], audios: string[]) {
    if (images.length > REF_LIMITS.images || videos.length > REF_LIMITS.videos || audios.length > REF_LIMITS.audios) {
      throw new Error(`参考素材超限：图片≤${REF_LIMITS.images}、视频≤${REF_LIMITS.videos}、音频≤${REF_LIMITS.audios}`)
    }
    if (audios.length > 0 && images.length + videos.length === 0) {
      throw new Error('参考音频需要至少 1 个参考图片或视频')
    }
    if (!prompt && !images.length && !videos.length && !audios.length) {
      throw new Error('多模态参考模式需要至少一个参考素材或 prompt')
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    if (result.id) return { isAsync: true, taskId: result.id }
    const videoUrl = pickVideoUrl(result)
    if (videoUrl) return { isAsync: false, videoUrl }
    throw new Error('No task_id or video_url in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', `/contents/generations/tasks/${taskId}`),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    if (result.status === 'succeeded') {
      return { status: 'completed', videoUrl: pickVideoUrl(result) }
    }
    if (result.status === 'failed') {
      return { status: 'failed', error: pollError(result.error) }
    }
    return { status: result.status || 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return pickVideoUrl(result) || null
  }
}

/** Seedance 2.0 支持 4-15 秒；缺省 5 秒，非数字回退 5 */
function clampDuration(duration?: number | null): number {
  const parsed = Math.round(Number(duration || 5))
  if (!Number.isFinite(parsed)) return 5
  return Math.min(15, Math.max(4, parsed))
}
