import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { episodeViewSource } from './helpers/episode-sources.mjs'
import { readUseApiSources } from './helpers/use-api-sources.mjs'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const switchComposable = read('app/composables/useAiSwitch.ts')
const useApi = readUseApiSources(root)
const useAuth = read('app/composables/useAuth.ts')
const settingsPage = readSettingsSources(root)
const defaultLayout = read('app/layouts/default.vue')
const workbench = episodeViewSource()

test('useAiSwitch shares one client-side state and rolls back on rejection', () => {
  // 全站共享：useState 单例，设置页/顶栏/横幅读到同一份状态
  assert.match(switchComposable, /useState<boolean>\('ai-call-enabled'/)
  // 默认开启，与后端 users.ai_call_enabled DEFAULT 1 一致
  assert.match(switchComposable, /user\.value\?\.aiCallEnabled !== false/)
  assert.match(switchComposable, /aiCallAPI\.get\(\)/)
  assert.match(switchComposable, /aiCallAPI\.set\(target\)/)
  // 乐观更新 + 后端拒绝回滚，避免前端显示与 DB 不一致
  assert.match(switchComposable, /enabled\.value = target/)
  assert.match(switchComposable, /enabled\.value = prev/)
  // 提交中互斥，防止连点翻转
  assert.match(switchComposable, /if \(submitting\.value\) return enabled\.value/)
  // 统一文案导出，页面不再各写一份
  assert.match(switchComposable, /export const AI_CALL_OFF_TIP = '模型调用已关闭/)
})

test('api client and auth user carry the switch', () => {
  assert.match(useApi, /export const aiCallAPI = \{/)
  assert.match(useApi, /api\.get<\{ enabled: boolean[^>]*>\('\/auth\/ai-call'\)/)
  assert.match(useApi, /api\.put<\{ enabled: boolean \}>\('\/auth\/ai-call', \{ enabled \}\)/)
  assert.match(useAuth, /aiCallEnabled\?: boolean/)
})

test('settings page owns the master switch card', () => {
  // 卡片置于 AI 服务 tab 顶部（在手动模板面板之前）
  assert.ok(settingsPage.indexOf('ai-call-panel') < settingsPage.indexOf('setup-panel'))
  assert.match(settingsPage, /模型调用总开关/)
  assert.match(settingsPage, /:checked="aiCallEnabled"[^>]*@change="onAiCallToggle"/)
  assert.match(settingsPage, /class="switch" :class="\{ on: aiCallEnabled \}"/)
  assert.match(settingsPage, /useAiSwitch\(\)/)
  assert.match(settingsPage, /refreshAiCall\(\)/)
  // 关闭态样式存在（琥珀左边条），非仅靠文案
  assert.match(read('app/assets/styles/settings.css'), /\.ai-call-panel\.is-off \{ border-left-color: var\(--warning\)/)
})

test('workbench and global layout surface the switch state', () => {
  // 顶栏快捷开关 + 关闭提示横幅（一键恢复入口）
  assert.match(workbench, /class="ai-call-chip"/)
  assert.match(workbench, /:class="\{ 'is-off': !aiCallEnabled \}"/)
  assert.match(workbench, /class="ai-call-off-bar"/)
  assert.match(workbench, /@click="onAiCallToggle\(true\)"/)
  assert.match(workbench, /import \{ useAiSwitch, AI_CALL_OFF_TIP, aiCallOffMessage \} from '~\/composables\/useAiSwitch'/)
  assert.match(workbench, /refreshAiCall\(\)/)
  assert.match(read('app/assets/styles/episode.workbench.css'), /\.ai-call-off-bar \{/)
  // 其他页面由默认布局给出全站横幅
  assert.match(defaultLayout, /v-if="!aiCallEnabled" class="config-banner is-ai-off"/)
  assert.match(defaultLayout, /useAiSwitch\(\)/)
  // 开关关闭时缺配置横幅让位，避免两条同色横幅堆叠
  assert.match(defaultLayout, /v-if="missingConfigLabels\.length && aiCallEnabled"/)
})

test('shot and merged video downloads use 剧名-第X集-分镜N / 剧名-第X集-本集标题', () => {
  // 命名工具：非法字符清洗 + 集号前缀剥离（episodes.title 形如「第3集 重逢在长街」）
  assert.match(workbench, /function sanitizeFileName\(name\)/)
  assert.ok(workbench.includes(String.raw`.replace(/[\\/:*?"<>|]/g, '')`), '缺少文件名非法字符清洗')
  assert.ok(workbench.includes(String.raw`/^第\s*\d+\s*集[\s:：\-_]+/`), '未剥离集号前缀')
  assert.match(workbench, /const dramaNamePart = computed\(\(\) => sanitizeFileName\(drama\.value\?\.title\)/)
  // 分镜：编号不补零，与播放器标题同源（无分镜号回退任务序号）
  assert.match(workbench, /`分镜\$\{n\}`/)
  assert.match(workbench, /selectedSb\.value\?\.storyboard_number \?\? selectedSb\.value\?\.storyboardNumber \?\? selectedVideoTaskNumber\.value/)
  // 成片：剧名-第X集-本集标题
  assert.match(workbench, /\[dramaNamePart\.value, episodeNoPart\.value, mergeTitlePart\(m\)\]/)
  // video_merges.title 是后端记录字段（历史写入过 `Episode {主键} Merge` 占位串），不得进入文件名
  assert.ok(workbench.includes(String.raw`const MERGE_TITLE_PLACEHOLDER = /^Episode\s*\d+\s*Merge$/i`), '缺少成片记录占位标题黑名单')
  assert.match(workbench, /episodeNamePart\(episode\.value\?\.title\)/)
  assert.doesNotMatch(workbench, /episodeNamePart\(m\?\.title \|\| episode\.value\?\.title\)/)
  // 三处下载入口全部显式命名，不留裸 download
  assert.match(workbench, /:download="shotFileName\(previewVideoUrl \|\| getVideoUrl\(selectedSb\)\)"/)
  assert.match(workbench, /:download="mergeFileName\(m\)"/)
  assert.match(workbench, /:download="mergeFileName\(activeMerge\)"/)
  assert.doesNotMatch(workbench, /\n\s+download\n/)
  assert.doesNotMatch(workbench, /" download /)
  // 扩展名跟随实际产物，未知按 mp4
  assert.match(workbench, /function mediaExt\(url\)/)
  assert.match(workbench, /mp4\|mov\|webm\|m4v\|mkv/)
})

test('turning the switch off requires confirmation; turning it on stays one-click', () => {
  // 关闭方向一律先弹确认：语义是「关闭即拒绝提交」，排队/自动重提任务会被判失败
  assert.match(switchComposable, /export function aiCallOffMessage\(activeTotal: number\)/)
  assert.match(switchComposable, /useState<boolean>\('ai-call-confirming-off'/)
  assert.match(switchComposable, /async function requestAiCallToggle\(next\?: boolean\)/)
  assert.ok(switchComposable.indexOf('confirmingOff.value = true') < switchComposable.indexOf('await toggleAiCall(true)'), '关闭应先转确认，打开才直接提交')
  // 在途任务数取本人 pending,processing（page_size=1 只要 total，不拉列表）
  assert.match(switchComposable, /taskAPI\.list\(\{ status: 'pending,processing', page: 1, page_size: 1 \}\)/)
  assert.match(switchComposable, /res\?\.pagination\?\.total \?\? 0/)
  // 确认框复用既有 ConfirmDialog，两处入口文案与按钮一致
  for (const file of [settingsPage, workbench]) {
    assert.match(file, /:open="aiCallConfirmingOff"/)
    assert.match(file, /title="关闭模型调用总开关"/)
    assert.match(file, /:message="aiCallOffMessage\(aiCallActiveTasks\)"/)
    assert.match(file, /confirm-text="仍要关闭"/)
    assert.match(file, /@confirm="onAiCallOffConfirmed"/)
    assert.match(file, /@cancel="cancelAiCallOff"/)
  }
  // 点击处理器不得绕过确认直接关闭
  assert.doesNotMatch(settingsPage, /toggleAiCall\(false\)/)
  assert.doesNotMatch(workbench, /toggleAiCall\(false\)/)
  // 横幅「立即打开」不走确认
  assert.match(workbench, /if \(!await requestAiCallToggle\(typeof next === 'boolean' \? next : undefined\)\) return/)
  // 确认框图标语义可配：关闭用告警图标，既有删除类调用方保持默认垃圾桶
  const confirmDialog = read('app/components/ConfirmDialog.vue')
  assert.match(confirmDialog, /icon: \{ type: String, default: 'trash' \}/)
  assert.match(confirmDialog, /<TriangleAlert v-if="icon === 'warn'"/)
  assert.match(confirmDialog, /<Trash2 v-else/)
  assert.match(settingsPage, /icon="warn"/)
  assert.match(workbench, /icon="warn"/)
})

test('naming happens client-side: static files stay same-origin via nginx', () => {
  // 未新增 Node 下载端点（大视频不应走 Node 代理），download 属性即可改名
  assert.doesNotMatch(useApi, /\/download\/|attachment/)
  assert.match(workbench, /a\[download\] 即可指定文件名，无需后端下载端点/)
})
