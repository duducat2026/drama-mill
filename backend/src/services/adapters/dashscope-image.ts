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
 * DashScope 图片适配器：
 * - 端点: POST /api/v1/services/aigc/multimodal-generation/generation
 * - wan2.7 系列：双模式自适应（优先异步 → 403 降级同步）
 * - wan2.6-image：仅支持 SSE 同步流式（stream=true + X-DashScope-SSE）
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
import {
  asyncHeaders,
  asyncSupportCache,
  extractImageFromChoices,
  fitInterleaveSize,
  formatTaskError,
  isStreamOnlyModel,
  mapTaskStatus,
  parseReferenceImages,
  syncHeaders,
  toDashScopeSize,
} from './dashscope-shared'

export class DashScopeImageAdapter implements ImageProviderAdapter {
  provider = 'dashscope'

  /**
   * 端点/请求头/兜底模型的可覆写钩子：请求体形状（input.messages + parameters）
   * 与响应解析在 DashScope 兼容网关（如 Model Router）下完全一致，只有这几处不同。
   */
  protected generateUrl(config: AIConfig): string {
    return joinProviderUrl(config.baseUrl, '/api/v1', '/services/aigc/multimodal-generation/generation')
  }

  protected asyncSubmitUrl(config: AIConfig): string {
    return joinProviderUrl(config.baseUrl, '/api/v1', '/services/aigc/text2image/image-synthesis')
  }

  protected pollUrl(config: AIConfig, taskId: string): string {
    return joinProviderUrl(config.baseUrl, '/api/v1', `/tasks/${taskId}`)
  }

  protected submitHeaders(apiKey: string): Record<string, string> {
    return asyncHeaders(apiKey)
  }

  /** 网关是否有独立异步文生图端点（没有则统一走同步多模态端点） */
  protected supportsAsyncImage(): boolean {
    return true
  }

  protected defaultImageModel(): string {
    return 'wan2.7-image'
  }

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = record.model || config.model || this.defaultImageModel()
    if (!record.prompt?.trim()) throw new Error('DashScope 文生图要求提供提示词')

    // messages content: 参考图（图生图）+ 文本提示词
    const content: Array<Record<string, string>> = []
    const refImages = parseReferenceImages(record.referenceImages)
    for (const url of refImages) content.push({ image: url })
    content.push({ text: record.prompt })

    const parameters: Record<string, any> = {
      size: toDashScopeSize(record.size),
      n: 1,
    }
    const headers = syncHeaders(config.apiKey)
    if (isStreamOnlyModel(model)) {
      // wan2.6-image 仅支持 SSE 流式：stream=true 必填，纯文生图需 enable_interleave
      headers['X-DashScope-SSE'] = 'enable'
      parameters.stream = true
      if (!refImages.length) {
        parameters.enable_interleave = true
        parameters.max_images = 1
        // interleave 模式总像素有硬限制，超限尺寸归并到就近合法档位
        parameters.size = fitInterleaveSize(parameters.size)
      }
    }

    return {
      url: this.generateUrl(config),
      method: 'POST',
      headers,
      body: {
        model,
        input: { messages: [{ role: 'user', content }] },
        parameters,
      },
    }
  }

  /**
   * 双模式自适应执行：
   * 1. 流式模型（wan2.6-image）→ 直接 SSE 流式
   * 2. 其他模型 → 优先异步任务提交（纯文生图），返回含 task_id 的提交响应，
   *    后续由统一轮询流程接管；被 403（不支持异步）拒绝时降级同步多模态调用
   */
  async executeGenerate(config: AIConfig, record: ImageGenerationRecord): Promise<any> {
    const model = record.model || config.model || this.defaultImageModel()
    if (isStreamOnlyModel(model)) return this.executeStream(config, record)

    const refImages = parseReferenceImages(record.referenceImages)
    // 图生图带参考图，异步文生图端点不支持，直接同步；未探测过异步的先试异步
    if (this.supportsAsyncImage() && !refImages.length && asyncSupportCache.get(config.baseUrl) !== false) {
      const asyncResult = await this.trySubmitAsync(config, record, model)
      if (asyncResult) return asyncResult
    }

    // 同步多模态调用
    const req = this.buildGenerateRequest(config, record)
    const resp = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(600_000),
    })
    if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`)
    return await resp.json()
  }

  /**
   * 尝试异步任务提交（text2image 端点 + X-DashScope-Async）。
   * 成功返回提交响应（含 output.task_id）；工作空间不支持异步（403）时返回 null 降级。
   */
  private async trySubmitAsync(config: AIConfig, record: ImageGenerationRecord, model: string): Promise<any | null> {
    const req: ProviderRequest = {
      url: this.asyncSubmitUrl(config),
      method: 'POST',
      headers: this.submitHeaders(config.apiKey),
      body: {
        model,
        input: { prompt: record.prompt },
        parameters: { size: toDashScopeSize(record.size), n: 1 },
      },
    }
    const resp = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(60_000),
    })
    if (resp.ok) {
      asyncSupportCache.set(config.baseUrl, true)
      return await resp.json()
    }
    const text = await resp.text()
    if (resp.status === 403 && /asynchronous/i.test(text)) {
      // 工作空间权限限制不支持异步，记住后不再试探，降级同步
      asyncSupportCache.set(config.baseUrl, false)
      return null
    }
    throw new Error(`API error ${resp.status}: ${text}`)
  }

  /** wan2.6-image 等流式模型：消费 SSE 流，收敛为与同步响应同构的最终结果对象 */
  private async executeStream(config: AIConfig, record: ImageGenerationRecord): Promise<any> {
    const req = this.buildGenerateRequest(config, record)
    const resp = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(600_000),
    })
    if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`)

    const raw = await resp.text()
    let finalChunk: any = null
    for (const line of raw.split('\n')) {
      const data = line.trim()
      if (!data.startsWith('data:')) continue
      let chunk: any
      try {
        chunk = JSON.parse(data.slice(5))
      } catch {
        continue
      }
      // 错误事件（鉴权/参数/审核等）直接报错
      if (chunk?.code) throw new Error(`[${chunk.code}] ${chunk.message || 'Generation failed'}`)
      if (chunk?.output) finalChunk = chunk
    }
    if (!finalChunk) throw new Error('No valid SSE chunk in streaming response')
    return finalChunk
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const taskId = result.output?.task_id
    if (taskId) return { isAsync: true, taskId: String(taskId) }
    const imageUrl = extractImageFromChoices(result) || result.output?.results?.[0]?.url
    if (imageUrl) return { isAsync: false, imageUrl }
    throw new Error('No task_id or image url in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: this.pollUrl(config, taskId),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    const output = result.output || {}
    const status = mapTaskStatus(output.task_status)
    if (status === 'completed') {
      return { status, imageUrl: extractImageFromChoices(result) || output.results?.[0]?.url || null }
    }
    if (status === 'failed') {
      return { status, error: formatTaskError(output) }
    }
    return { status }
  }

  extractImageUrl(result: any): string | null {
    return extractImageFromChoices(result) || result.output?.results?.[0]?.url || null
  }

  extractImageBase64(): { data: string; mimeType: string } | null {
    return null
  }
}
