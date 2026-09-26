import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('../src/', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const promptsRoute = read('routes/prompts.ts')
const skillsRoute = read('routes/skills.ts')

test('prompts route is guarded by admin role', () => {
  assert.match(promptsRoute, /import { adminGuard } from '\.\.\/middleware\/auth\.js'/)
  assert.match(promptsRoute, /app\.use\('\*', adminGuard\)/)
  // 守卫必须在任何路由处理之前挂载（路由定义形如 app.get('/', async ...））
  const guardIdx = promptsRoute.indexOf("app.use('*', adminGuard)")
  const firstRouteIdx = promptsRoute.search(/app\.(get|post|put|delete)\('/)
  assert.ok(guardIdx > -1 && firstRouteIdx > -1 && guardIdx < firstRouteIdx, 'adminGuard 必须挂在路由定义之前')
})

test('skills route is guarded by admin role', () => {
  assert.match(skillsRoute, /import { adminGuard } from '\.\.\/middleware\/auth\.js'/)
  assert.match(skillsRoute, /app\.use\('\*', adminGuard\)/)
  const guardIdx = skillsRoute.indexOf("app.use('*', adminGuard)")
  const firstRouteIdx = skillsRoute.search(/app\.(get|post|put|delete)\('/)
  assert.ok(guardIdx > -1 && firstRouteIdx > -1 && guardIdx < firstRouteIdx, 'adminGuard 必须挂在路由定义之前')
})

test('runtime agent loading reads files directly, not via guarded HTTP routes', () => {
  // 运行时 Agent 经文件层加载提示词/技能，加守卫不影响生成流水线
  const agentsIndex = read('agents/index.ts')
  assert.match(agentsIndex, /loadAgentPromptFile/)
  assert.match(agentsIndex, /loadAgentSkills/)
  const skillsSvc = read('agents/skills.ts')
  assert.match(skillsSvc, /export async function loadAgentSkills/)
})
