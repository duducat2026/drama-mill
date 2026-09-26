import { readTasksRouteSources } from './helpers/tasks-route-sources.mjs'
import { readDramasRouteSources } from './helpers/dramas-route-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('dramas list uses COUNT aggregation + SQL filter pushdown + pagination', () => {
  const route = readDramasRouteSources(root)

  // COUNT GROUP BY 聚合替代逐项目 N+1 查询
  assert.match(route, /async function countByDrama/)
  assert.match(route, /COUNT\(\*\)/)
  assert.match(route, /groupBy\(table\.dramaId\)/)
  // 搜索/状态过滤下推到 SQL，分页 LIMIT/OFFSET
  assert.match(route, /like\(schema\.dramas\.title/)
  assert.match(route, /\.limit\(/)
  assert.match(route, /\.offset\(/)
  // 响应为分页结构而非全量数组
  assert.match(route, /pagination:\s*\{\s*page/)
})

test('drama detail supports summary=1 lightweight mode', () => {
  const route = readDramasRouteSources(root)

  assert.match(route, /c\.req\.query\('summary'\) === '1'/)
  // 集只带布尔标记，不返回剧本全文
  assert.match(route, /hasScript: sql<number>/)
  assert.match(route, /has_video/)
  // 素材裁列：剔除参考图/种子值
  assert.match(route, /stripAssetHeavy/)
})

test('dramas expose lightweight assets-status endpoint for polling', () => {
  const route = readDramasRouteSources(root)

  assert.match(route, /\/assets-status/)
  // 只选图片相关字段，避免拉全量资产
  assert.match(route, /imageUrl: schema\.characters\.imageUrl/)
})

test('tasks list pushes filters to SQL and paginates without params heavy field', () => {
  const route = readTasksRouteSources(new URL('..', import.meta.url))

  // 分页 + 上限保护
  assert.match(route, /page_size/)
  assert.match(route, /Math\.min\(200/)
  // status 多值过滤（逗号分隔 → inArray）
  assert.match(route, /inArray\(schema\.sysTask\.status/)
  // 响应 { items, pagination }
  assert.match(route, /items: \[\], pagination:/)
  assert.match(route, /total_pages/)
  // 裁列：不再 select params 大文本（保留 prompt 展示）
  assert.match(route, /prompt: schema\.sysTask\.prompt/)
  assert.doesNotMatch(route, /params: schema\.sysTask\.params/)
})
