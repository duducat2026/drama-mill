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
 * 模型调用总开关（用户侧）— 用户可自行关闭/打开本人的全部 AI 调用，用于成本控制与临时停机。
 *
 * 关闭语义（只拦「新发起」的调用，不误伤已计费任务）：
 * - 拦截：Agent 文本调用、图片/视频任务提交、失败任务重试、生产编排启动/继续
 *   （统一挂在 services/ai.ts 的配置解析处，任何 AI 调用都要先解析配置）
 * - 放行：已提交上游、正在轮询中的任务（其配置在提交时已进内存，不再走解析）；
 *   以及 userId 缺省的无归属链路（历史任务恢复等，避免误判为关闭）
 *
 * 状态存 users.ai_call_enabled（默认 1 = 开启，存量用户行为不变）。
 * 配置解析位于每次 AI 调用的热路径，故用进程内短 TTL 缓存避免逐次回查用户表；写入开关即时刷新缓存。
 */
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { db, schema } from '../db/index.js'
import { badRequest, now } from '../utils/response.js'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'

export const AI_CALL_DISABLED_MESSAGE = '模型调用已关闭，请先到「设置中心 → AI 服务」打开模型调用开关'

/** 开关关闭导致的拒绝：status 供全局 errorHandler 透出 409，路由内 catch 则退为 400，文案一致 */
export class AiCallDisabledError extends Error {
  status = 409
  constructor(message: string = AI_CALL_DISABLED_MESSAGE) {
    super(message)
    this.name = 'AiCallDisabledError'
  }
}

const CACHE_TTL_MS = 3000
const cache = new Map<number, { at: number; enabled: boolean }>()
// 拦截日志去重：同一用户在重新开启前只记一次，避免热路径刷屏
const blockedLogged = new Set<number>()

/** 该用户是否允许调用模型（userId 缺省/用户行缺失按放行处理，与历史链路保持一致） */
export async function isAiCallEnabled(userId?: number | null): Promise<boolean> {
  if (!userId) return true
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.enabled

  const [row] = await db.select({ aiCallEnabled: schema.users.aiCallEnabled })
    .from(schema.users).where(eq(schema.users.id, userId))
  // 列为 NULL（迁移未覆盖到的极端情况）按开启处理，遵循「默认开启」策略
  const enabled = row ? row.aiCallEnabled !== false : true
  cache.set(userId, { at: Date.now(), enabled })
  return enabled
}

/** 开关关闭时抛 AiCallDisabledError；调用点无需再判空（含生产编排、任务重试、配置解析） */
export async function assertAiCallEnabled(userId?: number | null): Promise<void> {
  if (await isAiCallEnabled(userId)) {
    if (userId) blockedLogged.delete(userId)
    return
  }
  if (userId && !blockedLogged.has(userId)) {
    blockedLogged.add(userId)
    logTaskWarn('AiSwitch', 'call-blocked', { userId, service: 'all' })
  }
  throw new AiCallDisabledError()
}

/** 写入开关：同步更新 DB 与进程内缓存，使同进程的后续读取立即看到新值 */
export async function setAiCallEnabled(userId: number, enabled: boolean): Promise<boolean> {
  await db.update(schema.users)
    .set({ aiCallEnabled: enabled, updatedAt: now() })
    .where(eq(schema.users.id, userId))
  cache.set(userId, { at: Date.now(), enabled })
  if (enabled) blockedLogged.delete(userId)
  logTaskProgress('AiSwitch', 'toggle', { userId, enabled })
  return enabled
}

/**
 * 路由级守卫：开关关闭时返回统一错误响应，放行时返回 null（调用方 `if (blocked) return blocked`）。
 * 直接读鉴权中间件注入的用户行状态，零额外查询；用于生产编排等长链路入口的即时反馈。
 */
export function aiCallGuard(c: Context): Response | null {
  const user = c.get('user')
  if (user && user.aiCallEnabled === false) return badRequest(c, AI_CALL_DISABLED_MESSAGE)
  return null
}
