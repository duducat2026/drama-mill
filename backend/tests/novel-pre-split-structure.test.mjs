import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readNovelRouteSources } from './helpers/novel-route-sources.mjs'
import { readUseApiSources } from '../../frontend/tests/helpers/use-api-sources.mjs'

const root = new URL('..', import.meta.url)
const repoRoot = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const readRepo = (path) => readFileSync(new URL(path, repoRoot), 'utf8')

// ─── 后端 novel-text.ts 纯函数 ─────────────────────────

test('novel-text.ts exports preSplitNovel function and PreSplitChunk interface', () => {
  const svc = read('src/services/novel-text.ts')
  assert.match(svc, /export interface PreSplitChunk/)
  assert.match(svc, /export function preSplitNovel\(/)
  // 支持两种切分模式：按每份段落数 / 按目标份数
  assert.match(svc, /paragraphsPerNovel/)
  assert.match(svc, /targetNovels/)
  assert.match(svc, /titlePrefix/)
  // 新增 chars 模式参数
  assert.match(svc, /splitMode/)
  assert.match(svc, /targetChars/)
  // chars 模式使用章节识别 + 归组
  assert.match(svc, /detectChapters/)
  assert.match(svc, /groupChapters/)
  // 标题序号零填充（01、02…）
  assert.match(svc, /padStart\(2, '0'\)/)
})

test('novel-text.ts PreSplitChunk has optional chapterCount field', () => {
  const svc = read('src/services/novel-text.ts')
  assert.match(svc, /chapterCount\?/)
})

test('novel-split.ts re-exports preSplitNovel and PreSplitChunk for route import', () => {
  const svc = read('src/services/novel-split.ts')
  assert.match(svc, /preSplitNovel/)
  assert.match(svc, /PreSplitChunk/)
})

// ─── 后端 novels.ts 路由 ────────────────────────────────

test('novels.ts route imports preSplitNovel and detectParagraphs', () => {
  const route = readNovelRouteSources(root)
  assert.match(route, /import.*preSplitNovel.*from.*novel-split\.js/)
  assert.match(route, /import.*detectParagraphs.*from.*novel-split\.js/)
})

test('novels.ts route defines POST /:id/pre-split endpoint with template support', () => {
  const route = readNovelRouteSources(root)
  assert.match(route, /app\.post\('\/:id\/pre-split'/)
  // 已建项目的小说不允许拆分
  assert.match(route, /novel\.dramaId.*不可拆分/)
  // 支持模版参数
  assert.match(route, /split_template_id/)
  assert.match(route, /split_mode/)
  assert.match(route, /target_chars/)
  // 模版校验
  assert.match(route, /getTemplateUsable/)
  // 上限保护：单次最多 100 份
  assert.match(route, /chunks\.length > 100/)
  // 源小说可选软删除
  assert.match(route, /delete_source/)
  // 创建的小说记录使用 splitStatus: 'uploaded'
  assert.match(route, /splitStatus: 'uploaded'/)
  // 创建的小说记录保存 splitTemplateId
  assert.match(route, /splitTemplateId/)
})

// ─── 前端 useApi.ts ─────────────────────────────────────

test('useApi.ts defines novelAPI.preSplit method with template support', () => {
  const api = readUseApiSources(new URL('frontend/', repoRoot))
  assert.match(api, /preSplit:\s*\(id.*\) => api\.post/)
  assert.match(api, /\/novels\/\$\{id\}\/pre-split/)
  assert.match(api, /paragraphs_per_novel/)
  assert.match(api, /target_novels/)
  assert.match(api, /delete_source/)
  assert.match(api, /split_template_id/)
  assert.match(api, /split_mode/)
  assert.match(api, /target_chars/)
})

// ─── 前端 novels.vue 页面 ───────────────────────────────

test('novels.vue has split button for novels without drama_id', () => {
  const page = readRepo('frontend/app/pages/novels.vue')
  assert.match(page, /v-if="!n\.drama_id".*拆分/)
})

test('拆分弹窗（已拆分为 NovelsPreSplitDialog 组件）含模版选择器', () => {
  const page = readRepo('frontend/app/pages/novels.vue')
  const dialog = readRepo('frontend/app/components/NovelsPreSplitDialog.vue')
  // 页面持有弹窗状态（preSplitNovel），表单细节在子组件
  assert.match(page, /preSplitNovel/)
  assert.match(page, /<NovelsPreSplitDialog/)
  assert.match(dialog, /preSplitForm/)
  // 弹窗标题改为"文档拆分"
  assert.match(dialog, /文档拆分/)
  // 模版选择器
  assert.match(dialog, /preSplitForm\.split_template_id/)
  // split_mode 支持 chars/paragraphs
  assert.match(dialog, /preSplitForm\.split_mode/)
  // 段落模式仍支持两种切分方式
  assert.match(dialog, /preSplitForm\.mode === 'paragraphs'/)
  assert.match(dialog, /preSplitForm\.mode === 'target'/)
  // 标题前缀输入
  assert.match(dialog, /title_prefix/)
  // 源小说删除选项
  assert.match(dialog, /delete_source/)
})

test('submitPreSplit 传 template 与 split_mode 参数，成功后回第一页刷新', () => {
  const dialog = readRepo('frontend/app/components/NovelsPreSplitDialog.vue')
  const lib = readRepo('frontend/app/composables/useNovelsLibrary.js')
  assert.match(dialog, /async function submitPreSplit/)
  assert.match(dialog, /novelAPI\.preSplit/)
  assert.match(dialog, /split_template_id/)
  assert.match(dialog, /split_mode/)
  assert.match(dialog, /target_chars/)
  // 拆分后回到第一页刷新（成功回调在页面状态 composable）
  assert.match(lib, /function onPreSplitDone\(\) \{[\s\S]*page\.value = 1[\s\S]*loadNovels\(\)/)
})

test('novels.vue has link to template management page', () => {
  const page = readRepo('frontend/app/pages/novels.vue')
  assert.match(page, /navigateTo\('\/novel-templates'\)/)
})

test('novels.vue does not have template tab or management UI', () => {
  const page = readRepo('frontend/app/pages/novels.vue')
  // 不应包含 tab-bar 和模版管理相关代码
  assert.doesNotMatch(page, /tab-bar/)
  assert.doesNotMatch(page, /tpl-grid/)
  assert.doesNotMatch(page, /openTplForm/)
  assert.doesNotMatch(page, /saveTpl/)
  assert.doesNotMatch(page, /confirmDeleteTpl/)
})

// ─── 前端 novel-templates.vue 子页面 ──────────────────────

test('novel-templates.vue exists as template management page', () => {
  const page = readRepo('frontend/app/pages/novel-templates.vue')
  assert.match(page, /拆分提示词模版/)
  assert.match(page, /tpl-grid/)
  assert.match(page, /openTplForm/)
  assert.match(page, /saveTpl/)
  assert.match(page, /confirmDeleteTpl/)
  assert.match(page, /navigateTo\('\/novels'\)/)
})

// ─── 前端 default.vue 导航栏 ────────────────────────────

test('default.vue has document library nav link', () => {
  const layout = readRepo('frontend/app/layouts/default.vue')
  assert.match(layout, /to="\/novels"/)
  assert.match(layout, /文档库/)
})
