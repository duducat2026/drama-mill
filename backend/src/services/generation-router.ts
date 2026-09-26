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
 * 上游水位闸 & 多视频模型分流（拆分自 generation.ts）：
 * - 百炼视频提交前按上游 PENDING 水位暂缓，避免深排队拖长单任务耗时
 * - 配置内多模型时按在途量把新任务分给压力小的模型池（候选先按素材形态过滤）
 */
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import type { AIConfig } from './adapters/types'
import { UPSTREAM_VIDEO_PENDING_WATERMARK, UPSTREAM_WATERMARK_CHECK_INTERVAL_MS, UPSTREAM_WATERMARK_MAX_WAIT_MS } from '../utils/rate-config.js'
import { sleep } from './generation-gateway.js'

// ─── 上游队列水位闸门：PENDING 达水位线时暂停新视频提交 ───
// 深排队会拖长单任务耗时、并让上游内部转储的参考素材链接（有效期有限）在轮到执行前过期；
// 仅对百炼视频任务生效（批量任务列表接口只支持中央域名）；查询失败时放行（不因监测故障阻塞生产）

// 云端任务模块动态加载缓存：避免 generation ↔ cloud-tasks 的静态依赖（仅水位闸门面用）
let cloudTasksModule: Promise<typeof import('./cloud-tasks.js')> | null = null

// 水位复查结果短缓存：多任务并发提交时共享同一次查询，避免打满列表接口限流（20 QPS）；
// 键带模型：多模型分流后不同模型的队列深度相互独立，不可互用（早期只按 Key 缓存会串模型）
const watermarkCache = new Map<string, { at: number; count: number }>()
const WATERMARK_CACHE_TTL_MS = 15_000

async function upstreamPendingCount(config: AIConfig, model: string): Promise<{ count: number; error: string | null }> {
  cloudTasksModule ??= import('./cloud-tasks.js')
  const mod = await cloudTasksModule
  const cacheKey = `${config.apiKey}:${model}`
  const cached = watermarkCache.get(cacheKey)
  if (cached && Date.now() - cached.at < WATERMARK_CACHE_TTL_MS) return { count: cached.count, error: null }
  const res = await mod.fetchCloudPendingCount(config.apiKey, model)
  if (!res.error) watermarkCache.set(cacheKey, { at: Date.now(), count: res.count })
  return res
}

export async function waitForUpstreamWatermark(id: number, config: AIConfig, model: string): Promise<void> {
  if (config.provider !== 'dashscope' || UPSTREAM_VIDEO_PENDING_WATERMARK <= 0) return
  const startedAt = Date.now()
  for (;;) {
    const { count, error } = await upstreamPendingCount(config, model)
    if (error) {
      // 监测不可用（如 workspace 域名限制/网络异常）：放行，不因查询故障阻塞生产；
      // 清掉可能残留的旧缓存，避免故障前的数值长期卡住闸门（失败时不会写入，这里双保险）
      watermarkCache.delete(`${config.apiKey}:${model}`)
      return
    }
    if (count < UPSTREAM_VIDEO_PENDING_WATERMARK) return
    if (Date.now() - startedAt >= UPSTREAM_WATERMARK_MAX_WAIT_MS) {
      logTaskWarn('VideoTask', 'watermark-wait-timeout', { id, pending: count, watermark: UPSTREAM_VIDEO_PENDING_WATERMARK, waitedMs: Date.now() - startedAt })
      return
    }
    logTaskProgress('VideoTask', 'watermark-wait', { id, pending: count, watermark: UPSTREAM_VIDEO_PENDING_WATERMARK, recheckMs: UPSTREAM_WATERMARK_CHECK_INTERVAL_MS })
    await sleep(UPSTREAM_WATERMARK_CHECK_INTERVAL_MS)
  }
}

// ─── 多视频模型分流：提交前按上游负载选模型 ───
// 百炼视频各模型限流池相互独立（各 5 并发）：配置内多模型时把新任务分给在途量（PENDING+RUNNING）
// 更小的池，多池并行成倍吃并发；单个候选探测失败仅跳过该候选，成功不足 2 个才回退默认模型。
// 结果短缓存（与水位闸门同款 15s）：并发提交共享同一次探测，避免打满列表接口限流（20 QPS）

const inflightCache = new Map<string, { at: number; count: number; error: string | null }>()

async function upstreamInflightCount(apiKey: string, model: string): Promise<{ count: number; error: string | null }> {
  cloudTasksModule ??= import('./cloud-tasks.js')
  const mod = await cloudTasksModule
  const cacheKey = `${apiKey}:${model}`
  const cached = inflightCache.get(cacheKey)
  if (cached && Date.now() - cached.at < WATERMARK_CACHE_TTL_MS) return { count: cached.count, error: cached.error }
  const res = await mod.fetchCloudInflightCount(apiKey, model)
  // 成功与失败均缓存 15s：失败也缓存是为了斩断并发重探风暴
  // （不缓存时 N 个并发提交各自重探，403/429 会自我放大）
  inflightCache.set(cacheKey, { at: Date.now(), count: res.count, error: res.error })
  return res
}

/**
 * 候选模型素材兼容性过滤：不同模型族接受的素材类型互斥，不兼容的候选不参与分流，
 * 避免把带参考图的任务分给纯文生视频（丢角色一致性）或把无素材任务分给 r2v/i2v（提交必失败）
 */
export function isModelCompatibleWithMedia(model: string, media: { hasReferenceImages: boolean; hasFirstFrame: boolean }): boolean {
  if (model.endsWith('-t2v')) return !media.hasReferenceImages && !media.hasFirstFrame
  if (model.endsWith('-i2v')) return media.hasFirstFrame
  if (model.endsWith('-r2v')) return media.hasReferenceImages
  return true
}

/**
 * 多模型分流选模：候选为配置内全部视频模型（先按任务素材形态过滤）；单个候选负载探测失败（如部分模型不支持
 * 列表查询或触发 429）仅跳过该候选，成功不足 2 个才回退默认模型；
 * 否则取在途量最小者，负载相同取配置顺序靠前（通常即默认模型），避免无谓震荡。
 * 切换只发生在提交瞬间，回写任务落库模型（后续轮询/展示/水位闸门均按实际提交模型）
 */
export async function pickLeastLoadedVideoModel(
  id: number,
  config: AIConfig,
  fallback: string,
  media: { hasReferenceImages: boolean; hasFirstFrame: boolean } = { hasReferenceImages: false, hasFirstFrame: false },
): Promise<string> {
  if (config.provider !== 'dashscope' && config.provider !== 'model-router') return fallback
  const models = (config.models || []).filter(m => !!m && m.trim())
  // Model Router 没有百炼那个按 apiKey 查在途量的中央接口，只按素材形态过滤，不探负载：
  // 配置把 i2v/r2v 排在首位时，无首帧/无参考图的任务会被换成兼容模型，而不是提交必失败。
  if (config.provider === 'model-router') {
    const compatible = models.filter(m => isModelCompatibleWithMedia(m, media))
    if (!compatible.length) return fallback
    const picked = compatible.includes(fallback) ? fallback : compatible[0]
    if (picked !== fallback) logTaskProgress('VideoTask', 'model-media-filter', { id, from: fallback, to: picked })
    return picked
  }
  const candidates = models
    .filter(m => m === fallback || isModelCompatibleWithMedia(m, media))
  if (candidates.length < 2) return fallback
  let best = fallback
  let bestLoad = Number.POSITIVE_INFINITY
  let probed = 0
  for (const m of candidates) {
    const { count, error } = await upstreamInflightCount(config.apiKey, m)
    if (error) {
      logTaskWarn('VideoTask', 'model-balance-skip', { id, model: m, error })
      continue
    }
    probed++
    if (count < bestLoad) { bestLoad = count; best = m }
  }
  if (probed < 2) return fallback
  if (best !== fallback) logTaskProgress('VideoTask', 'model-balance', { id, from: fallback, to: best, inflight: bestLoad })
  return best
}
