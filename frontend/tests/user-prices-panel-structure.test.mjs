import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readUseApiSources } from './helpers/use-api-sources.mjs'
import { readPricesPanelSources, readPricesCss } from './helpers/prices-panel-sources.mjs'

const frontendRoot = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, frontendRoot), 'utf8')

test('userModelPriceAPI：六个用户级价格端点封装，删除走 api.del', () => {
  const api = readUseApiSources(frontendRoot)
  assert.match(api, /export const userModelPriceAPI = \{/)
  assert.match(api, /api\.get\(`\/model-prices\$\{query\.size/)
  assert.match(api, /api\.get\(`\/model-prices\/catalog\$\{query\.size/)
  assert.match(api, /api\.post\('\/model-prices\/import', \{ items \}\)/)
  assert.match(api, /create: \(d: any\) => api\.post\('\/model-prices', d\)/)
  assert.match(api, /update: \(id: number, d: any\) => api\.put\(`\/model-prices\/\$\{id\}`/)
  assert.match(api, /remove: \(id: number\) => api\.del\(`\/model-prices\/\$\{id\}`\)/)
})

test('useUserPrices：模块级单例共享状态 + 模态映射 + 写后强刷', () => {
  const composable = read('app/composables/settings/useUserPrices.js')
  // 面板与 AI 配置编辑器共用一份列表：状态在模块级而非 composable 内
  assert.match(composable, /^const myPrices = ref\(\[\]\)/m)
  assert.match(composable, /BILLING_BY_SERVICE = \{ text: 'token', image: 'image', video: 'video_second' \}/)
  // 计价口径与后端一致：按 model 名匹配
  assert.match(composable, /myPrices\.value\.find\(p => p\.model === model\)/)
  assert.match(composable, /pricesLoaded\.value && !force/)
  for (const fn of ['importPrices', 'createPrice', 'updatePrice', 'removePrice']) {
    assert.match(composable, new RegExp(`${fn}[\\s\\S]{0,120}loadMyPrices\\(true\\)`), `${fn} 写后应强刷`)
  }
})

test('模型价格面板 + 导入弹窗：我的模型价/导入/自定义/删除回退', () => {
  const panel = readPricesPanelSources(frontendRoot)
  assert.match(panel, /我的模型价/)
  assert.match(panel, /从平台目录导入/)
  assert.match(panel, /自定义价格/)
  assert.match(panel, /loadMyPrices\(\)/)
  assert.match(panel, /userModelPriceAPI\.catalog\(/)
  assert.match(panel, /billingFilters/, '应有模态分组筛选')
  assert.match(panel, /回退平台基准/, '删除应提示回退基准计价')

  // 跨页选择：选中项按整行存 Map，提交取全部选中（不得只取当前页 catalogItems）
  assert.match(panel, /const selected = ref\(new Map\(\)\)/)
  assert.match(panel, /else s\.set\(m\.model, m\)/)
  assert.match(panel, /\[\.\.\.selected\.value\.values\(\)\]\.map\(m => \(\{ provider: m\.provider, model: m\.model \}\)\)/)
  assert.doesNotMatch(panel, /catalogItems\.value\.filter\(m => selected\.value\.has/, '导入不应只提交当前页选中项')
  // 与后端单次上限一致
  assert.match(panel, /items\.length > 200/)
  // 导入走 composable 的 importPrices（写后 loadMyPrices(true) 强刷），不绕过刷新
  assert.match(panel, /await importPrices\(items\)/)
  assert.doesNotMatch(panel, /userModelPriceAPI\.import\(/, '面板不应直连裸导入 API')

  const page = read('app/pages/settings.vue')
  assert.match(page, /\{ id: 'prices', label: '模型价格', icon: Coins \}/)
  assert.match(page, /import SettingsPricesPanel from '~\/components\/settings\/SettingsPricesPanel\.vue'/)
  assert.match(page, /<SettingsPricesPanel v-else-if="tab === 'prices'" \/>/)
})

test('价目单式列表：按模态分节 + 单位进节头 + 数字格式化（不得回退成多列表格）', () => {
  const panel = read('app/components/settings/SettingsPricesPanel.vue')
  // 一个模态一章：章节头声明计价单位，行内不再重复
  assert.match(panel, /v-for="sheet in sheets" :key="sheet\.key" class="price-sheet"/)
  assert.match(panel, /price-sheet-unit">\{\{ sheet\.unit \}\}/, '计价单位应只出现在节头')
  assert.match(panel, /class="price-row-fig"/)
  // 来源标记落在厂商行内（点 + 字），与模型名同列
  assert.match(panel, /class="price-row-vendor"[\s\S]{0,200}class="price-row-from"/)
  // 三列价格 → 空列是旧版溢出与「—」噪音的根源，禁止回退
  assert.doesNotMatch(panel, /class="price-table"/, '不应再用横向多列表格')
  assert.doesNotMatch(panel, /<th>输入价<\/th>/)
  assert.doesNotMatch(panel, /class="dim">—</, '不应为不适用模态渲染空列占位')

  // 小数噪声（35.6472 / 0.198029）交给 fmtMoney 收敛，禁止裸插值
  assert.match(panel, /\{\{ fmtMoney\(p\.input_price\) \}\}/)
  assert.match(panel, /\{\{ fmtMoney\(p\.unit_price\) \}\}/)
  const composable = read('app/composables/settings/useUserPrices.js')
  assert.match(composable, /export function fmtMoney\(v\)/)
  // 目录价是美元折算来的六位小数：按有效数字收敛，大额价保分，并挡住 toPrecision 的 e 记数法
  assert.match(composable, /n >= 1000 \? n\.toFixed\(2\) : n\.toPrecision\(4\)/)
  assert.match(composable, /if \(s\.includes\('e'\)\) s = n\.toFixed\(6\)/)
  // 只削小数尾零：正则必须带 \.\d*? 前缀，否则 100 会被削成 1
  assert.match(composable, /replace\(\/\(\\\.\\d\*\?\)0\+\$\/, '\$1'\)/)

  // 弹窗拆分后由面板按需挂载，关闭即卸载（每次打开重拉目录、重置选择）
  assert.match(panel, /<SettingsPricesImportDialog v-if="importOpen" @close="importOpen = false" \/>/)
  const dialog = read('app/components/settings/SettingsPricesImportDialog.vue')
  assert.match(dialog, /onMounted\(\(\) => loadCatalog\(1\)\)/)
  assert.match(dialog, /selected\.value = new Map\(\)\n\s*loadCatalog\(catalogPage\.value\)/, '导入成功后应刷新目录行状态')
  assert.match(dialog, /本页全选/, '长列表应可整页勾选')
})

test('价格面板样式：操作列隐匿于 hover 且触屏常显、窄栏不溢出', () => {
  const css = readPricesCss(frontendRoot)
  // 栏宽统一由 settings.css 的 .settings-scroll 给出：跨文件的 scoped 覆写注入顺序不可控，
  // 旧版 .prices-scroll { max-width: 1160px } 实测被 840 压过而静默失效（见 settings-panel-width.test.mjs）
  assert.doesNotMatch(css, /max-width: 1160px/)
  assert.match(read('app/assets/styles/settings.css'), /\.settings-scroll \{[^}]*max-width: 1160px/)
  // 操作按钮不再占据表格最后一列（旧版被纵向滚动条裁掉「删除」）
  assert.match(css, /\.price-row-ops \{[^}]*opacity: 0/)
  assert.match(css, /\.price-row:hover \.price-row-ops, \.price-row:focus-within \.price-row-ops \{ opacity: 1/)
  assert.match(css, /@media \(hover: none\) \{ \.price-row-ops \{ opacity: 1; transform: none; \} \}/, '触屏无 hover 时必须常显')
  // 等宽数字右对齐成一条竖线
  assert.match(css, /\.price-row-fig \{[^}]*justify-content: flex-end[^}]*font-variant-numeric: tabular-nums/)
  // 数字列右边界必须稳定：按钮不换行（每行同字数），否则竖线被推歪
  assert.match(css, /\.price-btn \{[^}]*white-space: nowrap/)
  // 来源收进厂商行：不再单占一列，窄栏下操作列才不会被挤到第二行
  assert.doesNotMatch(css, /\.price-row-src/, '来源不该再占独立一列')
  assert.match(css, /\.price-row-vendor \{ display: flex;[^}]*font-size: 11\.5px/)
  assert.match(css, /\.price-row-from\[data-src='manual'\] \{ color: var\(--accent-text\); \}/)
  // 剩余宽度交给点引导线（名称列贴字收口），而不是留在名称列里空着
  assert.match(css, /\.price-row-id \{\s*flex: 0 1 auto; min-width: 0; max-width: 55%/)
  assert.match(css, /\.price-row-leader \{[^}]*flex: 1 1 40px[^}]*border-bottom: 1px dotted/)
  // 长模型名只折行、不撑破布局
  assert.match(css, /\.price-row-model \{[^}]*overflow-wrap: anywhere/)
  assert.match(css, /\.pcat-model \{[^}]*flex: 1 1 auto[^}]*overflow-wrap: anywhere/)
  assert.match(css, /\.pcat-vendor \{[^}]*white-space: nowrap/)
  // 组件各自挂载样式文件（父页 scoped 穿透不到子组件内部元素）
  for (const f of ['SettingsPricesPanel.vue', 'SettingsPricesImportDialog.vue']) {
    assert.match(read(`app/components/settings/${f}`), /style scoped src="~\/assets\/styles\/settings\.prices\.css"/, `${f} 应挂载价格面板样式`)
  }
})

test('我的模型价分页：20/50 每页、前端切片、筛选与页量变更回第 1 页', () => {
  const panel = read('app/components/settings/SettingsPricesPanel.vue')
  assert.match(panel, /const PAGE_SIZES = \[20, 50\]/)
  assert.match(panel, /const pageSize = ref\(20\)/)
  // 全量列表由模块级 myPrices 承载（AI 配置编辑器按模型名反查价目），分页只在前端切片
  assert.match(panel, /filteredPrices\.value\.slice\(start, start \+ pageSize\.value\)/)
  assert.doesNotMatch(panel, /userModelPriceAPI\.list\(\{[^}]*page/, '价格列表不该改成后端分页')
  // 页码越界保护：删到末页只剩一条时回退，而不是显示空页
  assert.match(panel, /watch\(pages, \(n\) => \{ if \(page\.value > n\) page\.value = n \}\)/)
  assert.match(panel, /watch\(billingFilter, \(\) => \{ page\.value = 1 \}\)/)
  assert.match(panel, /function setPageSize\(s\) \{ pageSize\.value = s; page\.value = 1 \}/)
  // 节头计数恒为该模态全量，不随翻页跳动；条数概览交给分页器
  assert.match(panel, /price-sheet-count">\{\{ sheet\.total \}\}/)
  assert.match(panel, /class="price-pager"[\s\S]{0,200}共 \{\{ filteredPrices\.length \}\} 条/)
  assert.match(panel, /:disabled="page <= 1" @click="goPage\(page - 1\)">上一页/)
  assert.match(panel, /:disabled="page >= pages" @click="goPage\(page \+ 1\)">下一页/)
})

test('卡头工具条：计数只说一遍、操作右靠、左边缘与价目行同线', () => {
  const panel = read('app/components/settings/SettingsPricesPanel.vue')
  const css = readPricesCss(frontendRoot)
  // 标题 + 自带计数的 chips + 操作同一行（旧版 setup-panel-head 两端对拉拉出死白）
  assert.match(panel, /<div class="price-bar">\s*<div class="price-bar-title">我的模型价<\/div>/)
  assert.match(panel, /<div v-if="myPrices\.length" class="config-actions price-bar-ops">/)
  assert.doesNotMatch(panel, /setup-panel-head/)
  // 「已配置 N 个模型价格」与 chips 的「全部 N」是同一件事说两遍，副标题已删
  assert.doesNotMatch(panel, /已配置 \$\{myPrices\.length\} 个模型价格/)
  assert.match(css, /\.price-bar \{[^}]*border-bottom: 1px solid var\(--border\)/)
  assert.match(css, /\.price-bar-ops \{ margin-left: auto; \}/)
  assert.match(css, /\.price-bar \.price-filter \{ margin: 0; \}/, 'chips 进卡头后不该再留行距')
  // 卡头 / 节头 / 价目行 / 分页器共用同一组左右内边距，左边缘落在同一条竖线
  assert.match(css, /\.price-bar \{[^}]*padding: 13px 12px 13px 14px/)
  assert.match(css, /\.price-sheet-head \{[^}]*padding: 0 12px 7px 14px/)
  assert.match(css, /\.price-row \{[^}]*padding: 9px 12px 9px 14px/)
  assert.match(css, /\.price-pager \{[^}]*padding: 13px 12px 4px 14px/)
  // 窄屏各占一行时按钮不该右靠悬空（左右内边距保持与价目行同线）
  assert.match(css, /@media \(max-width: 760px\) \{\s*\.price-bar \{ gap: 8px; padding-top: 12px; padding-bottom: 12px; \}\s*\.price-bar-ops \{ margin-left: 0; width: 100%; \}/)
})


