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
 * Agent 提示词管理接口
 * 后端存储是 workspace/prompts/<agent_type>.md 文件，读写 jails 在 backend/workspace 内；
 * 属于平台级配置，整条路由挂 adminGuard——运行时 Agent 直接读文件层，不走这组 HTTP。
 */
import { Hono } from 'hono'
import { success, badRequest } from '../utils/response.js'
import { adminGuard } from '../middleware/auth.js'
import { skillsManagerWorkspace } from '../agents/skills.js'
import { validAgentTypes, DEFAULT_PROMPTS } from '../agents/index.js'
import { loadAgentPromptFile, serializePromptFile, promptFilePath } from '../agents/prompts.js'

const app = new Hono()
app.use('*', adminGuard)
const fsm = () => skillsManagerWorkspace.filesystem!

// agent_type 白名单外一律 400，防目录穿越
const isKnownType = (type: string) => validAgentTypes.includes(type)

/** 单条 prompt 的响应形状：文件行与代码默认行合并到这里统一吐出 */
function promptPayload(type: string, file: Awaited<ReturnType<typeof loadAgentPromptFile>>, withInstructions: boolean) {
  const fallback = DEFAULT_PROMPTS[type]
  const record: Record<string, any> = {
    agent_type: type,
    name: file?.name || fallback.name,
    model: file?.model || '',
    is_default: !file,
  }
  if (withInstructions) record.system_prompt = file ? file.instructions : fallback.instructions
  return record
}

// GET /prompts — 全部 Agent 的 prompt 概览（不带正文）
app.get('/', async (c) => {
  const list = await Promise.all(validAgentTypes.map(async (type) =>
    promptPayload(type, await loadAgentPromptFile(type), false)))
  return success(c, list)
})

// GET /prompts/:type — 有效内容：有文件用文件，没有回退代码内置默认
app.get('/:type', async (c) => {
  const type = c.req.param('type')
  if (!isKnownType(type)) return badRequest(c, 'Unknown agent type')
  return success(c, promptPayload(type, await loadAgentPromptFile(type), true))
})

// PUT /prompts/:type — 把编辑结果序列化成 md 文件落盘
app.put('/:type', async (c) => {
  const type = c.req.param('type')
  if (!isKnownType(type)) return badRequest(c, 'Unknown agent type')
  const body = await c.req.json()
  const instructions = String(body.system_prompt ?? '').trim()
  if (!instructions) return badRequest(c, 'system_prompt required')
  const name = String(body.name || DEFAULT_PROMPTS[type].name)
  const model = String(body.model ?? '').trim()
  await fsm().writeFile(promptFilePath(type), serializePromptFile({ name, model, instructions }), { recursive: true })
  return success(c, { agent_type: type, name, model, is_default: false })
})

// POST /prompts/:type/reset — 删掉 md 文件即回退默认
app.post('/:type/reset', async (c) => {
  const type = c.req.param('type')
  if (!isKnownType(type)) return badRequest(c, 'Unknown agent type')
  const path = promptFilePath(type)
  if (await fsm().exists(path)) await fsm().deleteFile(path)
  return success(c, { agent_type: type, is_default: true })
})

export default app
