// 设置中心四个基础面板的 URL 化导航 — 结构测试（源码断言，沿用现有约定）
// 痛点：tab 原先是本地 ref，刷新/分享/前进后退总被弹回「AI 服务」；
// 现改为 ?tab= 驱动（与既有 ?service= 同一套参数化导航），URL 是唯一数据源。
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const page = readSettingsSources(root)
const nuxtConfig = read('nuxt.config.ts')

test('tab 由 URL query 驱动，不再持有本地初值', () => {
  assert.match(page, /export const SETTINGS_TAB_IDS = \['ai', 'prices', 'watchdogs', 'styles'\]/)
  assert.match(page, /const DEFAULT_TAB = 'ai'/)
  // getter 只认白名单，脏值（?tab=xxx / ?tab=a&tab=b）回退默认面板
  assert.match(page, /get: \(\) => \(SETTINGS_TAB_IDS\.includes\(route\.query\.tab\) \? route\.query\.tab : DEFAULT_TAB\)/)
  // 模板仍写 `tab = t.id`：靠 computed setter 落到导航，不直接改本地态
  assert.match(page, /const tab = computed\(\{/)
  assert.doesNotMatch(page, /const tab = ref\('ai'\)/)
})

test('点击面板产生可后退的历史记录，默认面板不污染 URL', () => {
  assert.match(page, /router\.push\(\{ path: route\.path, query: withTabQuery\(route\.query, id\) \}\)/)
  // push 前先比较目标值：同值不压栈，重复点击不会堆积历史记录
  assert.match(page, /if \(route\.query\.tab === \(id === DEFAULT_TAB \? undefined : id\)\) return/)
  assert.match(page, /if \(id === DEFAULT_TAB\) delete next\.tab/)
  // 保留其余 query（?service= 与 ?tab= 互不覆盖）
  assert.match(page, /const next = \{ \.\.\.query \}/)
  assert.match(page, /router\.replace\(\{ path: '\/settings', query: \{ \.\.\.route\.query, service: type \} \}\)/)
})

test('面板清单与 URL 白名单同源，query 变化不重建页面', () => {
  // settings.vue 的 baseTabs 顺序必须与 SETTINGS_TAB_IDS 等值，否则刷新会掉回默认面板
  const tabIds = [...page.matchAll(/\{ id: '(\w+)', label: '[^']+', icon: \w+ \},/g)].map(m => m[1])
  assert.deepEqual(tabIds, ['ai', 'prices', 'watchdogs', 'styles'])
  // key 取 path：切面板只换 query，重建会把面板内已加载的数据全丢掉
  assert.match(page, /definePageMeta\(\{ key: route => route\.path \}\)/)
  // 非 hash 路由：?tab= 是真实 query，刷新由后端 200.html 的 SPA fallback 兜底后按 query 渲染
  assert.doesNotMatch(nuxtConfig, /hashMode:\s*true/)
  assert.match(nuxtConfig, /ssr: true/)
})
