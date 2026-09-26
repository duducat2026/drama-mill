// 小说分集 Agent（novel_splitter）收编结构测试 — 原 novel-episode-titler 临时 Agent 注册为正式类型
// 断言注册表、技能映射、SKILL.md 与拆分服务的注入链路（源码断言，沿用现有约定）
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAgentsIndexSources } from './helpers/agents-index-sources.mjs'
import { readAgentsPageSources } from '../../frontend/tests/helpers/agents-page-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('novel_splitter 注册进 DEFAULT_PROMPTS（agentRegistry 由 validAgentTypes 派生自动挂载）', () => {
  const agents = readAgentsIndexSources(root)
  assert.match(agents, /novel_splitter:\s*\{\s*\n\s*name: '小说分集'/)
  // validAgentTypes 取自 DEFAULT_PROMPTS 的 key → prompts 设置页与 agentRegistry 自动包含该类型
  assert.match(agents, /export const validAgentTypes = Object\.keys\(DEFAULT_PROMPTS\)/)
  // 无业务工具：AGENT_TOOLS 不含 novel_splitter
  const toolsBlock = agents.match(/const AGENT_TOOLS[\s\S]*?\n\}/)[0]
  assert.doesNotMatch(toolsBlock, /novel_splitter/)
})

test('instructions 通过 buildAgentInstructions 组装（prompt 文件 + 技能全文）', () => {
  const agents = readAgentsIndexSources(root)
  assert.match(agents, /export async function buildAgentInstructions\(type: string\)/)
  assert.match(agents, /loadAgentPromptFile\(type\)/)
  assert.match(agents, /loadAgentSkills\(type\)/)
  assert.match(agents, /instructions: \(\) => buildAgentInstructions\(type\)/)
})

test('novel_splitter 不挂 workspace，避免 filesystem 工具破坏单步 JSON 输出', () => {
  const agents = readAgentsIndexSources(root)
  assert.match(agents, /const NO_WORKSPACE_AGENTS = new Set\(\['novel_splitter'\]\)/)
  assert.match(agents, /workspace: NO_WORKSPACE_AGENTS\.has\(type\) \? undefined : skillWorkspaces\[type\]/)
})

test('AGENT_SKILL_MAP 注册 novel-splitter 技能目录', () => {
  const skills = read('src/agents/skills.ts')
  assert.match(skills, /novel_splitter: \['novel-splitter'\]/)
})

test('skills/novel-splitter/SKILL.md 承载分集约束与 JSON 输出格式', () => {
  const skill = read('workspace/skills/novel-splitter/SKILL.md')
  // frontmatter 目录名须符合 Agent Skills 规范（小写 + 连字符）
  assert.match(skill, /^---\nname: novel-splitter\ndescription: .+\n---/)
  // 原硬编码约束已迁入：为归组好的一集产出吸睛标题 + 一句话概要
  assert.match(skill, /归组好的一集内容\*\*起一个吸睛标题和一句话概要/)
  assert.match(skill, /不允许调用工具/)
  assert.match(skill, /\{"title":"12字以内的吸睛标题","summary":"50字以内的一句话概要"\}/)
  // 集号由系统拼接，标题不得自带序号
  assert.match(skill, /禁止\*\*出现「第X集」/)
  // 模版要求优先级（splitPrompt 注入仍生效）
  assert.match(skill, /拆分模版要求（必须遵守）/)
})

test('拆分服务改用注册类型的 instructions，且保留无工具轻量 Agent 与模版注入', () => {
  const svc = read('src/services/novel-split.ts')
  assert.match(svc, /import \{ getModel, buildAgentInstructions \} from '\.\.\/agents\/index\.js'/)
  assert.match(svc, /instructions: await buildAgentInstructions\('novel_splitter'\)/)
  assert.match(svc, /id: 'novel_splitter'/)
  // 仍是自建无工具 Agent（不挂 workspace），模型解析链路不变
  assert.match(svc, /new Agent\(/)
  assert.match(svc, /getModel\(/)
  // 用户消息中的模版注入与 JSON 契约保持不变
  assert.match(svc, /拆分模版要求（必须遵守）/)
  assert.match(svc, /maxSteps: 1/)
  assert.match(svc, /detail: 'novel_split_titler'/)
})

test('前端 Agent 配置页列出小说分集（Skills/Prompts 可编辑）', () => {
  // agents.vue 已拆分：页面 + AdminAgentSkillsPanel 子组件拼接断言
  const page = readAgentsPageSources(new URL('../frontend/', root))
  assert.match(page, /\{ type: 'novel_splitter', label: '小说分集'/)
  // skill 目录名由 agent type 下划线转连字符：novel_splitter → novel-splitter
  assert.match(page, /type\.replace\((\/_\+?\/g|'_\+?'), '-'\)/)
})
