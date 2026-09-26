/*
 * 结构测试辅助：拼接 admin Agent 配置页拆分后的「页面 + Skills 子组件」为一份源码，
 * 使原有对单文件 agents.vue 的正则断言（含 skillsAPI/confirmAddSkill/confirmDelSkill）继续成立。
 */
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/pages/admin/agents.vue',
  'app/components/AdminAgentSkillsPanel.vue',
]

/** @param frontendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readAgentsPageSources(frontendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(p, frontendRoot), 'utf8'))
    .join('\n')
}
