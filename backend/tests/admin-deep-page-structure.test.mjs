/*
 * 管理端大表深翻页治理 — 结构测试
 * 覆盖：audit/videos/storyboards 三列表的 COUNT 缓存化、深页上限守卫、
 *       排序对齐复合索引（DDL + 存量迁移）。
 * EXPLAIN 实测（本地库 2026-09-20）：新索引下三条深翻页 SQL 均 Backward index scan，
 *   改造前全部 Using filesort（千万级致命）。
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAdminSources } from './helpers/admin-sources.mjs'

const root = new URL('..', import.meta.url)
const read = p => readFileSync(new URL(p, root), 'utf8')

test('三列表 total 走 cachedTotal（60s 缓存 + in-flight 去重），不再每请求裸 COUNT', () => {
  const src = readAdminSources(root)
  assert.match(src, /export async function cachedTotal/)
  assert.match(src, /const COUNT_TTL_MS = 60_000/)
  for (const base of ['admin:audit', 'admin:videos', 'admin:storyboards']) {
    assert.match(src, new RegExp(`cachedTotal\\(countKey\\('${base}'`))
  }
  // 每文件恰好一处 COUNT（在 loader 闭包内），无遗留的裸 Promise.all count
  for (const f of ['audit', 'videos', 'storyboards']) {
    const srcRoute = read(`src/routes/admin/${f}.ts`)
    assert.equal((srcRoute.match(/count\(\)/g) || []).length, 1, `${f}.ts 应只剩 loader 内一处 count()`)
  }
})

test('三列表深页封顶：offset 超限直接 400 提示过滤', () => {
  const src = readAdminSources(root)
  assert.match(src, /export const MAX_PAGED_OFFSET = 50_000/)
  assert.match(src, /export function tooDeep\(page: number, pageSize: number\)/)
  assert.match(read('src/routes/admin/audit.ts'), /if \(tooDeep\(page, pageSize\)\) return badRequest/)
  assert.match(read('src/routes/admin/videos.ts'), /if \(tooDeep\(page, pageSize\)\) return badRequest/)
  assert.match(read('src/routes/admin/storyboards.ts'), /if \(tooDeep\(page, pageSize\)\) return badRequest/)
})

test('排序对齐复合索引：建表 DDL 与 init.sql 同步', () => {
  const platform = read('src/db/mysql-schema-platform.ts')
  const content = read('src/db/mysql-schema-content.ts')
  const initSql = read('../docker/init.sql')
  // sys_task (type) → (type, created_at)：视频列表 WHERE type + ORDER BY created_at
  assert.match(platform, /INDEX idx_sys_task_type_created \(type, created_at\)/)
  assert.doesNotMatch(platform, /INDEX idx_sys_task_type \(type\)/)
  // audit_logs (created_at) → (created_at, id)：对齐 ORDER BY created_at DESC, id DESC
  assert.match(platform, /INDEX idx_audit_logs_created_id \(created_at, id\)/)
  assert.doesNotMatch(platform, /INDEX idx_audit_logs_created_at \(created_at\)/)
  // storyboards 补时间索引：分镜列表按 created_at 排序
  assert.match(content, /INDEX idx_storyboards_created_id \(created_at, id\)/)
  // init.sql 为 DDL 生成产物，三者必须同步出现
  assert.match(initSql, /idx_sys_task_type_created/)
  assert.match(initSql, /idx_audit_logs_created_id/)
  assert.match(initSql, /idx_storyboards_created_id/)
})

test('存量库迁移 1.97：先建复合再删被覆盖的老单列索引', () => {
  const mig = read('src/db/migrations-columns.ts')
  assert.match(mig, /ensureIndex\(pool, 'sys_task', 'idx_sys_task_type_created', 'type, created_at'\)/)
  assert.match(mig, /dropIndex\(pool, 'sys_task', 'idx_sys_task_type'\)/)
  assert.match(mig, /ensureIndex\(pool, 'audit_logs', 'idx_audit_logs_created_id', 'created_at, id'\)/)
  assert.match(mig, /dropIndex\(pool, 'audit_logs', 'idx_audit_logs_created_at'\)/)
  assert.match(mig, /ensureIndex\(pool, 'storyboards', 'idx_storyboards_created_id', 'created_at, id'\)/)
  // 顺序：ensure 必须在对应 drop 之前（最左前缀接管后才移除旧索引）
  const s = mig.indexOf('idx_sys_task_type_created')
  const d = mig.indexOf("dropIndex(pool, 'sys_task', 'idx_sys_task_type')")
  assert.ok(s < d, '复合索引须先于旧索引删除')
})
