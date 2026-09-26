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
 * 生产流水线并发与速率配置 — 按环节独立调节，适配上游 TPM/QPM 限额
 *
 * 设计原则（与 generation.ts 的限流体系一致）：
 * - 并发槽位管"同时在跑的任务数"，节奏闸门管"请求发起频率"，二者分离
 * - 文本类 AI（剧本改写/资产提取/分镜/提示词/小说拆分）吃 TPM：
 *   并发上限 + 相邻请求最小间隔（节奏闸门）双约束
 * - 图片/视频生成吃 QPM：沿用 generation.ts 的槽位 + 网关自适应节奏闸门，
 *   这里只调节图片/视频各自的并发槽位上限
 *
 * 全部通过环境变量调节（改 .env 重启生效），默认值为保守安全值。
 */

function envInt(name: string, fallback: number, min = 1): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? Math.max(min, Math.floor(v)) : fallback
}

// ─── 文本类 AI（TPM 敏感）─────────────────────────────
// 同时发起的文本 Agent 调用上限（提取默认 3 类并行，给 3；TPM 紧张可调到 1）
export const TEXT_AI_MAX_CONCURRENT = envInt('TEXT_AI_MAX_CONCURRENT', 3)
// 相邻两次文本 Agent 调用发起的最小间隔（毫秒），0 = 不加节奏闸门
export const TEXT_AI_MIN_INTERVAL_MS = Math.max(0, Number(process.env.TEXT_AI_MIN_INTERVAL_MS || 0))

// ─── 图片 / 视频生成（QPM 敏感）──────────────────────
// 各自并发槽位上限；未单独配置时回退到通用 GEN_MAX_CONCURRENT（默认 3）
// 视频槽位口径：百炼各视频模型限流池相互独立（各 5 并发），配置内多模型时提交前自动分流（见 generation.ts），
// 双模型建议设 10（2 池 × 5）、三模型设 15（3 池 × 5），按池数成倍吃吞吐；单模型部署设 5，超出部分仅在上游排队无收益且拖长素材链接有效期风险
const GEN_MAX_CONCURRENT = envInt('GEN_MAX_CONCURRENT', 3)
export const GEN_MAX_CONCURRENT_IMAGE = envInt('GEN_MAX_CONCURRENT_IMAGE', GEN_MAX_CONCURRENT)
export const GEN_MAX_CONCURRENT_VIDEO = envInt('GEN_MAX_CONCURRENT_VIDEO', GEN_MAX_CONCURRENT)

// ─── 批量生产编排 ─────────────────────────────────────
// 同时生产的短剧数：默认 1（严格按上传顺序逐部推进，最省配额）
export const BATCH_DRAMA_CONCURRENCY = envInt('BATCH_DRAMA_CONCURRENCY', 1)
// 错峰启动间隔（毫秒）：相邻短剧启动的最小延迟，避免多部同时竞争同一模型的 TPM/QPM
// 默认 0（不延迟）；建议设为 120000~300000（2~5 分钟），让先启动的短剧进入后续步骤后再启动下一部
export const BATCH_STAGGER_DELAY_MS = Math.max(0, Number(process.env.BATCH_STAGGER_DELAY_MS || 0))
// 单个短剧生产失败是否中止整个批次（默认继续下一部）
export const BATCH_STOP_ON_ERROR = String(process.env.BATCH_STOP_ON_ERROR || 'false').toLowerCase() === 'true'

// ─── 项目生产编排 ─────────────────────────────────────
// 单部短剧内同时生成视频的集数上限：默认 5；视频阶段已不占前置窗口（编排解耦），集数调大可保持上游持续有料；
// 多模型分流后上游总并发容量成倍增长（见 GEN_MAX_CONCURRENT_VIDEO 注释），集数过低会让上游槽位空转
export const PROD_EPISODE_CONCURRENCY = envInt('PROD_EPISODE_CONCURRENCY', 5)
// 单部短剧内同时推进前 5 步（剧本改写→资产图片）的集数：默认 8
// 前 5 步受全局文本/图片槽位与节奏闸门约束，窗口更大可让非视频模型在视频生成期间持续工作
export const PROD_PRE_VIDEO_CONCURRENCY = envInt('PROD_PRE_VIDEO_CONCURRENCY', 8)
// 启动预热：分镜拆分之前的步骤（剧本改写→资产提取）对所有集全量快速并行的集数上限：默认 20
// 实际吞吐仍受 TEXT_AI_MAX_CONCURRENT 全局槽位约束，调大只是抬高入队上限，防止队列空等
export const PROD_PRE_STORYBOARD_CONCURRENCY = envInt('PROD_PRE_STORYBOARD_CONCURRENCY', 20)

// ─── 资产图片巡检看门狗 ───────────────────────────────
// 巡检间隔（毫秒）：定期为生产中/中断项目中缺图的资产重提图片任务；默认 20 分钟，下限 1 分钟
export const ASSET_WATCHDOG_INTERVAL_MS = Math.max(60_000, Number(process.env.ASSET_WATCHDOG_INTERVAL_MS || 20 * 60 * 1000))
// 单次巡检重提任务上限：防止一次性 burst 提交挤占图片并发槽位（剩余留给下一轮）
export const ASSET_WATCHDOG_MAX_RESUBMIT = envInt('ASSET_WATCHDOG_MAX_RESUBMIT', 30)

// ─── 上游队列水位限流（视频提交闸门）────────────────────
// 上游 PENDING 达水位线时暂停新视频提交，防深排队拖长耗时/参考素材内部链接过期；
// 批量任务列表接口仅中央域名可用（workspace 专属域名 404），查询失败时闸门自动放行（保守不阻塞）
export const UPSTREAM_VIDEO_PENDING_WATERMARK = envInt('UPSTREAM_VIDEO_PENDING_WATERMARK', 20)
// 水位超限时的复查间隔（毫秒）：定期重查上游队列，降到水位线以下才放行提交；下限 10 秒防打满列表接口限流（20 QPS）
export const UPSTREAM_WATERMARK_CHECK_INTERVAL_MS = Math.max(10_000, Number(process.env.UPSTREAM_WATERMARK_CHECK_INTERVAL_MS || 30_000))
// 水位等待上限（毫秒）：超过后强制放行，防上游查询异常/队列长期不降时无限卡死；默认 20 分钟
export const UPSTREAM_WATERMARK_MAX_WAIT_MS = Math.max(60_000, Number(process.env.UPSTREAM_WATERMARK_MAX_WAIT_MS || 20 * 60_000))

// ─── 生成任务超时与失败自动恢复 ────────────────────────
// 视频生成超时阈值（毫秒）：超过该时长仍未完成的任务判定失败；默认 30 分钟，下限 5 分钟
export const VIDEO_TASK_TIMEOUT_MS = Math.max(5 * 60_000, Number(process.env.VIDEO_TASK_TIMEOUT_MS || 30 * 60_000))
// 视频生成硬性墙钟上限（毫秒）：无论上游是否返回健康状态，超过该时长一律判失败；默认 4 小时，下限 1 小时
export const VIDEO_TASK_HARD_LIMIT_MS = Math.max(60 * 60_000, Number(process.env.VIDEO_TASK_HARD_LIMIT_MS || 4 * 60 * 60_000))
// 失败自动恢复巡检间隔（毫秒）：判卡死 + 重提失败任务；默认 5 分钟，下限 1 分钟
export const GEN_TASK_RECOVERY_INTERVAL_MS = Math.max(60_000, Number(process.env.GEN_TASK_RECOVERY_INTERVAL_MS || 5 * 60_000))
// 单个失败任务自动重提上限（手动重试会重置计数）；设为 0 关闭自动恢复，默认 3 次
export const GEN_TASK_AUTO_RETRY_MAX = (() => {
  const v = Number(process.env.GEN_TASK_AUTO_RETRY_MAX)
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 3
})()
// 自动重提仅覆盖最近窗口期内的失败任务，更早的失败留给人工处理（默认 6 小时）
export const GEN_TASK_AUTO_RETRY_WINDOW_MS = Math.max(10 * 60_000, Number(process.env.GEN_TASK_AUTO_RETRY_WINDOW_MS || 6 * 3600 * 1000))
// 失败后至少停留该时长才允许自动重提：留出手动重试/看门狗判卡死的缓冲（默认 2 分钟）
export const GEN_TASK_AUTO_RETRY_MIN_AGE_MS = Math.max(30_000, Number(process.env.GEN_TASK_AUTO_RETRY_MIN_AGE_MS || 2 * 60_000))
// 单轮巡检自动重提上限：重提走生成队列受并发槽位/节奏闸门约束，仍限量防 burst（默认 20）
export const GEN_TASK_AUTO_RETRY_MAX_PER_SWEEP = envInt('GEN_TASK_AUTO_RETRY_MAX_PER_SWEEP', 20)


// ─── 文本 AI 节奏闸门 + 并发槽位（全局单例）────────────
let textRunning = 0
const textQueue: Array<() => void> = []
let lastTextStartAt = 0
let textGateChain: Promise<void> = Promise.resolve()

/** 节奏闸门：串行排队，保证相邻调用发起间隔不低于 TEXT_AI_MIN_INTERVAL_MS */
function paceTextCall(): Promise<void> {
  const next = textGateChain.then(async () => {
    if (TEXT_AI_MIN_INTERVAL_MS <= 0) return
    const wait = lastTextStartAt + TEXT_AI_MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    lastTextStartAt = Date.now()
  })
  textGateChain = next.catch(() => {})
  return next
}

/**
 * 文本 AI 调用包裹器：并发上限 + 节奏闸门
 * 所有会发起文本模型调用的批处理环节（提取/视频提示词/小说拆分等）统一走这里
 */
export async function withTextSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (textRunning >= TEXT_AI_MAX_CONCURRENT) {
    await new Promise<void>(resolve => textQueue.push(resolve))
  }
  textRunning++
  try {
    await paceTextCall()
    return await fn()
  } finally {
    textRunning--
    textQueue.shift()?.()
  }
}

/** 当前各环节并发配置（供管理/状态接口展示） */
export function getRateConfig() {
  return {
    text_ai: {
      max_concurrent: TEXT_AI_MAX_CONCURRENT,
      min_interval_ms: TEXT_AI_MIN_INTERVAL_MS,
      running: textRunning,
      queued: textQueue.length,
    },
    generation: {
      image_max_concurrent: GEN_MAX_CONCURRENT_IMAGE,
      video_max_concurrent: GEN_MAX_CONCURRENT_VIDEO,
      submit_interval_ms: Math.max(0, Number(process.env.GEN_SUBMIT_INTERVAL_MS || 2000)),
      upstream_video_pending_watermark: UPSTREAM_VIDEO_PENDING_WATERMARK,
      upstream_watermark_check_interval_ms: UPSTREAM_WATERMARK_CHECK_INTERVAL_MS,
      upstream_watermark_max_wait_ms: UPSTREAM_WATERMARK_MAX_WAIT_MS,
    },
    batch: {
      drama_concurrency: BATCH_DRAMA_CONCURRENCY,
      stagger_delay_ms: BATCH_STAGGER_DELAY_MS,
      stop_on_error: BATCH_STOP_ON_ERROR,
    },
    production: {
      episode_concurrency: PROD_EPISODE_CONCURRENCY,
      pre_video_concurrency: PROD_PRE_VIDEO_CONCURRENCY,
      pre_storyboard_concurrency: PROD_PRE_STORYBOARD_CONCURRENCY,
    },
    asset_watchdog: {
      interval_ms: ASSET_WATCHDOG_INTERVAL_MS,
      max_resubmit: ASSET_WATCHDOG_MAX_RESUBMIT,
    },
    task_recovery: {
      interval_ms: GEN_TASK_RECOVERY_INTERVAL_MS,
      video_timeout_ms: VIDEO_TASK_TIMEOUT_MS,
      video_hard_limit_ms: VIDEO_TASK_HARD_LIMIT_MS,
      auto_retry_max: GEN_TASK_AUTO_RETRY_MAX,
      auto_retry_window_ms: GEN_TASK_AUTO_RETRY_WINDOW_MS,
      auto_retry_max_per_sweep: GEN_TASK_AUTO_RETRY_MAX_PER_SWEEP,
    },
  }
}
