// 设置页「后台看门狗」（与 AI 服务平级的独立菜单）— 结构测试（源码断言，沿用现有约定）
// 两项巡检都会后台替用户发起付费调用：默认不启动、状态只从后端读、写失败要回滚
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readUseApiSources } from './helpers/use-api-sources.mjs'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const composable = read('app/composables/useWatchdogSwitch.ts')
const useApi = readUseApiSources(root)
const settingsPage = readSettingsSources(root)
const settingsCss = read('app/assets/styles/settings.css')

test('useApi 暴露看门狗开关读写端点', () => {
  assert.match(useApi, /export type WatchdogKind = 'retry' \| 'asset'/)
  assert.match(useApi, /export const watchdogAPI = \{/)
  assert.match(useApi, /api\.get<\{ retry: boolean; asset: boolean \}>\('\/auth\/watchdogs'\)/)
  assert.match(useApi, /api\.put<\{ retry: boolean; asset: boolean \}>\('\/auth\/watchdogs', \{ kind, enabled \}\)/)
})

test('useWatchdogSwitch: 默认不启动 + 乐观更新回滚 + 单飞', () => {
  // 初始值与后端 DEFAULT 0 一致：未读到后端状态前不会误显示为已开启
  assert.match(composable, /reactive<Record<WatchdogKind, boolean>>\(\{ retry: false, asset: false \}\)/)
  assert.match(composable, /watchdogSubmitting = ref<WatchdogKind \| null>\(null\)/)
  // 同一时刻只允许一个开关在途，避免连点把两个开关写串
  assert.match(composable, /if \(watchdogSubmitting\.value \|\| target === watchdogs\[kind\]\) return watchdogs/)
  assert.match(composable, /watchdogs\[kind\] = target/)
  assert.match(composable, /await watchdogAPI\.set\(kind, target\)/)
  // 后端拒绝则回滚原值并抛出，交调用方提示
  assert.match(composable, /watchdogs\[kind\] = prev\n\s*throw e/)
  // 刷新失败保留现值（仍是不启动），不打断设置页
  assert.match(composable, /await watchdogAPI\.get\(\)/)
  // 文案集中在 composable，页面不各写一份
  assert.match(composable, /export const WATCHDOG_ITEMS/)
  assert.match(composable, /label: '失败任务自动重提'/)
  assert.match(composable, /label: '缺图资产自动补生成'/)
})

test('看门狗单独成菜单，与 AI 服务平级', () => {
  // 导航项与 AI 服务、模型价格、风格预设同一组，id 与内容分支一一对应
  assert.match(settingsPage, /\{ id: 'ai', label: 'AI 服务', icon: Cpu \},\s*\{ id: 'prices', label: '模型价格', icon: Coins \},\s*\{ id: 'watchdogs', label: '后台看门狗', icon: TimerReset \},/)
  assert.match(settingsPage, /v-else-if="tab === 'watchdogs'" class="settings-scroll"/)
  assert.match(settingsPage, /<h2 class="settings-title">后台看门狗<\/h2>/)
  // 面板整体从 AI 服务分支移出：AI 分支内不再残留看门狗 UI
  const aiBlock = settingsPage.slice(
    settingsPage.indexOf(`v-if="tab === 'ai'"`),
    settingsPage.indexOf(`v-else-if="tab === 'watchdogs'"`),
  )
  assert.ok(aiBlock.length > 0)
  assert.doesNotMatch(aiBlock, /watchdog-panel|watchdogItems/)
  // 单独成页后补「生效边界」，说明开关只拦自动提交
  assert.match(settingsPage, /<div class="setup-title">生效边界<\/div>/)
  assert.match(settingsPage, /class="watchdog-rules"/)
})

test('设置页渲染两个看门狗开关并说明计费后果', () => {
  assert.match(settingsPage, /import \{[^}]*\bPlus\b[^}]*\bTimerReset\b[^}]*\} from 'lucide-vue-next'/)
  assert.match(settingsPage, /const \{ watchdogs, watchdogItems, watchdogSubmitting, refreshWatchdogs, toggleWatchdog \} = useWatchdogSwitch\(\)/)
  assert.match(settingsPage, /class="card watchdog-panel" :class="\{ 'is-on': watchdogOnCount > 0 \}"/)
  // 页头讲清计费后果，卡片头只反映当前授权态（不重复页头文案）
  assert.match(settingsPage, /替你发起模型调用并按用量计价，因此默认都不启动/)
  assert.match(settingsPage, /const watchdogOnCount = computed\(\(\) => watchdogItems\.filter\(w => watchdogs\[w\.kind\]\)\.length\)/)
  assert.match(settingsPage, /v-for="wd in watchdogItems" :key="wd\.kind" class="watchdog-row"/)
  assert.match(settingsPage, /:checked="watchdogs\[wd\.kind\]"/)
  assert.match(settingsPage, /:disabled="watchdogSubmitting === wd\.kind"/)
  assert.match(settingsPage, /@change="onWatchdogToggle\(wd\.kind, \$event\)"/)
  // 未启动态用琥珀标签明示，不靠文案暗示
  assert.match(settingsPage, /watchdogs\[wd\.kind\] \? '已开启' : '不启动'/)
  // 与模型调用总开关联动：总开关关闭时给出「开了也不会提交」的提示
  assert.match(settingsPage, /v-if="!aiCallEnabled" class="watchdog-note"/)
  assert.match(settingsPage, /v-else-if="!watchdogOnCount" class="watchdog-note"/)
  // 数据按激活面板懒加载：看门狗数据只在进入 watchdogs 面板时拉，总开关状态进页即对齐
  assert.match(settingsPage, /const PANEL_LOADERS = \{ ai: loadCfgs, styles: loadStylePresets, watchdogs: refreshWatchdogs \}/)
  assert.match(settingsPage, /onMounted\(\(\) => \{[\s\S]*?else \{ refreshAiCall\(\); PANEL_LOADERS\[tab\.value\]\?\.\(\) \}/)
  assert.match(settingsPage, /watch\(tab, \(id\) => \{ if \(!cfgPage\.value\) PANEL_LOADERS\[id\]\?\.\(\) \}\)/)
  // 面板样式存在，开启态有绿色左条与绿色图标（不只靠文字）
  assert.match(settingsCss, /\.watchdog-panel \{/)
  assert.match(settingsCss, /\.watchdog-panel\.is-on \{ border-left-color: var\(--success\); \}/)
  assert.match(settingsCss, /\.watchdog-row\.is-on \{ border-left-color: var\(--success\)/)
})
