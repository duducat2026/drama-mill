/**
 * 阶段三性能治理结构测试：
 * - 后端：/dramas/stats SQL 聚合下推、批次列表限额+GROUP BY、剧集归属轻投影
 * - 前端：工作台惰性加载、轮询"完成再排程/隐藏停轮"改造
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readProductionBatchSources } from '../../backend/tests/helpers/production-batch-sources.mjs'
import { episodeViewSource } from './helpers/episode-sources.mjs'
import { readIndexPageSources } from './helpers/index-page-sources.mjs'

const frontendRoot = new URL('..', import.meta.url)
const backendRoot = new URL('../../backend/', import.meta.url)
const read = (root, path) => readFileSync(new URL(path, root), 'utf8')

// ─── 后端：首页 stats 聚合下推 ───
test('dramas stats aggregates via SQL GROUP BY without loading rows', () => {
  const route = read(backendRoot, 'src/routes/dramas.ts')
  const statsBlock = route.slice(route.indexOf("app.get('/stats'"), route.indexOf("app.get('/stats'") + 900)
  assert.match(statsBlock, /COUNT\(\*\)/)
  assert.match(statsBlock, /\.groupBy\(schema\.dramas\.status\)/)
  // 不允许回退为全行拉取 + Node 逐行 reduce 统计
  assert.doesNotMatch(statsBlock, /db\.select\(\)\.from\(schema\.dramas\)/)
  assert.doesNotMatch(statsBlock, /all\.reduce\(/)
})

// ─── 后端：批次列表限额 + 条目计数 SQL 聚合 ───
test('listBatches caps recent batches and counts items via GROUP BY', () => {
  const svc = readProductionBatchSources(backendRoot)
  assert.match(svc, /const LIST_BATCHES_LIMIT = 100/)
  assert.match(svc, /\.limit\(LIST_BATCHES_LIMIT\)/)
  assert.match(svc, /\.groupBy\(schema\.productionBatchItems\.batchId, schema\.productionBatchItems\.status\)/)
  // 不再把用户全部历史批次条目载入 Node
  assert.doesNotMatch(svc, /result\.reverse\(\)/)
})

// ─── 后端：剧集归属校验轻投影 ───
test('getEpisodeOwned projects without MEDIUMTEXT columns; full row only for detail', () => {
  const own = read(backendRoot, 'src/services/ownership.ts')
  assert.match(own, /const \{ content: _c, scriptContent: _s, \.\.\.episodeLightCols \} = getTableColumns\(schema\.episodes\)/)
  assert.match(own, /db\.select\(episodeLightCols\)\.from\(schema\.episodes\)/)
  assert.match(own, /export async function getEpisodeFullOwned/)
  // 分镜归属链路只取 drama_id
  assert.match(own, /db\.select\(\{ dramaId: schema\.episodes\.dramaId \}\)/)

  const eps = read(backendRoot, 'src/routes/episodes.ts')
  // 单集详情（需要正文）用全列版本，其余状态类端点保持轻投影
  const detailBlock = eps.slice(eps.indexOf("app.get('/:id'"), eps.indexOf("app.get('/:id'") + 400)
  assert.match(detailBlock, /getEpisodeFullOwned\(id, user\)/)
  assert.match(eps, /getEpisodeOwned\(id, user\)/)
})

// ─── 前端：工作台惰性加载 + 链式轮询 ───
test('episode workbench lazy-loads export merges and defers cost/timing stats', () => {
  const page = episodeViewSource()
  // 成片列表仅进导出面板时拉取
  assert.match(page, /watch\(panel, p => \{ if \(p === 'export'\) loadExportMerges\(\) \}\)/)
  // refresh 不再在首屏同步等导出列表与耗时/成本统计
  assert.doesNotMatch(page, /Promise\.all\(\[loadGenTasks\(\), loadExportMerges\(\), loadEpStats\(\)\]\)/)
  assert.match(page, /if \(panel\.value === 'export'\) await loadExportMerges\(\)/)
  assert.match(page, /void loadEpStats\(\)/)
})

test('episode workbench polls chain-scheduled after completion with unmount cleanup', () => {
  const page = episodeViewSource()
  // 任务抽屉轮询：setInterval → 完成后再排的 setTimeout 链
  assert.doesNotMatch(page, /setInterval\(loadGenTasks, 4000\)/)
  assert.match(page, /function scheduleGenTasksPoll\(\) \{[\s\S]*?genTasksTimer = setTimeout\(async \(\) => \{[\s\S]*?await loadGenTasks\(\)/)
  // 拼接状态轮询：链式 + 卸载取消（原匿名 setInterval 会泄漏）
  assert.match(page, /let mergePollTimer = null/)
  assert.match(page, /function stopMergeStatusPolling\(\)/)
  assert.match(page, /stopGenTasksPolling\(\)\s*stopMergeStatusPolling\(\)/)
  assert.doesNotMatch(page, /const poll = setInterval/)
})

// ─── 前端：首页批次徽标 / 后台监控页轮询治理 ───
test('launcher batch badge polls after completion and pauses while hidden', () => {
  const page = readIndexPageSources(frontendRoot)
  assert.doesNotMatch(page, /setInterval\(loadBatches, 20000\)/)
  assert.match(page, /async function fetchBatchBadge\(\)/)
  assert.match(page, /document\.hidden.*scheduleBatchPoll\(\); return/s)
  assert.match(page, /batchTimer = setTimeout\(async \(\) => \{[\s\S]*?await fetchBatchBadge\(\)[\s\S]*?scheduleBatchPoll\(\)/)
})

test('admin storage page uses chained 60s refresh with hidden pause', () => {
  const page = read(frontendRoot, 'app/pages/admin/storage.vue')
  assert.doesNotMatch(page, /setInterval/)
  assert.match(page, /const REFRESH_INTERVAL = 60000/)
  assert.match(page, /async function tick\(\) \{\s*await refresh\(\)\s*schedule\(\)/)
  assert.match(page, /addEventListener\('visibilitychange', onVisibility\)/)
})
