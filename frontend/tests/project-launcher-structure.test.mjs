import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIndexPageSources } from './helpers/index-page-sources.mjs'

const page = readIndexPageSources(new URL('..', import.meta.url))
const studioCss = readFileSync(new URL('../app/assets/studio.css', import.meta.url), 'utf8')

test('project list opens project detail before choosing an episode', () => {
  assert.match(page, /项目启动台/)
  assert.match(page, /openDrama/)
  assert.match(page, /getDramaPath/)
  assert.match(page, /打开项目/)
  assert.match(page, /navigateTo\(getDramaPath\(d\)\)/)
  assert.doesNotMatch(page, /openWorkbench/)
})

test('project status is manually marked, not derived from content', () => {
  // 手动状态：选项 + 下拉标记 + 持久化到 dramas.status
  assert.match(page, /const statusOptions = \[/)
  assert.match(page, /待开始.*draft/s)
  assert.match(page, /进行中.*active/s)
  assert.match(page, /已完成.*completed/s)
  assert.match(page, /function currentStatus\(d\) \{ return d\.status \|\| 'draft' \}/)
  assert.match(page, /function setDramaStatus/)
  assert.match(page, /dramaAPI\.update\(d\.id, \{ status \}\)/)
  assert.match(page, /statusMenuId/)
  // 筛选与统计由服务端处理：状态过滤下推后端 + /dramas/stats 聚合计数
  // active 筛选合并生产编排自动写入的 producing（逗号多值由后端 inArray 下推）
  assert.match(page, /statusFilter\.value === 'active' \? 'active,producing' : statusFilter\.value/)
  // 生产编排写入的 producing/failed 需正常展示，不再全部兜底为待开始
  assert.match(page, /producing: '生产中'/)
  assert.match(page, /failed: '生产失败'/)
  assert.match(page, /api\.get\('\/dramas\/stats'\)/)
  assert.match(page, /activeCount/)
  // 自动推算已移除：无进度条、无 episodes.length 状态派生
  assert.doesNotMatch(page, /getProgress/)
  assert.doesNotMatch(page, /d\.episodes\?\.length \? '进行中' : '待开始'/)
})

test('project launcher keeps controls simple', () => {
  assert.match(page, /搜索项目/)
  assert.match(page, /新建项目/)
  assert.doesNotMatch(page, /剧集列表/)
  assert.doesNotMatch(page, /制作队列/)
  assert.doesNotMatch(page, /最近活动/)
})

test('create dialog fixes aspect ratio at project creation', () => {
  assert.match(page, /画面比例/)
  assert.match(page, /form\.aspect_ratio/)
  assert.match(page, /aspectRatioOptions/)
  assert.match(page, /aspect_ratio: '16:9'/)
  assert.match(page, /创建后固定/)
  assert.match(page, /16:9 · 横屏/)
  assert.match(page, /9:16 · 竖屏/)
  assert.match(page, /1:1 · 方形/)
  assert.doesNotMatch(page, /计划集数/)
})

test('global buttons use the apple-inspired action palette', () => {
  assert.match(studioCss, /--action-primary:\s*#0071e3/)
  assert.match(studioCss, /--action-secondary:\s*#e8e8ed/)
  assert.match(studioCss, /--action-danger:\s*#ff3b30/)
  assert.match(studioCss, /\.btn-primary\s*\{/)
})
