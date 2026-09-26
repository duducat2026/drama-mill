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
 * Agent 执行共享逻辑 — 路由（同步/异步）与生产编排器共用
 */
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { withTextSlot } from '../utils/rate-config.js'

// Mastra v1.17 的 ToolCallChunk / ToolResultChunk 结构：
// { type: 'tool-call', payload: { toolCallId, toolName, args } }
// { type: 'tool-result', payload: { toolCallId, toolName, result, isError } }
export function normalizeToolName(entry: any) {
  return entry?.payload?.toolName
    || entry?.toolName
    || entry?.tool?.toolName
    || entry?.tool?.id
    || entry?.name
    || entry?.type
    || null
}

export function normalizeToolResult(entry: any) {
  const result = entry?.payload?.result ?? entry?.result ?? entry?.payload?.output ?? entry?.output ?? entry?.data ?? null
  return typeof result === 'string' ? result : JSON.stringify(result)
}

export interface AgentRunOpts {
  episodeId: number
  dramaId: number
  model?: string
  configId?: number
  maxSteps?: number
  userId?: number
}

/** 执行一次 Agent 对话（同步/异步入口共用） */
export async function executeAgentRun(agentType: string, message: string, opts: AgentRunOpts) {
  const agent = mastra.getAgent(agentType)
  if (!agent) throw new Error('Agent not found')
  const requestContext = buildAgentRequestContext({
    episodeId: opts.episodeId,
    dramaId: opts.dramaId,
    modelOverride: opts.model || undefined,
    textConfigId: opts.configId || undefined,
    userId: opts.userId || undefined,
  })
  // 文本 AI 并发/节奏闸门（TPM 敏感）：剧本改写与分镜拆分统一受 TEXT_AI_MAX_CONCURRENT 约束
  return withTextSlot(() => agent.generate(
    [{ role: 'user', content: message }],
    { maxSteps: opts.maxSteps ?? 20, requestContext },
  ))
}
