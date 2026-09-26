import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { episodeViewSource } from './helpers/episode-sources.mjs'
import { readUseApiSources } from './helpers/use-api-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const useAuth = read('app/composables/useAuth.ts')
const useApi = readUseApiSources(root)
const loginPage = read('app/pages/login.vue')
const indexPage = read('app/pages/index.vue')
const episodePage = episodeViewSource()

test('useAuth exposes session state and token persistence', () => {
  assert.match(useAuth, /export function useAuth/)
  assert.match(useAuth, /fetchMe/)
  assert.match(useAuth, /logout/)
  assert.match(useAuth, /isAdmin/)
  assert.match(useApi, /function authHeaders/)
})

test('login page submits credentials via useAuth', () => {
  assert.match(loginPage, /v-model="username"/)
  assert.match(loginPage, /v-model="password"/)
  assert.match(loginPage, /const \{ login, isLoggedIn \} = useAuth\(\)/)
  assert.match(loginPage, /await login\(username\.value\.trim\(\), password\.value\)/)
})

test('home page guards login and exposes admin entry', () => {
  assert.match(indexPage, /useAuth\(\)/)
  assert.match(indexPage, /navigateTo\('\/login'\)/)
  assert.match(indexPage, /v-if="isAdmin"/)
  assert.match(indexPage, /navigateTo\('\/admin\/panel'\)/)
})

test('episode workbench shows stage timings and cost', () => {
  assert.match(episodePage, /timingAPI\.episode/)
  assert.match(episodePage, /costAPI\.my/)
  assert.match(episodePage, /epTimings/)
  assert.match(episodePage, /epCostData/)
  assert.match(episodePage, /function fmtDuration/)
  assert.match(episodePage, /function loadEpStats/)
})

test('episode workbench supports raw document upload', () => {
  assert.match(episodePage, /uploadAPI\.document/)
  assert.match(episodePage, /onUploadDocument/)
  assert.match(useApi, /uploadAPI = \{[\s\S]*?document/)
})

test('ten admin pages exist and share the admin layout', () => {
  const pages = ['assets', 'audit', 'costs', 'gateways', 'merges', 'panel', 'scripts', 'storyboards', 'users', 'videos']
  for (const name of pages) {
    const path = `app/pages/admin/${name}.vue`
    assert.ok(existsSync(new URL(path, root)), `missing admin page: ${path}`)
    const page = read(path)
    assert.match(page, /definePageMeta\(\{ layout: 'admin' \}\)/, `${path} must use admin layout`)
  }
  assert.ok(existsSync(new URL('app/layouts/admin.vue', root)), 'missing admin layout')
  // 管理 API 客户端覆盖用户 / 网关 / 审计 / 面板 / 成本 / 刊例价
  assert.match(useApi, /adminAPI = \{/)
  assert.match(useApi, /adminAPI[\s\S]*?panel/)
  assert.match(useApi, /adminAPI[\s\S]*?costs/)
  assert.match(useApi, /adminAPI[\s\S]*?audit/)
  assert.match(useApi, /adminAPI[\s\S]*?ModelPrice/)
})

test('admin costs page manages price sheet and aggregates', () => {
  const page = read('app/pages/admin/costs.vue')
  assert.match(page, /adminAPI\.costs/)
  assert.match(page, /by_service_type/)
  assert.match(page, /by_drama/)
  assert.match(page, /model-prices|ModelPrice/)
})

test('admin panel page polls gateway rate stats', () => {
  const page = read('app/pages/admin/panel.vue')
  assert.match(page, /adminAPI\.panel/)
  // 活跃任务自适应轮询：有运行/排队 5s、空闲 30s，链式排程 + 隐藏停轮
  assert.match(page, /ACTIVE_INTERVAL = 5000/)
  assert.match(page, /IDLE_INTERVAL = 30000/)
  assert.match(page, /hasActiveWork/)
  assert.match(page, /visibilitychange/)
  assert.doesNotMatch(page, /setInterval/)
  assert.match(page, /recent_429/)
})
