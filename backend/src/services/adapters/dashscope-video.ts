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
 * DashScope 视频适配器：
 * - 端点: POST /api/v1/services/aigc/video-generation/video-synthesis（异步任务）
 * - 轮询: GET /api/v1/tasks/{task_id}
 * - wan3.0 系列：All-in-One 全能参考，media 数组 + ratio + resolution
 * - happyhorse-1.x 系列：t2v / i2v / r2v（1-9 张），resolution + ratio + duration + watermark
 * - wan2.7 / wan2.6 系列：img_url 输入 + size 参数，2-15 秒
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
import {
  asyncHeaders,
  formatTaskError,
  isHappyHorseVideoModel,
  isWan3VideoModel,
  mapTaskStatus,
  RATIO_SIZES,
  toWan3Ratio,
} from './dashscope-shared'

export class DashScopeVideoAdapter implements VideoProviderAdapter {
  provider = 'dashscope'

  /** 同图片适配器：端点/异步头/兜底模型可被子类改写，请求体与轮询解析保持复用 */
  protected generateUrl(config: AIConfig): string {
    return joinProviderUrl(config.baseUrl, '/api/v1', '/services/aigc/video-generation/video-synthesis')
  }

  protected pollUrl(config: AIConfig, taskId: string): string {
    return joinProviderUrl(config.baseUrl, '/api/v1', `/tasks/${taskId}`)
  }

  protected submitHeaders(apiKey: string): Record<string, string> {
    return asyncHeaders(apiKey)
  }

  protected defaultVideoModel(): string {
    return 'wan3.0-video'
  }

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || this.defaultVideoModel()
    const prompt = (record.prompt || '').trim()

    if (isWan3VideoModel(model)) {
      return this.buildWan3Request(config, record, model, prompt)
    }
    if (isHappyHorseVideoModel(model)) {
      return this.buildHappyHorseRequest(config, record, model, prompt)
    }

    // ── wan2.7 / wan2.6 旧格式 ──
    const img_url = (record.firstFrameUrl || record.imageUrl || '').trim()
    if (!prompt && !img_url) throw new Error('DashScope 视频生成要求提供提示词或首帧图')

    const input: Record<string, any> = {}
    if (prompt) input.prompt = prompt
    if (img_url) input.img_url = img_url

    const parameters: Record<string, any> = {
      size: RATIO_SIZES[(record.aspectRatio || '').trim()] || RATIO_SIZES['16:9'],
      duration: this.normalizeDuration(record.duration, model),
    }

    return {
      url: this.generateUrl(config),
      method: 'POST',
      headers: this.submitHeaders(config.apiKey),
      body: { model, input, parameters },
    }
  }

  /** wan3.0 All-in-One 请求构建：使用 media 数组 + ratio/resolution 参数 */
  private buildWan3Request(
    config: AIConfig, record: VideoGenerationRecord, model: string, prompt: string,
  ): ProviderRequest {
    const media: Array<{ type: string; url: string }> = []

    // 首帧 / 尾帧
    const firstFrame = (record.firstFrameUrl || record.imageUrl || '').trim()
    if (firstFrame) media.push({ type: 'first_frame', url: firstFrame })
    const lastFrame = (record.lastFrameUrl || '').trim()
    if (lastFrame) media.push({ type: 'last_frame', url: lastFrame })

    // 参考图片 / 视频 / 音频
    this.appendRefMedia(media, 'reference_image', record.referenceImageUrls)
    this.appendRefMedia(media, 'reference_video', record.referenceVideoUrls)
    this.appendRefMedia(media, 'reference_audio', record.referenceAudioUrls)

    if (!prompt && !media.length) throw new Error('DashScope 视频生成要求提供提示词或媒体素材')

    const input: Record<string, any> = {}
    if (prompt) input.prompt = prompt
    if (media.length) input.media = media

    const parameters: Record<string, any> = {
      resolution: (record.resolution || '720P').toUpperCase(),
      ratio: toWan3Ratio(record.aspectRatio),
      duration: this.normalizeDuration(record.duration, model),
      audio: record.generateAudio !== false && record.generateAudio !== 0,
    }

    return {
      url: this.generateUrl(config),
      method: 'POST',
      headers: this.submitHeaders(config.apiKey),
      body: { model, input, parameters },
    }
  }

  /**
   * happyhorse 系列请求构建：三种模式素材类型互斥，按后缀裁剪 media
   * - t2v：纯文生视频，不传 media；i2v：仅首帧；r2v：仅参考图（1-9 张，与提示词 [Image N] 顺序对应）
   * - watermark 固定 false（生产视频不允许 "Happy Horse" 水印）；有声输出模型侧固定开启，无 audio 参数
   */
  private buildHappyHorseRequest(
    config: AIConfig, record: VideoGenerationRecord, model: string, prompt: string,
  ): ProviderRequest {
    const media: Array<{ type: string; url: string }> = []
    if (model.endsWith('-r2v')) {
      this.appendRefMedia(media, 'reference_image', record.referenceImageUrls)
      if (!media.length) throw new Error('happyhorse 参考生视频（r2v）要求至少 1 张参考图')
    } else if (model.endsWith('-i2v')) {
      const firstFrame = (record.firstFrameUrl || record.imageUrl || '').trim()
      if (!firstFrame) throw new Error('happyhorse 图生视频（i2v）要求提供首帧图')
      media.push({ type: 'first_frame', url: firstFrame })
    }
    // t2v 不接受 media；三个变体均要求提示词（i2v 亦必传）
    if (!prompt) throw new Error('happyhorse 视频生成要求提供提示词')

    const input: Record<string, any> = { prompt }
    if (media.length) input.media = media

    const parameters: Record<string, any> = {
      resolution: (record.resolution || '720P').toUpperCase(),
      duration: this.normalizeDuration(record.duration, model),
      watermark: false,
    }
    // i2v 输出画幅跟随首帧，接口无 ratio 参数
    if (!model.endsWith('-i2v')) parameters.ratio = toWan3Ratio(record.aspectRatio)

    return {
      url: this.generateUrl(config),
      method: 'POST',
      headers: this.submitHeaders(config.apiKey),
      body: { model, input, parameters },
    }
  }

  /** 解析 JSON 数组字符串并追加到 media */
  private appendRefMedia(
    media: Array<{ type: string; url: string }>, type: string, raw?: string | null,
  ): void {
    if (!raw?.trim()) return
    try {
      const urls = JSON.parse(raw)
      if (Array.isArray(urls)) {
        for (const u of urls) {
          if (typeof u === 'string' && u.trim()) media.push({ type, url: u.trim() })
        }
      }
    } catch { /* 非 JSON，忽略 */ }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const taskId = result.output?.task_id
    if (taskId) return { isAsync: true, taskId: String(taskId) }
    const videoUrl = result.output?.video_url
    if (videoUrl) return { isAsync: false, videoUrl }
    throw new Error('No task_id or video url in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: this.pollUrl(config, taskId),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const output = result.output || {}
    const status = mapTaskStatus(output.task_status)
    if (status === 'completed') {
      return { status, videoUrl: output.video_url || null }
    }
    if (status === 'failed') {
      return { status, error: formatTaskError(output) }
    }
    return { status }
  }

  extractVideoUrl(result: any): string | null {
    return result.output?.video_url || null
  }

  private normalizeDuration(duration?: number | null, model?: string): number {
    const parsed = Math.round(Number(duration || 5))
    if (!Number.isFinite(parsed)) return 5
    // wan3.0 支持 2-30 秒，happyhorse 支持 3-15 秒，wan2.7/wan2.6 支持 2-15 秒
    const max = model && isWan3VideoModel(model) ? 30 : 15
    const min = model && isHappyHorseVideoModel(model) ? 3 : 2
    return Math.min(max, Math.max(min, parsed))
  }
}
