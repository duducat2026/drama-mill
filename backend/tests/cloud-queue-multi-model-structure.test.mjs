// 云端队列多池聚合查询（多模型分流后在途口径修正）— 结构测试（源码断言，沿用现有约定）
// 背景：百炼每模型限流池相互独立（各 5 并发），多模型分流后真实负载摊到多个池；
// 旧口径只查 models[0] 单池，页面永远显示「在途 5」，严重低估总量 → 改为聚合全部配置模型
import { readCloudTasksSources } from './helpers/cloud-tasks-sources.mjs'
import { readTasksRouteSources } from './helpers/tasks-route-sources.mjs'
import { readAdminSources } from './helpers/admin-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('cloud-tasks：resolveCloudQueryTarget 返回全部配置模型（models 数组）', () => {
  const svc = readCloudTasksSources(root)
  // 类型与返回值携带 models
  assert.match(svc, /model: string; models: string\[\]/)
  assert.match(svc, /return \{ cfg, model, models \}/)
  // JSON 数组配置：全部模型入列（不再只取首项），首项为主模型
  assert.match(svc, /for \(const m of arr\) models\.push\(m\.trim\(\)\)/)
  assert.match(svc, /model = models\[0\] \|\| ''/)
  // 显式指定模型时只查单池；动态推导回退也入列
  assert.match(svc, /models\.push\(model\)/)
})

test('cloud-tasks：fetchCloudVideoTasksMulti 多池聚合（逐池明细 + 全池失败才整体报错）', () => {
  const svc = readCloudTasksSources(root)
  assert.match(svc, /export async function fetchCloudVideoTasksMulti\(apiKey: string, models: string\[\]\)/)
  assert.match(svc, /models\.map\(m => fetchCloudVideoTasks\(apiKey, m\)\)/)
  // 逐池计数明细（前端模型池明细表）
  assert.match(svc, /byModel\.push\(\{ model: models\[i\], pending_total: r\.pending\.total, running_total: r\.running\.total, error: err \}\)/)
  // 总量为跨池合计
  assert.match(svc, /pendingTotal \+= r\.pending\.total/)
  assert.match(svc, /runningTotal \+= r\.running\.total/)
  // 部分池失败不整体报错：全部失败才视为查询失败，其余池数据照常展示
  assert.match(svc, /errors\.length === models\.length/)
  assert.match(svc, /allFailed \? errors\.join/)
})

test('用户侧/管理侧 cloud-queue 路由均改用多池聚合，响应携带 models 与 by_model', () => {
  for (const src of [readTasksRouteSources(new URL('..', import.meta.url)), readAdminSources(new URL('..', import.meta.url))]) {
    assert.match(src, /fetchCloudVideoTasksMulti/)
    assert.match(src, /const cloud = await fetchCloudVideoTasksMulti\(cfg\.apiKey, models\)/)
    // 响应新增字段：查询口径模型清单 + 逐池明细
    assert.match(src, /by_model: cloud\.byModel/)
    assert.match(src, /models,\n/)
    // 不得残留单池查询调用
    assert.doesNotMatch(src, /fetchCloudVideoTasks\(cfg\.apiKey/)
  }
})
