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
 * Agent 同步入口：POST /:type/chat 一步拿全文 + 工具轨迹；GET /:type/debug 仅验型。
 * 耗时长的分镜拆分/剧本改写走 agent-async.ts 的任务化通道，不在这条同步链上。
 */
import { Hono } from 'hono'
import { validAgentTypes } from '../agents/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { mastra } from '../mastra/index.js'
import { success, badRequest } from '../utils/response.js'
import { normalizeToolName, normalizeToolResult } from '../services/agent-run.js'
import { getDramaOwned, getEpisodeOwned } from '../services/ownership.js'
import { recordTextUsageFromResult } from '../services/cost.js'
import { resolveTextConfigMeta } from '../services/ai.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import agentAsync from './agent-async.js'

const app = new Hono()

/** 把 Mastra 返回的 toolCalls/toolResults 规整成前端认的 {toolName, args}/{toolName, result} */
function summarizeTools(result: any) {
  const toolCalls = (result.toolCalls || []).map((tc: any) => ({
    toolName: normalizeToolName(tc),
    args: tc?.payload?.args ?? tc?.args ?? tc?.input ?? null,
  }))
  const toolResults = (result.toolResults || []).map((tr: any) => ({
    toolName: normalizeToolName(tr),
    result: normalizeToolResult(tr),
  }))
  return { toolCalls, toolResults }
}

app.post('/:type/chat', async (c) => {
  const user = c.get('user')
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) {
    return badRequest(c, `Invalid agent type: ${agentType}`)
  }

  const body = await c.req.json()
  const { message, drama_id, episode_id } = body

  logTaskStart('Agent', agentType, { message, episodeId: episode_id, dramaId: drama_id })
  logTaskPayload('Agent', `${agentType} input`, body)

  if (!episode_id || !drama_id) {
    logTaskError('Agent', agentType, { reason: 'missing drama_id or episode_id' })
    return badRequest(c, 'drama_id and episode_id are required')
  }
  await getDramaOwned(Number(drama_id), user)

  const agent = mastra.getAgent(agentType)
  if (!agent) {
    logTaskError('Agent', agentType, { reason: 'agent not found' })
    return badRequest(c, 'Agent not found')
  }

  // 防御式取参：model 只能是非空字符串、config_id 只能是数字，
  // 前端参数错位时宁可忽略，也不能把 ID 当成模型名下发
  const requestContext = buildAgentRequestContext({
    episodeId: episode_id,
    dramaId: drama_id,
    userId: user.id,
    modelOverride: typeof body.model === 'string' && body.model.trim() ? body.model : undefined,
    textConfigId: typeof body.config_id === 'number' ? body.config_id : undefined,
  })

  const startTime = performance.now()

  try {
    const result = await agent.generate(
      [{ role: 'user', content: message }],
      { maxSteps: 20, requestContext },
    )

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskSuccess('Agent', agentType, { elapsedSeconds: elapsed })

    // 每轮 Agent 对话折一条文本用量进成本账
    const costMeta = await resolveTextConfigMeta(user.id, body.config_id)
    await recordTextUsageFromResult(result, costMeta, {
      userId: user.id, dramaId: Number(drama_id), episodeId: Number(episode_id), configId: costMeta?.configId, detail: `agent:${agentType}`,
    })

    const { toolCalls, toolResults } = summarizeTools(result)
    logTaskProgress('Agent', 'tool-summary', {
      agentType,
      toolCalls: toolCalls.map((tc: any) => tc.toolName),
      toolResults: toolResults.map((tr: any) => tr.toolName),
    })
    logTaskPayload('Agent', `${agentType} tool-results`, toolResults)

    return success(c, {
      type: 'done',
      text: result.text || '',
      toolCalls,
      toolResults,
    })
  } catch (err: any) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskError('Agent', agentType, { elapsedSeconds: elapsed, error: err.message })
    console.error(err.stack || err)
    return badRequest(c, err.message || 'Agent execution failed')
  }
})

// GET /agent/:type/debug — 只校验 agent_type 是否在册
app.get('/:type/debug', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) return badRequest(c, 'Invalid agent type')
  return success(c, { agent_type: agentType, valid: true })
})

// 异步任务化子路由（分镜拆分 / 剧本改写）挂进来
app.route('/', agentAsync)

export default app
