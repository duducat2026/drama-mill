// 设置中心面板栏宽一致性 — 结构测试（源码断言，沿用现有约定）
// 起因：模型价格 / 后台看门狗 / 风格预设三个面板比 AI 服务窄一截（840 vs 1160），
// 宽屏下内容缩成中间一条、行内两侧大片死白，风格提示词还被 truncate 掐短。
// 教训：.prices-scroll { max-width: 1160px } 写在另一个 scoped 样式文件里，与
// .settings-scroll 同特异性且注入顺序不可控，实测被 840 压过——源码在、效果无。
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'
import { readPricesCss, readPricesPanelSources } from './helpers/prices-panel-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const page = readSettingsSources(root)
// 价格面板不在 settings-page-sources 的拼接清单里，走自己的 helper
const pricesPanel = readPricesPanelSources(root)
const settingsCss = read('app/assets/styles/settings.css')

test('栏宽只有 .settings-scroll 一处定义，与 AI 服务面板同级', () => {
  assert.match(settingsCss, /\.settings-scroll \{[^}]*max-width: 1160px/)
  // 唯一来源：多处 1160 意味着又开了覆写面，早晚被层叠顺序反咬
  assert.equal((settingsCss.match(/max-width: 1160px/g) || []).length, 1)
  assert.doesNotMatch(readPricesCss(root), /max-width: 1160px/)
  // 历史覆写类不得复活（既无规则也无挂载点）
  assert.doesNotMatch(settingsCss, /\.ai-settings-scroll/)
  assert.doesNotMatch(page + pricesPanel, /ai-settings-scroll|prices-scroll/)
})

test('四个面板根容器都落在 .settings-scroll 上', () => {
  assert.match(page, /<div class="settings-scroll">\s*<div class="settings-head">\s*<h2 class="settings-title">AI 服务配置/)
  assert.match(pricesPanel, /<div class="settings-scroll">\s*<div class="settings-head">\s*<h2 class="settings-title">模型价格/)
  assert.match(page, /<div class="settings-scroll">\s*<div class="settings-head">\s*<h2 class="settings-title">风格预设/)
  // 看门狗根节点无 class，靠页面 fallthrough 传入（scoped 父 id 会落到子组件根元素）；Lazy 分包前缀同样成立
  assert.match(page, /<LazySettingsWatchdogPanel v-else-if="tab === 'watchdogs'" class="settings-scroll" \/>/)
})

test('窄栏覆写只允许同文件后置声明', () => {
  // 管理端技能面板刻意收在 900：双类特异性高于 .settings-scroll，且与本文件同表
  const wide = settingsCss.indexOf('.settings-scroll {')
  const skills = settingsCss.indexOf('.skills-main.settings-scroll { max-width: 900px; }')
  assert.ok(wide > -1 && skills > wide, '覆写必须排在 .settings-scroll 之后，否则不生效')
  assert.doesNotMatch(settingsCss, /\.watchdog-scroll|\.styles-scroll/)
})
