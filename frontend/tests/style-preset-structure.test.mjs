import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readUseApiSources } from './helpers/use-api-sources.mjs'
import { readIndexPageSources } from './helpers/index-page-sources.mjs'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('project creation dialog only asks for title and visual style', () => {
  const page = readIndexPageSources(root)

  assert.match(page, /新建项目/)
  assert.match(page, /视觉风格/)
  assert.doesNotMatch(page, /total_episodes/)
  assert.doesNotMatch(page, /计划集数/)
  // 硬编码风格列表已移除，预设来自 API
  assert.doesNotMatch(page, /\['realistic', 'anime'/)
  assert.match(page, /stylePresetAPI/)
  assert.match(page, /stylePresetAPI\.list\(\)/)
  assert.match(page, /styleLabel\(drama\.style\)/)
  assert.match(page, /stylePresets\.length \}\} 种视觉风格/)
})

test('useApi exposes style preset endpoints', () => {
  const useApi = readUseApiSources(root)

  assert.match(useApi, /stylePresetAPI/)
  assert.match(useApi, /\/style-presets/)
  assert.match(useApi, /\?all=1/)
})

test('settings page manages style presets in a base tab', () => {
  const settings = readSettingsSources(root)

  assert.match(settings, /风格预设/)
  assert.match(settings, /Palette/)
  assert.match(settings, /stylePresetAPI/)
  assert.match(settings, /\{ id: 'styles', label: '风格预设'/)
  assert.match(settings, /startAddStyle/)
  assert.match(settings, /startEditStyle/)
  assert.match(settings, /toggleStyle/)
  assert.match(settings, /confirmDelStyle/)
  assert.match(settings, /styleToDelete/)
  assert.match(settings, /<ConfirmDialog/)
  assert.match(settings, /loadStylePresets/)
  // Agent 高级配置已迁至管理后台，前台设置中心只保留基础 tab，无高级开关残留
  assert.match(settings, /const baseTabs/)
  assert.doesNotMatch(settings, /showAdvanced/)
  assert.doesNotMatch(settings, /advancedTabs/)
  assert.doesNotMatch(settings, /Agent 高级配置/)
  // 风格 key 编辑时不可修改
  assert.match(settings, /:disabled="!!styleEditId"/)
  // image_prompt_generator 默认提示词副本同步更新
  assert.doesNotMatch(settings, /必须包含 "consistent art style"/)
})

test('style presets are tenant-scoped with read-only system rows for non-admin', () => {
  const settings = readSettingsSources(root)

  // 多租户：内置风格（is_system）非管理员只读，操作按钮/开关隐藏
  assert.match(settings, /p\.is_system/)
  assert.match(settings, /v-if="!p\.is_system \|\| isAdmin"/)
  assert.match(settings, /const \{ isAdmin \} = useAuth\(\)/)
  // admin 创建时可选择内置可见范围，普通用户创建的均为私有
  assert.match(settings, /v-if="isAdmin && !styleEditId"/)
  assert.match(settings, /styleForm\.is_system/)
  assert.match(settings, /is_system 仅 admin 生效/)
})
