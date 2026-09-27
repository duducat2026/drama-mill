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
 * MiniMax H3 生视频适配。
 * 提交 POST /v2/video_generation 拿 task_id；轮询 GET /v2/query/video_generation/{task_id}，
 * 官方把状态包在 { task: { status, content.url, error } } 里，这里同时兼容顶层平铺。
 *
 * content[] 多模态拼装规则：text 必带（上限 7000 字符）；参考图按 role 区分
 * first_frame / last_frame / reference_image（图 ≤9）；参考视频 ≤3、参考音频 ≤3，
 * 全类型合计 ≤12。
 * 两条口径注意：带首帧即图生视频，此时省略 ratio（官方恒 adaptive）；纯文生视频
 * ratio 必填且只吃白名单值。H3 原生音画一体，没有独立音频开关，generateAudio 直接忽略。
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

/** 仅 MiniMax-H3 系列（小写前缀匹配，兼容 H3.x 变体） */
const H3_MODEL_PREFIX = 'minimax-h3'
const DEFAULT_MODEL = 'MiniMax-H3'

/** 素材配额：图 9 / 视 3 / 音 3，混合总量 12；提示词上限 7000 字符 */
const REF_LIMITS = { images: 9, videos: 3, audios: 3, total: 12 } as const
const PROMPT_MAX_CHARS = 7000

/** 文生视频允许的画幅 */
const VALID_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'])

function parseUrlArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter(u => typeof u === 'string' && u.trim()) : []
  } catch {
    return []
  }
}

/** 响应可能包一层 task 也可能平铺，统一剥出状态载体 */
function unwrapTask(result: any): any {
  return result.task && typeof result.task === 'object' ? result.task : result
}

/** error 归一为字符串，对象形态保留 [code] 前缀 */
function pollError(err: any): string {
  if (typeof err === 'string') return err
  const text = err?.message || JSON.stringify(err) || 'Video generation failed'
  return err && typeof err === 'object' && err.code ? `[${err.code}] ${text}` : text
}

/** 4-15 秒取整，缺省/非法回 5 */
function clampDuration(duration?: number | null): number {
  const parsed = Math.round(Number(duration || 5))
  if (!Number.isFinite(parsed)) return 5
  return Math.min(15, Math.max(4, parsed))
}

/** 项目分辨率档位映射到 H3 仅有的两档：480p/720p→768P，1080p/2K→2K */
function toH3Resolution(resolution?: string | null): string {
  const r = (resolution || '').toLowerCase()
  return r === '2k' || r === '1080p' ? '2K' : '768P'
}

export class MiniMaxVideoAdapter implements VideoProviderAdapter {
  provider = 'minimax'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || DEFAULT_MODEL
    if (!model.toLowerCase().startsWith(H3_MODEL_PREFIX)) {
      throw new Error(`仅支持 MiniMax H3 系列模型（MiniMax-H3*），当前: ${model}`)
    }

    const prompt = (record.prompt || '').trim()
    if (!prompt) throw new Error('MiniMax H3 要求必须提供提示词（text content）')
    if (prompt.length > PROMPT_MAX_CHARS) {
      throw new Error(`提示词超长：MiniMax H3 上限 ${PROMPT_MAX_CHARS} 字符，当前 ${prompt.length}`)
    }

    const images = parseUrlArray(record.referenceImageUrls)
    const videos = parseUrlArray(record.referenceVideoUrls)
    const audios = parseUrlArray(record.referenceAudioUrls)
    const firstFrame = (record.firstFrameUrl || record.imageUrl || '').trim()
    const lastFrame = (record.lastFrameUrl || '').trim()
    const totalRefs = images.length + videos.length + audios.length + (firstFrame ? 1 : 0) + (lastFrame ? 1 : 0)
    if (images.length > REF_LIMITS.images || videos.length > REF_LIMITS.videos
      || audios.length > REF_LIMITS.audios || totalRefs > REF_LIMITS.total) {
      throw new Error(`参考素材超限：图片≤${REF_LIMITS.images}、视频≤${REF_LIMITS.videos}、音频≤${REF_LIMITS.audios}、总数≤${REF_LIMITS.total}`)
    }

    const body: any = {
      model,
      content: this.buildContent(prompt, firstFrame, lastFrame, images, videos, audios),
      duration: clampDuration(record.duration),
      resolution: toH3Resolution(record.resolution),
    }
    // 首帧在场 = 图生视频，ratio 交给官方恒 adaptive；仅纯文生视频需要显式画幅
    if (!firstFrame) {
      const ratio = (record.aspectRatio || '').trim()
      body.ratio = VALID_RATIOS.has(ratio) ? ratio : '16:9'
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v2', '/video_generation'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body,
    }
  }

  /** content 数组顺序：文本 → 首/尾帧 → 参考图 → 参考视频 → 参考音频（音频无 role） */
  private buildContent(prompt: string, firstFrame: string, lastFrame: string, images: string[], videos: string[], audios: string[]): any[] {
    const content: any[] = [{ type: 'text', text: prompt }]
    if (firstFrame) content.push({ type: 'image_url', image_url: { url: firstFrame }, role: 'first_frame' })
    if (lastFrame) content.push({ type: 'image_url', image_url: { url: lastFrame }, role: 'last_frame' })
    for (const url of images) {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
    }
    for (const url of videos) {
      content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' })
    }
    for (const url of audios) {
      content.push({ type: 'audio_url', audio_url: { url } })
    }
    return content
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    if (result.task_id) return { isAsync: true, taskId: String(result.task_id) }
    const task = unwrapTask(result)
    const videoUrl = task.content?.url || result.content?.url || result.video_url
    if (videoUrl) return { isAsync: false, videoUrl }
    throw new Error('No task_id or video url in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v2', `/query/video_generation/${taskId}`),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const task = unwrapTask(result)
    if (task.status === 'succeeded') {
      return { status: 'completed', videoUrl: task.content?.url || task.video_url }
    }
    if (task.status === 'failed' || task.status === 'cancelled') {
      return { status: 'failed', error: pollError(task.error) }
    }
    return { status: task.status || 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    const task = unwrapTask(result)
    return task.content?.url || task.video_url || null
  }
}
