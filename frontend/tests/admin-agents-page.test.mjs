import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAgentsPageSources } from './helpers/agents-page-sources.mjs'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const agentsPage = readAgentsPageSources(root)
const settingsPage = readSettingsSources(root)
const adminLayout = read('app/layouts/admin.vue')

test('agent advanced config lives in admin page with admin layout', () => {
  // 页面注册为管理后台路由（pages/ 目录自动路由 + admin 布局）
  assert.match(agentsPage, /definePageMeta\(\{ layout: 'admin' \}\)/)
  assert.match(agentsPage, /Agent 配置/)
  // Agent 配置与 Skills 双标签
  assert.match(agentsPage, /\{ id: 'agents', label: 'Agent 配置'/)
  assert.match(agentsPage, /\{ id: 'skills', label: 'Skills'/)
  // 四个 Agent 定义与提示词/技能编辑能力
  assert.match(agentsPage, /script_rewriter/)
  assert.match(agentsPage, /extractor/)
  assert.match(agentsPage, /storyboard_breaker/)
  assert.match(agentsPage, /promptAPI/)
  assert.match(agentsPage, /skillsAPI/)
  assert.match(agentsPage, /confirmAddSkill/)
  assert.match(agentsPage, /confirmDelSkill/)
  assert.match(agentsPage, /saveAgentCfg/)
})

test('admin sidebar exposes the agent config page', () => {
  assert.match(adminLayout, /\{ path: '\/admin\/agents', label: 'Agent 配置', icon: Bot \}/)
  assert.match(adminLayout, /Bot,/)
})

test('front settings page no longer exposes agent advanced config', () => {
  // 前台用户不可见：高级开关、Agent 配置与 Skills 入口全部移除
  assert.doesNotMatch(settingsPage, /showAdvanced/)
  assert.doesNotMatch(settingsPage, /advancedTabs/)
  assert.doesNotMatch(settingsPage, /Agent 高级配置/)
  assert.doesNotMatch(settingsPage, /promptAPI/)
  assert.doesNotMatch(settingsPage, /skillsAPI/)
  assert.doesNotMatch(settingsPage, /script_rewriter/)
  assert.doesNotMatch(settingsPage, /SKILL\.md/)
  assert.doesNotMatch(settingsPage, /新增 Skill/)
  // 基础功能保留
  assert.match(settingsPage, /AI 服务/)
  assert.match(settingsPage, /风格预设/)
})
