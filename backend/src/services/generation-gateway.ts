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
 * 网关速率闸门（拆分自 generation.ts）：按网关（provider|baseUrl）自适应提交节奏 + 429 指数退避。
 * 队列闸门（并发）与速率闸门（QPM）保持分离：并发槽位管同时在跑的任务数，节奏闸门管提交频率。
 */
import { logTaskWarn } from '../utils/task-logger.js'
import { assertAiCallEnabled } from './ai-switch.js'
import type { TaskType } from './generation-shared.js'
import type { AIConfig } from './adapters/types'

// ─── 限流保护：上游按请求速率（QPM）限流，并发槽位管不住突发提交 ───
// 1) 按网关自适应提交节奏：每个配置独立闸门，初始间隔取 settings.qpm（60000/qpm）或全局默认值；
//    命中 429 间隔翻倍（上限 120s），连续成功 10 次减半逐步恢复（下限为初始值）
// 2) 429 退避重试：命中限流不直接判失败，按指数退避自动重提，用户无感
// 队列闸门（并发）与速率闸门（QPM）保持分离：并发槽位管同时在跑的任务数，节奏闸门管提交频率

const SUBMIT_MIN_INTERVAL_MS = Math.max(0, Number(process.env.GEN_SUBMIT_INTERVAL_MS || 2000))
export const RATE_LIMIT_BACKOFFS_MS = [5_000, 15_000, 30_000, 60_000, 120_000]
const MAX_GATE_INTERVAL_MS = 120_000
const RECOVER_SUCCESS_STREAK = 10

interface GatewayGate {
  provider: string
  baseUrl: string
  baseIntervalMs: number
  intervalMs: number
  lastAt: number
  chain: Promise<void>
  submits: number
  rateLimited: number
  successStreak: number
}

const gatewayGates = new Map<string, GatewayGate>()

export function gatewayKey(config: AIConfig): string {
  return `${config.provider}|${config.baseUrl}`
}

function getOrCreateGate(config: AIConfig): GatewayGate {
  const key = gatewayKey(config)
  let gate = gatewayGates.get(key)
  if (!gate) {
    // 初始间隔：配置了 qpm 则按 60000/qpm，否则用全局默认提交间隔
    const baseIntervalMs = config.qpm ? Math.max(200, Math.ceil(60_000 / config.qpm)) : SUBMIT_MIN_INTERVAL_MS
    gate = {
      provider: config.provider,
      baseUrl: config.baseUrl,
      baseIntervalMs,
      intervalMs: baseIntervalMs,
      lastAt: 0,
      chain: Promise.resolve(),
      submits: 0,
      rateLimited: 0,
      successStreak: 0,
    }
    gatewayGates.set(key, gate)
  }
  return gate
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 串行节奏闸门（按网关）：每次提交前排队等待，保证该网关提交速率不超当前间隔（重试同样走闸门）
export function paceSubmission(config: AIConfig): Promise<void> {
  const gate = getOrCreateGate(config)
  const next = gate.chain.then(async () => {
    const wait = gate.lastAt + gate.intervalMs - Date.now()
    if (wait > 0) await sleep(wait)
    gate.lastAt = Date.now()
    gate.submits++
  })
  gate.chain = next.catch(() => {})
  return next
}

/** 命中限流：间隔翻倍（上限 120s），重置连续成功计数 */
export function onGatewayRateLimited(config: AIConfig) {
  const gate = getOrCreateGate(config)
  gate.rateLimited++
  gate.successStreak = 0
  gate.intervalMs = Math.min(gate.intervalMs * 2, MAX_GATE_INTERVAL_MS)
}

/** 提交成功：连续成功 10 次间隔减半（下限为初始值），逐步恢复吞吐 */
export function onGatewaySuccess(config: AIConfig) {
  const gate = getOrCreateGate(config)
  gate.successStreak++
  if (gate.successStreak % RECOVER_SUCCESS_STREAK === 0 && gate.intervalMs > gate.baseIntervalMs) {
    gate.intervalMs = Math.max(gate.baseIntervalMs, Math.floor(gate.intervalMs / 2))
  }
}

/** 各网关自适应限流统计（供 /admin/panel 生产面板） */
export function getGatewayRateStats() {
  return [...gatewayGates.entries()].map(([key, g]) => ({
    gateway: key,
    provider: g.provider,
    base_url: g.baseUrl,
    base_interval_ms: g.baseIntervalMs,
    interval_ms: g.intervalMs,
    submits: g.submits,
    rate_limited: g.rateLimited,
    success_streak: g.successStreak,
    last_submit_at: g.lastAt ? new Date(g.lastAt).toISOString() : null,
  }))
}

export function isRateLimitError(message: string): boolean {
  return /429|throttl|rate.?limit|too many requests/i.test(message)
}

export async function submitWithRetry<T>(submit: () => Promise<T>, label: string, id: number, config: AIConfig, singleShot = false, userId?: number | null): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      await paceSubmission(config)
      if (singleShot) await assertAiCallEnabled(userId)
      const result = await submit()
      onGatewaySuccess(config)
      return result
    } catch (err: any) {
      const msg = String(err?.message || err)
      if (singleShot || !isRateLimitError(msg) || attempt >= RATE_LIMIT_BACKOFFS_MS.length) throw err
      onGatewayRateLimited(config)
      const wait = RATE_LIMIT_BACKOFFS_MS[attempt]
      logTaskWarn(label, 'rate-limit-backoff', { id, attempt: attempt + 1, waitMs: wait, gateway: gatewayKey(config), error: msg.slice(0, 160) })
      await sleep(wait)
    }
  }
}
