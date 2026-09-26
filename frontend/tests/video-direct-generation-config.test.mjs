import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'

const settingsPage = readSettingsSources(new URL('..', import.meta.url))
const aiConfigRoute = readFileSync(new URL('../../backend/src/routes/aiConfigs.ts', import.meta.url), 'utf8')
const volcengineAdapter = readFileSync(new URL('../../backend/src/services/adapters/volcengine-video.ts', import.meta.url), 'utf8')

test('video presets default to direct Seedance 2.0 generation', () => {
  const combined = `${settingsPage}\n${aiConfigRoute}\n${volcengineAdapter}`
  assert.doesNotMatch(combined, /doubao-seedance-1-5-pro-251215/)
  assert.match(settingsPage, /Seedance 2\.0/)
  assert.match(settingsPage, /doubao-seedance-2-0-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-fast-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-mini-260615/)
})

test('video presets use official provider endpoints', () => {
  assert.match(settingsPage, /https:\/\/ark\.cn-beijing\.volces\.com/)
  // 百炼 DashScope 为官方入口（Wan 系列），vidu 等非官方渠道禁用
  assert.match(settingsPage, /https:\/\/dashscope\.aliyuncs\.com\/api\/v1/)
  assert.doesNotMatch(settingsPage, /https:\/\/api\.vidu\.com/)
})
