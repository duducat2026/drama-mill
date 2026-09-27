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
 * Agent 提示词文件的读写层。
 *
 * 每个 Agent 的提示词存放于 workspace/prompts/<agent_type>.md，文件结构沿用
 * SKILL.md 的 frontmatter 习惯：三条 `---` 包围的头部只认 name 与 model
 * 两个标量键（model 留空表示走 AI 服务默认模型），头下正文即系统提示词。
 * 磁盘文件是提示词的唯一权威版本；读不到时调用方退回代码内置默认。
 */
import { skillsManagerWorkspace } from './skills.js'

export interface AgentPromptFile {
  name: string
  model: string
  instructions: string
}

const workspaceFs = () => skillsManagerWorkspace.filesystem!

/** prompt 文件相对 workspace 的路径 */
export const promptFilePath = (agentType: string) => `prompts/${agentType}.md`

/**
 * 逐行拆解 frontmatter 块，只提取 name / model；没有头部时原样视为全文正文。
 * 不引 yaml 解析器——头部只有两个标量键，手写拆分足够。
 */
export function parsePromptFile(raw: string): AgentPromptFile {
  const lines = raw.split(/\r?\n/)
  const result: AgentPromptFile = { name: '', model: '', instructions: '' }

  let cursor = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const sep = line.indexOf(':')
        if (sep < 0) continue
        const key = line.slice(0, sep).trim()
        const value = line.slice(sep + 1).trim().replace(/^"(.*)"$/, '$1').trim()
        if (key === 'name') result.name = value
        else if (key === 'model') result.model = value
      }
      cursor = end + 1
    }
  }
  result.instructions = lines.slice(cursor).join('\n').trim()
  return result
}

/** 反向操作：把结构体拼回可写盘的 prompt 文件文本（保存接口用） */
export function serializePromptFile(file: AgentPromptFile): string {
  const header = ['---', `name: ${file.name}`, `model: "${file.model}"`, '---']
  return `${header.join('\n')}\n\n${file.instructions.trim()}\n`
}

/**
 * 加载指定 Agent 的磁盘提示词。
 * 文件缺失、读取抛错、或正文为空一律返回 null，由调用方决定回退策略。
 */
export async function loadAgentPromptFile(agentType: string): Promise<AgentPromptFile | null> {
  const relPath = promptFilePath(agentType)
  try {
    if (!await workspaceFs().exists(relPath)) return null
    const raw = String(await workspaceFs().readFile(relPath, { encoding: 'utf-8' }))
    const parsed = parsePromptFile(raw)
    return parsed.instructions.length > 0 ? parsed : null
  } catch {
    return null
  }
}
