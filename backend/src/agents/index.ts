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
 * Mastra Agent 注册表：
 * - 默认指令集 & 有效类型：agents/prompts-defaults.ts
 * - 模型工厂与 fetch 补丁（关思考 / temperature / max_tokens）：agents/model-factory.ts
 * - 具体工具集在 agents/tools/*.ts
 */
import { Agent } from '@mastra/core/agent'
import type { RequestContext } from '@mastra/core/request-context'
import { scriptTools } from './tools/script-tools.js'
import { extractTools } from './tools/extract-tools.js'
import { storyboardTools } from './tools/storyboard-tools.js'
import { imagePromptTools } from './tools/image-prompt-tools.js'
import { loadAgentSkills, skillWorkspaces } from './skills.js'
import { loadAgentPromptFile } from './prompts.js'
import { DEFAULT_PROMPTS, validAgentTypes } from './prompts-defaults.js'
import { getModel } from './model-factory.js'

export { DEFAULT_PROMPTS, validAgentTypes } from './prompts-defaults.js'
export { getModel, createTextModel } from './model-factory.js'

const AGENT_TOOLS: Record<string, Record<string, any>> = {
  script_rewriter: scriptTools,
  extractor: extractTools,
  storyboard_breaker: storyboardTools,
  prompt_generator: {
    ...imagePromptTools,
    readStoryboardContext: storyboardTools.readStoryboardContext,
    updateStoryboard: storyboardTools.updateStoryboard,
  },
}

/**
 * instructions 按请求组装：prompt 文件（workspace/prompts/<type>.md，缺失回退代码默认）+ 技能全文拼接
 * 导出供非注册链路复用（小说拆分在 services/novel-split.ts 内按请求 new Agent）
 */
export async function buildAgentInstructions(type: string) {
  const defaults = DEFAULT_PROMPTS[type]
  if (!defaults) return ''
  const promptFile = await loadAgentPromptFile(type)
  const baseInstructions = promptFile?.instructions || defaults.instructions
  const skillInstructions = await loadAgentSkills(type)
  return skillInstructions
    ? [baseInstructions, '', skillInstructions].join('\n')
    : baseInstructions
}

/** model 按请求解析：prompt 文件 frontmatter + RequestContext 的 modelOverride/textConfigId 覆盖 */
function buildModel(type: string) {
  return async ({ requestContext }: { requestContext?: RequestContext }) => {
    const promptFile = await loadAgentPromptFile(type)
    const modelOverride = requestContext?.get('modelOverride' as never) as string | undefined
    const textConfigId = requestContext?.get('textConfigId' as never) as number | undefined
    const userId = requestContext?.get('userId' as never) as number | undefined
    return getModel(promptFile?.model || undefined, modelOverride, textConfigId, userId ?? null)
  }
}

/**
 * 不挂 workspace 的 Agent：Mastra 会把 workspace 的 filesystem 工具自动注入 Agent，
 * 这类 Agent 的职责是单步产出结构化文本（无工具），注入工具会诱导模型去读文件而不是直接输出，
 * 技能规范仍生效——由 buildAgentInstructions 把 SKILL.md 全文拼进 instructions
 */
const NO_WORKSPACE_AGENTS = new Set(['novel_splitter'])

/** 启动时注册的静态 Agent 表（供 Mastra 实例挂载） */
export const agentRegistry: Record<string, Agent> = Object.fromEntries(
  validAgentTypes.map(type => [
    type,
    new Agent({
      id: type,
      name: DEFAULT_PROMPTS[type].name,
      instructions: () => buildAgentInstructions(type),
      model: buildModel(type),
      tools: AGENT_TOOLS[type],
      workspace: NO_WORKSPACE_AGENTS.has(type) ? undefined : skillWorkspaces[type],
      skillsFormat: 'markdown',
    }),
  ]),
)
