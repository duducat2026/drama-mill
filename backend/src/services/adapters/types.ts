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
 * 生图厂商适配层契约。一个实现类接管某 provider 的全部 HTTP 方言：
 * 拼请求（build*）、判形态（parseGenerateResponse 同步/异步）、
 * 轮询解包（parsePollResponse）、结果取图（extract*）。
 */
export interface ImageProviderAdapter {
  /** provider 键名（注册表索引） */
  provider: string

  /** 组装一次生成调用的完整 HTTP 描述 */
  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest

  /** 判定生成响应形态：拿到图片 URL 还是只拿到待轮询的 taskId */
  parseGenerateResponse(result: any): ImageGenResponse

  /** 异步形态下组装轮询请求 */
  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest

  /** 解包轮询响应为统一状态机 */
  parsePollResponse(result: any): ImagePollResponse

  /** 响应里现成的图片 URL（可直接下载）；返回 null 说明载荷是 base64，改走 extractImageBase64 */
  extractImageUrl(result: any): string | null

  /** 内联 base64 图片提取消（Gemini 这类不回 URL、只回字节流的厂商） */
  extractImageBase64(result: any): { data: string; mimeType: string } | null

  /**
   * 逃生舱：需要完全接管一次生成调用时才实现。
   * 例如百炼 wan2.6-image 只认 SSE 流式返回，套不进统一的 fetch+JSON 管道，
   * 由适配器自行收流，最后归约成 parseGenerateResponse 认得的形状。
   */
  executeGenerate?(config: AIConfig, record: ImageGenerationRecord): Promise<any>
}

/** 生视频厂商适配层契约（全部为异步任务制，故无内联图片类钩子） */
export interface VideoProviderAdapter {
  provider: string

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest

  /** 提交响应：一般只回 taskId；个别同步直出视频 URL 的网关也在此表达 */
  parseGenerateResponse(result: any): VideoGenResponse

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest

  parsePollResponse(result: any): VideoPollResponse

  /** 从任意响应形态中捞出可下载地址 */
  extractVideoUrl(result: any): string | null
}

// ============ 以下为实现层共享的传输/负载类型 ============

/** 一次出站 HTTP 调用的完整描述（URL/method/headers/body 四件套） */
export interface ProviderRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

/** 一条 AI 服务配置展开后的运行期视图 */
export interface AIConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  /** 该配置挂载的全部模型（model 列 JSON 数组）；网关分流时按负载选路，未配置退化为单 model */
  models?: string[]
  /** 所属配置行 ID：网关限流与成本归集要按它分组；任务重启恢复路径可能拿不到 */
  configId?: number
  /** 采样温度；服务商默认即 null */
  temperature?: number | null
  /** 网关每分钟提交配额，空则走全局默认提交间隔 */
  qpm?: number | null
}

/** 生图任务行（只暴露适配器会用到的列） */
export interface ImageGenerationRecord {
  id: number
  model?: string | null
  prompt?: string | null
  size?: string | null
  frameType?: string | null
  referenceImages?: string | null
  // ... 其他字段
}

/** 生视频任务行（只暴露适配器会用到的列） */
export interface VideoGenerationRecord {
  id: number
  model?: string | null
  prompt?: string | null
  referenceMode?: string | null
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string | null
  referenceVideoUrls?: string | null
  referenceAudioUrls?: string | null
  generateAudio?: number | boolean | null
  duration?: number | null
  aspectRatio?: string | null
  resolution?: string | null
  // ... 其他字段
}

/** 生成提交后的二选一形态：imageUrl（同步直出）或 taskId（转轮询） */
export interface ImageGenResponse {
  isAsync: boolean
  taskId?: string
  imageUrl?: string
}

/** 轮询归一化状态 */
export interface ImagePollResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  imageUrl?: string
  error?: string
}

export interface VideoGenResponse {
  isAsync: boolean
  taskId?: string
  videoUrl?: string
}

export interface VideoPollResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
}
