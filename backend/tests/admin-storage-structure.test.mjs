import { readAdminSources } from './helpers/admin-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

// 路由层：仅负责接线与有界 DB 富化（用户名/配额），文件系统统计下沉到服务
test('admin storage-stats route delegates to storage-stats service', () => {
  const route = readAdminSources(new URL('..', import.meta.url))

  assert.match(route, /app\.get\('\/storage-stats'/)
  assert.match(route, /from '\.+(?:\/\.\.)?\/services\/storage-stats\.js'/)
  assert.match(route, /getStorageStats\(/)
  // 用户名富化（昵称优先）+ 响应携带 users 字段
  assert.match(route, /userNames/)
  assert.match(route, /nickname/)
  assert.match(route, /^\s+users,/m)
})

// 服务层：磁盘探测 + 分类目录收口解析
test('storage-stats service probes disk and category dirs', () => {
  const svc = read('src/services/storage-stats.ts')

  // df -kP POSIX 格式解析磁盘用量
  assert.match(svc, /'-kP'/)
  assert.match(svc, /used_percent/)
  // 分类目录经 storage 工具收口解析（兼容 ASSET_PATH/VIDEO_PATH 外挂卷）
  assert.match(svc, /categoryDir\(/)
  assert.match(svc, /getStorageRoot\(\)/)
})

// 服务层：单趟遍历计算全部分类/用户/最大文件指标 + 60s 缓存去重
test('storage-stats service uses single traversal and 60s cache', () => {
  const svc = read('src/services/storage-stats.ts')

  assert.match(svc, /storage_total_bytes/)
  assert.match(svc, /top_files/)
  // 单趟遍历目录树（每分类一次），不再依赖 du 子进程多次遍历
  assert.match(svc, /walkCategory/)
  assert.ok(!/['"]-sk['"]/.test(svc), '不再使用 du -sk 多趟遍历')
  // 一级数字目录即 user_id，非数字（历史遗留/_orphan）不计入用户空间
  assert.match(svc, /\/\^\\d\+\$\/\.test\(e\.name\)/)
  // 每用户按分类聚合字节/文件数
  assert.match(svc, /per_category/)
  assert.match(svc, /total_bytes/)
  // 最大文件仅从视频/成片目录收集
  assert.match(svc, /TOP_FILES_CATEGORIES/)
  // 进程内 60s 缓存 + 并发去重
  assert.match(svc, /CACHE_TTL_MS = 60_000/)
  assert.match(svc, /inFlight/)
})
