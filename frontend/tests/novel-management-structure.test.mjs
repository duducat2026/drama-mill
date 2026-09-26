import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readUseApiSources } from './helpers/use-api-sources.mjs'
import { readAdminNovelsSources } from './helpers/admin-novels-sources.mjs'
import { readNovelWizardSources } from './helpers/novel-wizard-sources.mjs'
import { readNovelsPageSources } from './helpers/novels-page-sources.mjs'

const frontendRoot = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, frontendRoot), 'utf8')

test('useApi wires novel library, split templates and admin endpoints', () => {
  const api = readUseApiSources(frontendRoot)

  // 小说库接口：无 drama_id 列表 / 正文 / 修改 / 删除 / 批量删除 / 批量建项目 / 生成项目
  assert.match(api, /novelAPI = \{/)
  assert.match(api, /content: \(id: number\) => api\.get[\s\S]{0,80}\/novels\/\$\{id\}\/content/)
  assert.match(api, /batchDelete: \(ids: number\[\]\) => api\.post[\s\S]{0,60}\/novels\/batch-delete/)
  assert.match(api, /createProjects: /)
  assert.match(api, /dramas: \(id: number\) => api\.get[\s\S]{0,80}\/novels\/\$\{id\}\/dramas/)
  // 上传支持不带 drama_id 入小说库
  assert.match(api, /if \(dramaId\) fd\.append\('drama_id'/)

  // 拆分提示词模版（缓存模式仿 stylePresetAPI）
  assert.match(api, /novelSplitTemplateAPI = \{/)
  assert.match(api, /novel-split-templates\$\{all/)
  assert.match(api, /invalidateListCache\('novel-split-templates:'\)/)

  // 批量上传支持拆分模版 + 两步走模式（split_only 先拆分停下，确认后再 produce 生产）
  assert.match(api, /split_template_id\?: number; auto_start\?: boolean/)
  assert.match(api, /fd\.append\('split_template_id'/)
  assert.match(api, /mode\?: 'full' \| 'split_only'/)
  assert.match(api, /fd\.append\('mode', opts\.mode\)/)
  assert.match(api, /produce: \(id: number\) => api\.post[\s\S]{0,60}\/production-batch\/\$\{id\}\/produce/)

  // 管理后台：小说检索/预览/删除 + 模版管理
  assert.match(api, /novels: \(params\?: \{ username\?: string; keyword\?: string; from\?: string; to\?: string/)
  assert.match(api, /novelContent: /)
  assert.match(api, /deleteNovel: /)
  assert.match(api, /novelDramas: /)
  assert.match(api, /novelSplitTemplates: /)
  assert.match(api, /createNovelSplitTemplate: /)
})

test('user document library page provides list/edit/preview/delete/create-projects', () => {
  const page = readNovelsPageSources(frontendRoot)

  // 文档库页面标题
  assert.match(page, /文档库/)
  // 链接到拆分模版管理子页面
  assert.match(page, /navigateTo\('\/novel-templates'\)/)

  // 列表能力：搜索 / 多选 / 批量删除 / 创建项目
  assert.match(page, /novelAPI\.list\(/)
  assert.match(page, /novelAPI\.batchDelete/)
  assert.match(page, /novelAPI\.createProjects/)
  assert.match(page, /toggleAll/)

  // 预览 / 编辑 / 生成项目 / 软删除
  assert.match(page, /novelAPI\.content/)
  assert.match(page, /novelAPI\.update/)
  assert.match(page, /novelAPI\.del\(/)
  assert.match(page, /novelAPI\.dramas/)

  // 导入入库（不建项目）与拆分模版选择
  assert.match(page, /novelAPI\.upload\(f\)/)
  assert.match(page, /novelSplitTemplateAPI\.list/)
  assert.match(page, /split_template_id: createForm\.value\.split_template_id/)

  // 建项目弹窗两步走：默认 split_only（先拆分确认再生产）+ 传 mode + 段落模版隐藏字数输入；
  // 拆分成多份与创作生产拆成两步，避免未经确认直接消耗生成额度。
  assert.match(page, /mode: 'split_only' \}\)/)
  assert.match(page, /value="split_only"/)
  assert.match(page, /mode: createForm\.value\.mode/)
  assert.match(page, /createTplIsParagraphs/)
  assert.match(page, /v-if="!createTplIsParagraphs" class="field"/)
  // 不再包含模版管理 UI（已移至 /novel-templates 独立页面）
  assert.doesNotMatch(page, /tab === 'novels'/)
  assert.doesNotMatch(page, /tplForm/)

  // 滚动修复：布局 .content 为 overflow:hidden，页面自身必须是滚动容器，否则列表无法上下拉动；
  // max-width 等内容布局放在 inner 层，避免滚动条落在居中的内容盒右侧边缘上。
  assert.match(page, /\.novels-page \{ height: 100%; overflow-y: auto; \}/)
  assert.match(page, /class="novels-inner"/)

  // 服务端分页：可变每页条数 + 页码直接跳转 + 搜索/删除后页码联动回退防落空页。
  assert.match(page, /page_size: pageSize\.value/)
  assert.match(page, /pagination\.value = res\.pagination/)
  assert.match(page, /class="list-pager"/)
  assert.match(page, /PAGE_SIZE_OPTIONS/)
  assert.match(page, /function gotoPage/)
  assert.match(page, /function changePageSize/)
  assert.match(page, /const pageList = computed/)
  assert.match(page, /pager-page/)
  assert.match(page, /pager-ellipsis/)
  assert.match(page, /page\.value--/)
})

test('home page exposes novel library entry', () => {
  const home = read('app/pages/index.vue')
  assert.match(home, /navigateTo\('\/novels'\)/)
  assert.match(home, /文档库/)
})

test('import wizard supports split template selection in both single and batch mode', () => {
  const wizard = readNovelWizardSources(frontendRoot)
  assert.match(wizard, /novelSplitTemplateAPI/)
  assert.match(wizard, /splitTemplateOptions/)
  // 批量模式：上传带模版 + 两步走（默认 split_only）
  assert.match(wizard, /split_template_id: splitTemplateId\.value \|\| undefined/)
  assert.match(wizard, /const batchMode = ref\('split_only'\)/)
  assert.match(wizard, /mode: batchMode\.value/)
  assert.match(wizard, /auto_start: batchMode\.value === 'full'/)
  // 段落模版（诗词/笑话）选中时隐藏字数输入并提示每集段落数
  assert.match(wizard, /batchTplIsParagraphs/)
  assert.match(wizard, /singleTplIsParagraphs/)
  assert.match(wizard, /selectedSplitTpl\.value\?\.split_mode === 'paragraphs'/)
  // 单部模式：拆分带模版（拆分方式由后端随模版继承）
  assert.match(wizard, /novelAPI\.split\(novel\.value\.id, targetChars\.value, splitTemplateId\.value/)
  // 选模版预填建议字数（段落模版跳过预填）
  assert.match(wizard, /default_target_chars\) targetChars\.value = tpl\.default_target_chars/)
  assert.match(wizard, /tpl\?\.split_mode === 'paragraphs'\) return/)
})

test('batch production panel renders split_done status and produce entry for two-step batches', () => {
  const panel = read('app/components/BatchProductionPanel.vue')
  // 拆分完成·待生产中间态 + 两步走批次头标与待生产计数展示
  assert.match(panel, /split_done: '拆分完成 · 待生产'/)
  assert.match(panel, /detail\.mode === 'split_only'/)
  assert.match(panel, /detail\.counts\.split_done/)
  // 启动生产按钮：仅 split_only 且非 running 且有待生产项时出现，调 produce 接口（幂等）
  assert.match(panel, /canProduce/)
  assert.match(panel, /productionBatchAPI\.produce\(selectedId\.value\)/)
  // split_only 批次禁用通用启动按钮（避免绕过两步走直接调度）
  assert.match(panel, /detail\.value\.mode !== 'split_only'/)
})

test('admin novel page has dual tabs: search list and template management', () => {
  const page = readAdminNovelsSources(frontendRoot)

  assert.match(page, /definePageMeta\(\{ layout: 'admin' \}\)/)
  assert.match(page, /tab === 'novels'/)
  assert.match(page, /tab === 'templates'/)

  // 检索：用户名 / 小说名 / 创建日期范围
  assert.match(page, /filters\.value\.username/)
  assert.match(page, /filters\.value\.from/)
  assert.match(page, /filters\.value\.to/)
  assert.match(page, /type="date"/)
  assert.match(page, /adminAPI\.novels\(/)

  // 预览 / 删除 / 生成项目
  assert.match(page, /adminAPI\.novelContent/)
  assert.match(page, /adminAPI\.deleteNovel/)
  assert.match(page, /adminAPI\.novelDramas/)

  // 模版管理：检索（含仅系统内置）+ 新建默认系统内置 + 编辑/删除；表单支持拆分方式（字数/段落）
  assert.match(page, /adminAPI\.novelSplitTemplates/)
  assert.match(page, /system_only: systemOnly\.value/)
  assert.match(page, /is_system: f\.is_system/)
  assert.match(page, /adminAPI\.createNovelSplitTemplate/)
  assert.match(page, /adminAPI\.updateNovelSplitTemplate/)
  assert.match(page, /adminAPI\.deleteNovelSplitTemplate/)
  assert.match(page, /v-model="tplForm\.split_mode"/)
  assert.match(page, /split_mode: f\.split_mode/)
  assert.match(page, /t\.split_mode === 'paragraphs'/)
})

test('admin nav exposes novel management entry', () => {
  const layout = read('app/layouts/admin.vue')
  assert.match(layout, /path: '\/admin\/novels'/)
  assert.match(layout, /小说管理/)
  assert.match(layout, /Library/)
})

test('BaseSelect supports disabled state', () => {
  const comp = read('app/components/BaseSelect.vue')
  assert.match(comp, /disabled: \{ type: Boolean, default: false \}/)
  assert.match(comp, /:disabled="disabled"/)
})
