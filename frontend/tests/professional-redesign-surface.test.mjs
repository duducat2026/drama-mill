import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { episodeViewSource } from './helpers/episode-sources.mjs'
import { readIndexPageSources } from './helpers/index-page-sources.mjs'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'
import { readDetailSources } from './helpers/detail-sources.mjs'

const studioCss = readFileSync(new URL('../app/assets/studio.css', import.meta.url), 'utf8')
const indexPage = readIndexPageSources(new URL('..', import.meta.url))
const defaultLayout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
const episodeWorkbench = episodeViewSource()
const dramaDetail = readDetailSources(new URL('..', import.meta.url))
const settingsPage = readSettingsSources(new URL('..', import.meta.url))
// 样式外置后的页面级 CSS
const launcherCss = readFileSync(new URL('../app/assets/styles/launcher.css', import.meta.url), 'utf8')
const episodeWorkbenchCss = readFileSync(new URL('../app/assets/styles/episode.workbench.css', import.meta.url), 'utf8')

function cssBlock(source, selector) {
  const start = source.indexOf(selector)
  assert.notEqual(start, -1, `missing selector ${selector}`)
  const open = source.indexOf('{', start)
  assert.notEqual(open, -1, `missing block for ${selector}`)

  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }

  throw new Error(`unterminated block for ${selector}`)
}

test('theme exposes an apple-inspired light material system', () => {
  assert.match(studioCss, /--surface-base:\s*#f5f5f7/)
  assert.match(studioCss, /--surface-raised:\s*#ffffff/)
  assert.match(studioCss, /--surface-muted:\s*#f5f5f7/)
  assert.match(studioCss, /--surface-outline:\s*rgba\(0,0,0,0\.08\)/)
  assert.match(studioCss, /--accent:\s*#0071e3/)
})

test('project entry is redesigned as a poster card grid', () => {
  assert.match(indexPage, /class="project-grid"/)
  assert.match(indexPage, /class="card project-card"/)
  assert.match(indexPage, /class="project-thumb"/)
  // 启动台样式已外置到 launcher.css
  assert.match(indexPage, /style scoped src="assets\/styles\/launcher\.css"/)
  assert.match(launcherCss, /repeat\(auto-fill,\s*minmax\(258px,\s*1fr\)\)/)
  assert.match(launcherCss, /box-shadow:\s*var\(--shadow-lift\)/)
})

test('global header uses the frosted glass material', () => {
  assert.match(defaultLayout, /background:\s*rgba\(251,251,253,0\.72\)/)
  assert.match(defaultLayout, /backdrop-filter:\s*blur\(20px\)\s*saturate\(180%\)/)
  assert.match(defaultLayout, /border-bottom:\s*1px solid var\(--border\)/)
})

test('workbench removes legacy light panels from the main production surface', () => {
  // 工作台样式已外置到 episode.workbench.css
  assert.match(episodeWorkbenchCss, /background:\s*var\(--surface-raised\)/)
  assert.match(episodeWorkbenchCss, /background:\s*var\(--surface-muted\)/)
  assert.doesNotMatch(episodeWorkbenchCss, /rgba\(246,\s*248,\s*252,\s*0\.92\)/)
  assert.doesNotMatch(episodeWorkbenchCss, /rgba\(27,\s*41,\s*64,\s*0\.08\)/)
})

test('settings page removes the legacy quick setup recommendation cards', () => {
  assert.doesNotMatch(settingsPage, /Quick Setup/)
  assert.doesNotMatch(settingsPage, /官方推荐配置/)
  assert.doesNotMatch(settingsPage, /officialPresetCards/)
  assert.doesNotMatch(settingsPage, /\.preset-card\s*\{/)
  assert.doesNotMatch(settingsPage, /background:\s*rgba\(255,255,255,0\.82\)/)
  assert.doesNotMatch(settingsPage, /background:\s*rgba\(244,248,255,0\.72\)/)
  assert.doesNotMatch(settingsPage, /background:\s*rgba\(255,255,255,0\.72\)/)
})

test('project episode dialog follows the light brand system', () => {
  assert.doesNotMatch(dramaDetail, /rgba\(122,167,255/)
  assert.doesNotMatch(dramaDetail, /rgba\(76,125,255/)
  assert.doesNotMatch(dramaDetail, /rgba\(242,247,255,0\.92\)/)
  assert.doesNotMatch(dramaDetail, /rgba\(244,248,255,0\.96\)/)
})

test('workbench active navigation uses quiet system-blue accents', () => {
  const pipeActive = cssBlock(episodeWorkbenchCss, '.pipe-item.active')
  const iconActive = cssBlock(episodeWorkbenchCss, '.icon-active')

  assert.match(pipeActive, /background:\s*var\(--sel-bg\)/)
  assert.match(pipeActive, /color:\s*var\(--sel-text\)/)
  assert.doesNotMatch(pipeActive, /inset 3px 0 0 var\(--accent\)/)
  assert.match(iconActive, /background:\s*var\(--sel\)/)
})

test('workbench completed navigation uses quiet success states', () => {
  const doneItem = cssBlock(episodeWorkbenchCss, '.pipe-item.done')
  const doneIcon = cssBlock(episodeWorkbenchCss, '.pipe-item.done .pipe-icon')
  const iconDone = cssBlock(episodeWorkbenchCss, '.icon-done')
  const sidebarDoneDot = cssBlock(episodeWorkbenchCss, '.sidebar-jump-dot.done')
  const stageDoneDot = cssBlock(episodeWorkbenchCss, '.stage-subnav-dot')

  assert.doesNotMatch(doneItem, /#9fcaa7/)
  assert.match(doneIcon, /background:\s*var\(--success-bg\)/)
  assert.match(doneIcon, /color:\s*var\(--success\)/)
  assert.match(iconDone, /background:\s*var\(--success-bg\)/)
  assert.match(sidebarDoneDot, /background:\s*var\(--success\)/)
  assert.doesNotMatch(stageDoneDot, /#9fcaa7/)
  assert.match(episodeWorkbenchCss, /\.pipe-item\.active\.done \.pipe-icon\s*\{/)
})
