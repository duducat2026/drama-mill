import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAgentsIndexSources } from './helpers/agents-index-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('prompt_generator video prompt format uses @name references instead of XML tags', () => {
  const agents = readAgentsIndexSources(root)
  const skill = read('workspace/skills/prompt-generator/video-prompt/SKILL.md')
  const settings = read('../frontend/app/pages/settings.vue')
  const adminAgents = read('../frontend/app/pages/admin/agents.vue')

  // 场景/角色用 @名字 引用（名字必须与场景/角色列表完全一致）
  assert.match(agents, /@场景名/)
  assert.match(agents, /@角色名/)
  assert.match(agents, /@小明 → @图片1小明/)
  assert.doesNotMatch(agents, /<location>/)
  assert.doesNotMatch(agents, /<role>/)

  // SKILL.md 同步
  assert.match(skill, /@场景名/)
  assert.match(skill, /@角色名/)
  assert.match(skill, /@小明.*@图片1小明/)
  assert.doesNotMatch(skill, /<location>/)
  assert.doesNotMatch(skill, /<role>/)

  // Agent 配置已迁至管理后台（admin/agents.vue）：不内嵌提示词副本（默认提示词由后端
  // workspace/prompts 管理），仅验证不含旧 XML 引用格式且保留「恢复默认」入口；前台设置页无残留
  assert.match(adminAgents, /恢复默认/)
  assert.doesNotMatch(adminAgents, /<location>/)
  assert.doesNotMatch(adminAgents, /<role>/)
  assert.doesNotMatch(settings, /恢复默认/)
  assert.doesNotMatch(settings, /<location>/)
  assert.doesNotMatch(settings, /<role>/)
})
