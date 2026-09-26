import { readMigrationsSources } from './helpers/migrations-sources.mjs'
import { readAdminSources } from './helpers/admin-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSchemaSources } from './helpers/schema-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('storage-quota service: global default, per-user override, cached usage', () => {
  const svc = read('src/services/storage-quota.ts')

  // 全局默认配额：STORAGE_QUOTA_GB 环境变量，未配置/非法回退 1GB
  assert.match(svc, /STORAGE_QUOTA_GB/)
  assert.match(svc, /gb > 0 \? gb : 1/)
  // 生效配额：按用户覆盖值优先，非正值回退全局默认
  assert.match(svc, /storageQuotaBytes != null && storageQuotaBytes > 0/)
  // 用量探测：四分类 du 合计 + 60 秒 TTL 缓存（多入口共享）
  assert.match(svc, /'images', 'videos', 'merged', 'uploads'/)
  assert.match(svc, /60_000/)
  assert.match(svc, /usageCache/)
  // 超额用户清单：过滤 用量 > 生效配额，按用量降序
  assert.match(svc, /r\.used_bytes > r\.quota_bytes/)
  assert.match(svc, /b\.used_bytes - a\.used_bytes/)
})

test('users schema and migration carry storage_quota_bytes column', () => {
  const schema = readSchemaSources(root)
  const mig = readMigrationsSources(root)

  assert.match(schema, /storageQuotaBytes: bigint\('storage_quota_bytes'/)
  assert.match(mig, /'users', 'storage_quota_bytes'/)
})

test('auth route exposes per-user quota status endpoint', () => {
  const route = read('src/routes/auth.ts')

  assert.match(route, /app\.get\('\/storage-quota'/)
  assert.match(route, /getUserQuotaStatus/)
})

test('admin routes carry quota config, exceeded flags and over-quota alert', () => {
  const route = readAdminSources(new URL('..', import.meta.url))

  // 用户列表带用量/生效配额/超额标记
  assert.match(route, /storage_usage_bytes: await getUserUsageBytes/)
  assert.match(route, /storage_quota_bytes: quotaOf/)
  assert.match(route, /r\.storage_exceeded = r\.storage_usage_bytes > r\.storage_quota_bytes/)
  // 按用户覆盖配额：0/空串/非法恢复全局默认（存 NULL）
  assert.match(route, /body\.storage_quota_gb !== undefined/)
  assert.match(route, /Math\.round\(gb \* 1024 \*\* 3\)/)
  // 存储监控用户表带配额/超额，响应带全局默认配额
  assert.match(route, /quota_bytes: u\.user_id === 0 \? null : quota/)
  assert.match(route, /default_quota_bytes: quotaOf\(null\)/)
  // 运行监控带超额用户告警
  assert.match(route, /over_quota_users: await getOverQuotaUsers\(\)/)
})
