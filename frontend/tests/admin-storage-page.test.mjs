import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readUseApiSources } from './helpers/use-api-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('admin nav exposes storage monitor entry', () => {
  const layout = read('app/layouts/admin.vue')

  assert.match(layout, /path: '\/admin\/storage'/)
  assert.match(layout, /label: '存储监控'/)
  assert.match(layout, /HardDrive/)
})

test('storage monitor page renders disk and asset/video size sections', () => {
  const page = read('app/pages/admin/storage.vue')

  assert.match(page, /layout: 'admin'/)
  assert.match(page, /adminAPI\.storageStats/)
  // 磁盘空间区
  assert.match(page, /disk\?\.used_percent/)
  assert.match(page, /disk\?\.free_bytes/)
  // 分类目录占用区 + 最大文件区
  assert.match(page, /storage_total_bytes/)
  assert.match(page, /top_files/)
  // 字节格式化（B/KB/MB/GB/TB）
  assert.match(page, /'KB', 'MB', 'GB', 'TB'/)
})

test('storage monitor page renders per-user space table with quota', () => {
  const page = read('app/pages/admin/storage.vue')

  assert.match(page, /用户空间占用/)
  assert.match(page, /v-for="u in \(data\?\.users \|\| \[\]\)"/)
  // 四分类拆分列 + 合计（占比改由配额占用列展示）
  assert.match(page, /userCatBytes\(u, 'images'\)/)
  assert.match(page, /userCatBytes\(u, 'videos'\)/)
  assert.match(page, /userCatBytes\(u, 'merged'\)/)
  assert.match(page, /userCatBytes\(u, 'uploads'\)/)
  assert.match(page, /u\.total_bytes/)
  // per_category 后端契约是 {分类: 字节} 对象映射：必须按键取值，不得按数组 .find()（否则渲染抛错致整页白屏）
  assert.match(page, /return pc\[key\] \|\| 0/)
  assert.ok(!/per_category \|\| \[\]\)\.find/.test(page), 'userCatBytes 不得直接把 per_category 当数组处理')
})

test('storage monitor page shows per-user quota and exceeded alert', () => {
  const page = read('app/pages/admin/storage.vue')

  // 全局默认配额展示 + 配额列 + 配额占用进度条（超额变红）
  assert.match(page, /default_quota_bytes/)
  assert.match(page, /u\.quota_bytes/)
  assert.match(page, /userQuotaPercent\(u\)/)
  assert.match(page, /u\.exceeded \? 'storage-bar-red' : 'storage-bar-blue'/)
  assert.match(page, /· 超额/)
})

test('user management page shows usage/quota column and quota editor', () => {
  const page = read('app/pages/admin/users.vue')

  // 存储用量列：用量/配额 + 超额红字 + 配额来源标记
  assert.match(page, /storage_usage_bytes/)
  assert.match(page, /storage_quota_bytes/)
  assert.match(page, /storage_exceeded/)
  assert.match(page, /storage_quota_custom/)
  // 配额配置：storage_quota_gb 提交（留空/0 恢复全局默认）
  assert.match(page, /setQuota\(u\)/)
  assert.match(page, /storage_quota_gb: input\.trim\(\)/)
})

test('run monitor page shows over-quota user alert banner', () => {
  const page = read('app/pages/admin/monitor.vue')

  assert.match(page, /data\?\.over_quota_users\?\.length/)
  assert.match(page, /存储配额超额告警/)
  assert.match(page, /monitor-quota-alert-item/)
  assert.match(page, /quotaPercent\(u\)/)
})

test('user home page shows over-quota alert banner', () => {
  const page = read('app/pages/index.vue')

  // 超额才展示：quota?.exceeded 守卫 + 用量/配额/百分比文案 + 静默失败不阻断首页
  assert.match(page, /v-if="quota\?\.exceeded"/)
  assert.match(page, /存储空间已超额/)
  assert.match(page, /quotaAPI\.status\(\)/)
  assert.match(page, /\.catch\(\(\) => \{\}\)/)
  const api = readUseApiSources(root)
  assert.match(api, /quotaAPI/)
  assert.match(api, /\/auth\/storage-quota/)
})

test('useApi exposes adminAPI.storageStats', () => {
  const api = readUseApiSources(root)

  assert.match(api, /storageStats: \(\) => api\.get\('\/admin\/storage-stats'\)/)
})
