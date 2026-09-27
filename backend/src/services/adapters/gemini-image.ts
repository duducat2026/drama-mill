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
 * Google Gemini 生图适配。
 * 鉴权双通道：query ?key= 与 header x-goog-api-key 同时给，兼容官方域与中转站。
 * 响应没有图片 URL——像素以 base64 嵌在 inlineData.data 里，走 extractImageBase64 收割。
 * 分支说明：gemini-3 系图像模型在官方域走 interactions 新端点；
 * new-api 类中转普遍没开 interactions（报 endpointType=GEMINI_INTERACTIONS 未启用），
 * 因此非官方域一律退回经典 generateContent。
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
import { parseDataUrl } from '../../utils/storage.js'

/** size 缺省时Google 侧的统一兜底 */
const FALLBACK_ASPECT = '16:9'
const FALLBACK_TIER = '1K'

export class GeminiImageAdapter implements ImageProviderAdapter {
  provider = 'gemini'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const raw = record.model || config.model || 'gemini-3-pro-image'
    const isGemini3Image = /gemini-3.*image/.test(raw)
    const onOfficialDomain = /generativelanguage\.googleapis\.com/.test(config.baseUrl || '')
    if (isGemini3Image && onOfficialDomain) {
      return this.interactionsRequest(config, raw, record)
    }
    return this.generateContentRequest(config, raw, record)
  }

  /** gemini-3 图像 × 官方域：POST /v1beta/interactions */
  private interactionsRequest(config: AIConfig, rawModel: string, record: ImageGenerationRecord): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1beta', '/interactions'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: {
        model: rawModel.replace(/^models\//, ''),
        input: record.prompt || 'Generate an image',
        response_format: {
          type: 'image',
          aspect_ratio: this.aspectOf(record.size),
          image_size: this.tierOf(record.size),
        },
      },
    }
  }

  /** 经典 REST：contents[].parts[]，参考图以 inline_data 前置、文本殿后 */
  private generateContentRequest(config: AIConfig, rawModel: string, record: ImageGenerationRecord): ProviderRequest {
    const model = rawModel.startsWith('models/') ? rawModel : `models/${rawModel}`
    const parts: any[] = [...this.referenceParts(record.referenceImages)]
    parts.push({ text: record.prompt || 'Generate an image' })

    const target = new URL(joinProviderUrl(config.baseUrl, '/v1beta', `/${model}:generateContent`))
    target.searchParams.set('key', config.apiKey)
    return {
      url: target.toString(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: {
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          imageConfig: { aspectRatio: this.aspectOf(record.size), imageSize: this.tierOf(record.size) },
        },
      },
    }
  }

  /** dataURL 形态的参考图清单 → inline_data parts（坏 JSON / 坏条目静默跳过） */
  private referenceParts(referenceImages?: string | null): any[] {
    if (!referenceImages) return []
    let refs: unknown
    try {
      refs = JSON.parse(referenceImages)
    } catch {
      return []
    }
    const parts: any[] = []
    for (const ref of Array.isArray(refs) ? refs : []) {
      const decoded = parseDataUrl(String(ref || ''))
      if (decoded) {
        parts.push({ inline_data: { mime_type: decoded.mimeType, data: decoded.data } })
      }
    }
    return parts
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const candidate = result?.candidates?.[0]
    const stopReason = candidate?.finishReason || candidate?.finish_reason
    const stopMessage = candidate?.finishMessage || candidate?.finish_message
    if (stopReason && stopReason !== 'STOP' && stopReason !== 'MAX_TOKENS') {
      throw new Error(stopMessage || `Gemini generation stopped: ${stopReason}`)
    }

    const url = this.extractImageUrl(result)
    if (url) return { isAsync: false, imageUrl: url }
    if (this.extractImageBase64(result)) return { isAsync: false, imageUrl: undefined }
    if (result.task_id || result.id) return { isAsync: true, taskId: result.task_id || result.id }
    if (result.error) throw new Error(result.error.message || 'Gemini generation failed')
    throw new Error('No image data in Gemini response')
  }

  /** Gemini 同步直出，正常不会进轮询；留空实现纯粹为接口齐整 */
  parsePollResponse(_result: any): ImagePollResponse {
    return { status: 'completed' }
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    const target = new URL(joinProviderUrl(config.baseUrl, '/v1beta', `/${taskId}`))
    target.searchParams.set('key', config.apiKey)
    return { url: target.toString(), method: 'GET', headers: { 'x-goog-api-key': config.apiKey }, body: undefined }
  }

  extractImageUrl(result: any): string | null {
    return result?.data?.[0]?.url || result?.image_url || result?.url || null
  }

  /** 三种内联图形态：OpenAI 兼容 data[].b64_json / 顶层 output_image / Google candidates parts */
  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const openaiStyle = result?.data?.[0]?.b64_json
    if (openaiStyle) return { data: openaiStyle, mimeType: 'image/png' }

    const top = result?.output_image
    if (top?.data) {
      return { data: top.data, mimeType: top.mime_type || top.mimeType || 'image/png' }
    }

    for (const part of result.candidates?.[0]?.content?.parts || []) {
      const inline = part.inlineData || part.inline_data
      if (inline) {
        return { data: inline.data, mimeType: inline.mimeType || inline.mime_type || 'image/png' }
      }
    }
    return null
  }

  /** "WxH" 像素串 → 最简整数比；解析不动给 16:9 */
  private aspectOf(size?: string | null): string {
    const [w, h] = (size || '').split('x').map(Number)
    if (!w || !h) return FALLBACK_ASPECT
    const unit = gcd(w, h)
    return `${w / unit}:${h / unit}`
  }

  /** 宽度像素 → Google 档位词（4K/2K/1K/512），缺省 1K */
  private tierOf(size?: string | null): string {
    const [w] = (size || '').split('x').map(Number)
    if (!w) return FALLBACK_TIER
    if (w >= 2048) return '4K'
    if (w >= 1024) return '2K'
    if (w >= 512) return '1K'
    return '512'
  }
}

/** 辗转相除求最大公约数 */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}
