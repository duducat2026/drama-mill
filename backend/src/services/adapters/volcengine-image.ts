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
 * 火山 veImageX 生图适配。
 * 版本前缀是 /api/v3（不是 OpenAI 的 /v1）；成功响应 { data:[{url}] }。
 * 提交可能同步出图，也可能只回任务号转轮询，两种形态都在 parse 里分诊。
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

const API_PREFIX = '/api/v3'

/** "宽x高" 拆成整数宽高；形状不对就不带尺寸字段 */
function splitSize(size?: string | null): { width?: number; height?: number } {
  const [w, h] = (size || '').split('x')
  const width = parseInt(w, 10)
  const height = parseInt(h, 10)
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : {}
}

/** 上游 error 收成一行可读文本：对象带 code 就加 "[code] " 前缀 */
function pollError(err: any): string {
  if (typeof err === 'string') return err
  const text = err?.message || JSON.stringify(err) || 'Generation failed'
  return err && typeof err === 'object' && err.code ? `[${err.code}] ${text}` : text
}

export class VolcEngineImageAdapter implements ImageProviderAdapter {
  provider = 'volcengine'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const body: any = {
      model: record.model || config.model || 'doubao-seedream-5-0-260128',
      prompt: record.prompt,
      ...splitSize(record.size),
    }
    return {
      url: joinProviderUrl(config.baseUrl, API_PREFIX, '/images/generations'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    if (result.task_id || result.id) {
      return { isAsync: true, taskId: result.task_id || result.id }
    }
    const url = this.extractImageUrl(result) || result.url
    if (url) return { isAsync: false, imageUrl: url }
    throw new Error('No image URL in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, API_PREFIX, `/images/generations/${taskId}`),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    if (result.status === 'succeeded') {
      return { status: 'completed', imageUrl: result.data?.[0]?.url || result.image_url }
    }
    if (result.status === 'failed') {
      return { status: 'failed', error: pollError(result.error) }
    }
    return { status: result.status || 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return result.data?.[0]?.url || result.image_url || null
  }

  /** veImageX 恒回 URL，无内联 base64 形态 */
  extractImageBase64(_result: any): { data: string; mimeType: string } | null {
    return null
  }
}
