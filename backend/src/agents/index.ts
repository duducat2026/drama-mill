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
 * Mastra Agent 装配台。职责有三：
 * 1. 给每种 agent type 配一份工具集（tools/* 导出）；
 * 2. 每次请求动态拼 instructions（磁盘 prompt 覆盖代码默认 + SKILL 全文）；
 * 3. 每次请求动态解析 model（frontmatter 指定 + RequestContext 覆盖链）。
 * 指令兜底文本在 prompts-defaults.ts，模型解析在 model-factory.ts。
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

/** 提示词 Agent 额外借用分镜工具读写 video_prompt */
const promptGeneratorTools = {
  ...imagePromptTools,
  readStoryboardContext: storyboardTools.readStoryboardContext,
  updateStoryboard: storyboardTools.updateStoryboard,
}

const AGENT_TOOLS: Record<string, Record<string, any>> = {
  script_rewriter: scriptTools,
  extractor: extractTools,
  storyboard_breaker: storyboardTools,
  prompt_generator: promptGeneratorTools,
}

/**
 * 组装某个 Agent 的完整 instructions：
 * 基线取 workspace/prompts/<type>.md，缺文件则回落 DEFAULT_PROMPTS；
 * 再把该 Agent 的技能全文拼在尾部。
 * novel-split 服务（非注册链路）也复用此函数按请求 new Agent。
 */
export async function buildAgentInstructions(type: string) {
  const fallback = DEFAULT_PROMPTS[type]
  if (!fallback) return ''
  const fromDisk = await loadAgentPromptFile(type)
  const baseline = fromDisk?.instructions || fallback.instructions
  const skills = await loadAgentSkills(type)
  return skills ? `${baseline}\n\n${skills}` : baseline
}

/** 模型解析器：frontmatter model → modelOverride → textConfigId，逐级覆盖 */
function buildModel(type: string) {
  return async ({ requestContext }: { requestContext?: RequestContext }) => {
    const fromDisk = await loadAgentPromptFile(type)
    const pick = (key: string) => requestContext?.get(key as never) as number | string | undefined
    return getModel(
      fromDisk?.model || undefined,
      pick('modelOverride') as string | undefined,
      pick('textConfigId') as number | undefined,
      (pick('userId') as number | undefined) ?? null,
    )
  }
}

/**
 * novel_splitter 故意不挂 workspace：Mastra 会把 workspace 自带的 filesystem
 * 工具注入 Agent，而它的职责是单步直出结构化文本——多一套读文件工具反而诱导
 * 模型去翻文件。技能约束不丢，由 buildAgentInstructions 拼全文兜住。
 */
const NO_WORKSPACE_AGENTS = new Set(['novel_splitter'])

/** 静态注册表：启动时按 validAgentTypes 全量建好，交给 Mastra 实例挂载 */
export const agentRegistry: Record<string, Agent> = Object.fromEntries(
  validAgentTypes.map(type => [type, new Agent({
    id: type,
    name: DEFAULT_PROMPTS[type].name,
    instructions: () => buildAgentInstructions(type),
    model: buildModel(type),
    tools: AGENT_TOOLS[type],
    workspace: NO_WORKSPACE_AGENTS.has(type) ? undefined : skillWorkspaces[type],
    skillsFormat: 'markdown',
  })]),
)
