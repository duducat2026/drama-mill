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
 * DashScope 适配器共享层：请求头 / 模型名规范 / 尺寸归并 / 任务状态映射 等纯函数与常量。
 */
import type { ImagePollResponse } from './types'

export const ASYNC_HEADER = { 'X-DashScope-Async': 'enable' } as const

/** Model Router 网关用 symbol/model 形式（如 qwen/wan2.7-image），原生百炼不带前缀 */
export function stripModelSymbol(model: string): string {
  const i = model.lastIndexOf('/')
  return i >= 0 ? model.slice(i + 1) : model
}

/** 仅支持 SSE 同步流式的模型（不支持普通同步/异步调用） */
export const isStreamOnlyModel = (model: string) => stripModelSymbol(model).startsWith('wan2.6-image')

/**
 * 图片异步任务支持探测缓存: baseUrl → 是否支持异步。
 * 专属工作空间可能限制图片异步调用（403），探测一次后避免每次请求重复试探。
 */
export const asyncSupportCache = new Map<string, boolean>()

/** 同步调用请求头（图片多模态端点）；子类复用时会带上自己的异步头 */
export function syncHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  }
}

/** 异步任务请求头（视频端点） */
export function asyncHeaders(apiKey: string): Record<string, string> {
  return { ...syncHeaders(apiKey), ...ASYNC_HEADER }
}

/** DashScope 任务状态 → 内部轮询状态 */
export function mapTaskStatus(status?: string): ImagePollResponse['status'] {
  switch ((status || '').toUpperCase()) {
    case 'SUCCEEDED':
      return 'completed'
    case 'FAILED':
    case 'UNKNOWN':
      return 'failed'
    case 'PENDING':
      return 'pending'
    default:
      return 'processing'
  }
}

/** 轮询失败时的错误信息规范化：{ code, message } → "[code] message" */
export function formatTaskError(output: any): string {
  const msg = output?.message || output?.code || 'Generation failed'
  return output?.code ? `[${output.code}] ${output.message || msg}` : msg
}

/** 项目侧 1024x1024 尺寸格式 → DashScope 1024*1024 格式 */
export function toDashScopeSize(size?: string | null): string {
  const normalized = (size || '').toLowerCase().replace(/x/g, '*')
  return /^\d+\*\d+$/.test(normalized) ? normalized : '1024*1024'
}

/** 宽高比 → DashScope size（常用档位，wan2.7/wan2.6 视频用） */
export const RATIO_SIZES: Record<string, string> = {
  '16:9': '1280*720',
  '9:16': '720*1280',
  '1:1': '960*960',
  '4:3': '1104*832',
  '3:4': '832*1104',
  '21:9': '1680*720',
}

/** wan3.0 视频模型检测 */
export const isWan3VideoModel = (model: string) => stripModelSymbol(model).startsWith('wan3.0')

/** happyhorse 视频模型族（1.1/1.0 的 t2v/i2v/r2v），请求格式与 wan3.0 同源（ratio + resolution） */
export const isHappyHorseVideoModel = (model: string) => stripModelSymbol(model).startsWith('happyhorse')

/** wan3.0 ratio 合法值 */
const WAN3_VALID_RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16'])
export const toWan3Ratio = (r?: string | null): string => {
  const trimmed = (r || '').trim()
  return WAN3_VALID_RATIOS.has(trimmed) ? trimmed : '16:9'
}

/** wan2.6-image enable_interleave 合法像素区间（服务端硬限制） */
const INTERLEAVE_PIXEL_MIN = 589824
const INTERLEAVE_PIXEL_MAX = 1638400

/** 总像素在合法区间内的常用档位，超限时按宽高比就近归并 */
const INTERLEAVE_SAFE_SIZES = [
  '1024*1024', '1280*720', '720*1280', '960*960',
  '1104*832', '832*1104', '1328*1328', '1472*704', '704*1472',
]

/** 超限尺寸 → 保持宽高比就近归并到合法档位 */
export function fitInterleaveSize(size: string): string {
  const [w, h] = size.split('*').map(Number)
  const pixels = w * h
  if (pixels >= INTERLEAVE_PIXEL_MIN && pixels <= INTERLEAVE_PIXEL_MAX) return size
  const ratio = w / h
  let best = INTERLEAVE_SAFE_SIZES[0]
  let bestScore = Infinity
  for (const s of INTERLEAVE_SAFE_SIZES) {
    const [cw, ch] = s.split('*').map(Number)
    const score = Math.abs(Math.log(cw / ch / ratio))
    if (score < bestScore) {
      bestScore = score
      best = s
    }
  }
  return best
}

/** 多模态统一端点响应中提取图片: output.choices[].message.content[].image */
export function extractImageFromChoices(result: any): string | null {
  const choices = result?.output?.choices
  if (!Array.isArray(choices)) return null
  for (const choice of choices) {
    const content = choice?.message?.content
    if (!Array.isArray(content)) continue
    for (const item of content) {
      if (item?.image) return item.image
    }
  }
  return null
}

/** referenceImages 字段（JSON 数组或逗号分隔）→ URL 列表 */
export function parseReferenceImages(raw?: string | null): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter(u => typeof u === 'string' && u.trim())
  } catch { /* 非 JSON，按逗号分隔处理 */ }
  return raw.split(',').map(u => u.trim()).filter(Boolean)
}
