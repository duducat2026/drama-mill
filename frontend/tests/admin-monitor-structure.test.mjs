import { readAdminSources } from '../../backend/tests/helpers/admin-sources.mjs'
import { readUseApiSources } from './helpers/use-api-sources.mjs'
import { readMonitorPageSources } from './helpers/use-monitor-page-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const frontendRoot = new URL('..', import.meta.url)
const backendRoot = new URL('../../backend/', import.meta.url)
const read = (root, path) => readFileSync(new URL(path, root), 'utf8')

test('admin monitor page renders SVG charts for trend/donut/errors', () => {
  const page = readMonitorPageSources(frontendRoot)

  // 数据源与自动刷新（30s 链式排程：请求完成后再排，隐藏页停轮）
  assert.match(page, /adminAPI\.monitorStats\(\)/)
  assert.match(page, /const REFRESH_INTERVAL = 30000/)
  assert.match(page, /async function tick\(\) \{\s*await refresh\(\)\s*schedule\(\)/)
  assert.match(page, /visibilitychange/)
  assert.doesNotMatch(page, /setInterval/)
  assert.match(page, /definePageMeta\(\{ layout: 'admin' \}\)/)

  // 24h 趋势柱状图：三系列（新提交/完成/失败）+ 网格线 + 小时标签
  assert.match(page, /trendChart = computed\(/)
  assert.match(page, /TREND_SERIES = /)
  assert.match(page, /created.*新提交|新提交.*created/s)
  assert.match(page, /niceCeil/)
  assert.match(page, /gridLines/)

  // 状态分布环形图：dasharray 分段 + 图例计数
  assert.match(page, /statusDonut = computed\(/)
  assert.match(page, /stroke-dasharray/)
  assert.match(page, /monitor-donut-legend/)

  // 失败画像横条 + 网关健康表 + 批次状态
  assert.match(page, /monitor-err-row/)
  assert.match(page, /gatewayPressure/)
  assert.match(page, /batchChips\('by_status'\)/)
})

test('admin nav exposes monitor entry and api composable wires monitorStats', () => {
  const layout = read(frontendRoot, 'app/layouts/admin.vue')
  assert.match(layout, /path: '\/admin\/monitor'/)
  assert.match(layout, /Gauge/)

  const api = readUseApiSources(frontendRoot)
  assert.match(api, /monitorStats: \(\) => api\.get\('\/admin\/monitor-stats'\)/)
})

test('backend monitor-stats aggregates in SQL without full table load', () => {
  const admin = readAdminSources(backendRoot)

  assert.match(admin, /app\.get\('\/monitor-stats'/)

  // 按小时聚合（SUBSTRING 前 13 位）+ 24 桶补零
  assert.match(admin, /SUBSTRING\(\$\{col\}, 1, 13\)/)
  assert.match(admin, /length: 24/)

  // 失败原因归类走 MySQL REGEXP CASE，而非全量加载后内存过滤
  assert.match(admin, /MONITOR_ERROR_RULES/)
  assert.match(admin, /REGEXP/)
  assert.match(admin, /GROUP BY 1|groupBy\(sql`1`\)/)

  // 状态分布/批次均为 GROUP BY 聚合
  assert.match(admin, /groupBy\(schema\.sysTask\.status\)/)
  assert.match(admin, /groupBy\(schema\.productionBatches\.status\)/)

  // 系统与队列信息
  assert.match(admin, /process\.memoryUsage\(\)/)
  assert.match(admin, /getTaskQueueStats\(\)/)
})
