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
 * OpenAI 系生图适配（默认 GPT Image，兼容 DALL-E 响应形状）。
 * 端点固定挂 /v1 前缀；响应两型：{ data:[{url}] } 或 { data:[{b64_json}] }。
 * 尺寸按模型分档收口：gpt-image-1 只吃三种枚举，gpt-image-2 可任意 16 倍数。
 */
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { joinProviderUrl } from './url'

export class OpenAIImageAdapter implements ImageProviderAdapter {
  provider = 'openai'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = record.model || config.model || 'gpt-image-2'
    const isGptImage = model.startsWith('gpt-image-')
    const isGptImage2 = model === 'gpt-image-2'

    let size: string
    if (isGptImage2) {
      size = this.normalizeGptImage2Size(record.size)
    } else if (isGptImage) {
      size = this.normalizeGptImageSize(record.size)
    } else {
      size = record.size || '1024x1024'
    }

    const body: any = { model, prompt: record.prompt, size, n: 1 }
    // gpt-image 系没有 response_format 参数（恒可拿 b64）；仅 DALL-E 需要显式要 url
    if (!isGptImage) {
      body.response_format = 'url'
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/images/generations'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body,
    }
  }

  /** gpt-image-1：贴齐枚举白名单，越界尺寸按宽高关系就近吸附 */
  private normalizeGptImageSize(size?: string | null): string {
    const enumSizes = ['1024x1024', '1536x1024', '1024x1536', 'auto']
    if (!size) return '1024x1024'
    const lowered = size.toLowerCase()
    if (enumSizes.includes(lowered)) return lowered

    const [w, h] = lowered.split('x').map(Number)
    if (!w || !h) return 'auto'
    if (w === h) return '1024x1024'
    return w > h ? '1536x1024' : '1024x1536'
  }

  /** gpt-image-2：宽高各夹进 [256,4096] 并取整到 16 的倍数 */
  private normalizeGptImage2Size(size?: string | null): string {
    if (!size) return '1024x1024'
    const lowered = size.toLowerCase()
    if (lowered === 'auto') return 'auto'

    const [w, h] = lowered.split('x').map(Number)
    if (!w || !h) return 'auto'
    const clamp16 = (v: number) => snapMultiple(Math.min(4096, Math.max(256, v)), 16)
    return `${clamp16(w)}x${clamp16(h)}`
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    // 现网 DALL-E/GPT Image 都同步直出；task 形态留给 OpenAI 兼容网关
    if (result.task_id || result.id) {
      return { isAsync: true, taskId: result.task_id || result.id }
    }
    const url = result.data?.[0]?.url || result.url
    if (url) return { isAsync: false, imageUrl: url }
    // b64 载荷在这里只判形态，真正的字节收割在 extractImageBase64
    if (result.data?.[0]?.b64_json) return { isAsync: false, imageUrl: undefined }
    throw new Error('No image URL in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/images/task/${taskId}`),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    if (result.status === 'completed') {
      return { status: 'completed', imageUrl: result.image_url || result.data?.[0]?.url || null }
    }
    if (result.status === 'failed') {
      return { status: 'failed', error: result.error?.message || 'Generation failed' }
    }
    return { status: result.status || 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return result.data?.[0]?.url || result.image_url || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const b64 = result.data?.[0]?.b64_json
    return b64 ? { data: b64, mimeType: 'image/png' } : null
  }
}

/** 就近取整到 multiple 的倍数，且不低于 multiple 本身 */
function snapMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}
