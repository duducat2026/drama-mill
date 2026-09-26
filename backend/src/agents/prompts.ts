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
 * Agent prompt 文件加载 — workspace/prompts/<agent_type>.md
 * 文件格式（参照 SKILL.md 惯例）：
 *   ---
 *   name: 分镜拆解
 *   model: ""        # 可选，覆盖文本模型；空 = 用 AI 服务默认
 *   ---
 *   <系统提示词正文>
 * 文件即唯一事实来源；文件缺失时由调用方回退到代码默认值。
 */
import { skillsManagerWorkspace } from './skills.js'

export interface AgentPromptFile {
  name: string
  model: string
  instructions: string
}

const fsm = () => skillsManagerWorkspace.filesystem!
export const promptFilePath = (agentType: string) => `prompts/${agentType}.md`

/** 解析 prompt 文件（frontmatter 仅支持 name/model 两个标量字段，无需 yaml 依赖） */
export function parsePromptFile(raw: string): AgentPromptFile {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  let name = ''
  let model = ''
  let body = raw
  if (fmMatch) {
    const fm = fmMatch[1]
    const get = (key: string) => {
      const m = fm.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'))
      return (m?.[1] || '').trim()
    }
    name = get('name')
    model = get('model')
    body = raw.slice(fmMatch[0].length)
  }
  return { name, model, instructions: body.trim() }
}

/** 序列化为 prompt 文件内容（供保存接口使用） */
export function serializePromptFile(file: AgentPromptFile): string {
  return `---\nname: ${file.name}\nmodel: "${file.model}"\n---\n\n${file.instructions.trim()}\n`
}

/** 读取 Agent 的 prompt 文件；文件不存在或解析失败返回 null */
export async function loadAgentPromptFile(agentType: string): Promise<AgentPromptFile | null> {
  try {
    const path = promptFilePath(agentType)
    if (!await fsm().exists(path)) return null
    const raw = String(await fsm().readFile(path, { encoding: 'utf-8' }))
    const parsed = parsePromptFile(raw)
    return parsed.instructions ? parsed : null
  } catch {
    return null
  }
}
