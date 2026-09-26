import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { episodeViewSource } from './helpers/episode-sources.mjs'
import { readDetailSources } from './helpers/detail-sources.mjs'

const studioCss = readFileSync(new URL('../app/assets/studio.css', import.meta.url), 'utf8')
const indexPage = readFileSync(new URL('../app/pages/index.vue', import.meta.url), 'utf8')
const defaultLayout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
const baseSelect = readFileSync(new URL('../app/assets/styles/base-select.css', import.meta.url), 'utf8')
const dramaDetail = readDetailSources(new URL('..', import.meta.url))
const episodeWorkbench = episodeViewSource()
// 样式外置后的页面级 CSS
const launcherCss = readFileSync(new URL('../app/assets/styles/launcher.css', import.meta.url), 'utf8')
const dramaDetailCss = readFileSync(new URL('../app/assets/styles/drama.detail.css', import.meta.url), 'utf8')
const episodeWorkbenchCss = readFileSync(new URL('../app/assets/styles/episode.workbench.css', import.meta.url), 'utf8')

test('global button system exposes complete button tokens and states', () => {
  assert.match(studioCss, /--button-height:\s*36px/)
  assert.match(studioCss, /--button-height-sm:\s*30px/)
  assert.match(studioCss, /--button-height-icon:\s*36px/)
  assert.match(studioCss, /--button-border:\s*transparent/)
  assert.match(studioCss, /--button-focus:\s*rgba\(0,113,227,0\.18\)/)
  assert.match(studioCss, /--radius-pill:\s*980px/)
  assert.match(studioCss, /\.btn\s*\{[\s\S]*?border-radius:\s*var\(--button-radius\)/)
  assert.match(studioCss, /\.btn:focus-visible\s*\{/)
  assert.match(studioCss, /\.btn-danger\s*\{/)
  assert.match(studioCss, /\.btn-danger:hover\s*\{/)
})

test('button-like controls share focus-visible and active hooks', () => {
  // 启动台页面级样式在 launcher.css；卡片菜单样式已随组件拆至 project-card.css（父页 scoped 不穿透子组件）
  assert.match(launcherCss, /\.filter-chip:focus-visible\s*\{/)
  assert.match(readFileSync(new URL('../app/assets/styles/project-card.css', import.meta.url), 'utf8'), /\.menu-item:focus-visible\s*\{/)
  assert.match(defaultLayout, /\.nav-link:focus-visible\s*\{/)
  assert.match(defaultLayout, /\.brand:focus-visible\s*\{/)
  assert.match(baseSelect, /\.base-select-trigger:focus-visible\s*\{/)
  assert.match(baseSelect, /\.base-select-option:focus-visible\s*\{/)
})

test('custom return buttons use the unified quiet circular surface', () => {
  // 页面样式已外置：断言对应的外置 CSS 与页面引入关系
  assert.match(dramaDetail, /style scoped src="assets\/styles\/drama\.detail\.css"/)
  assert.match(dramaDetailCss, /\.back-btn\s*\{[\s\S]*?background:\s*rgba\(0,0,0,0\.05\)/)
  assert.match(dramaDetailCss, /\.back-btn:focus-visible\s*\{/)
  assert.match(episodeWorkbench, /style scoped src="~\/assets\/styles\/episode\//)
  assert.match(episodeWorkbenchCss, /\.back-btn\s*\{[\s\S]*?background:\s*rgba\(0,0,0,0\.05\)/)
  assert.match(episodeWorkbenchCss, /\.back-btn:focus-visible\s*\{/)
})
