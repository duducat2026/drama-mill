/*
 * 管理端大表深翻页治理 — 结构测试
 * 覆盖：audit/videos/storyboards/merges/novels/costs/dramas 七列表的 COUNT 缓存化、深页上限守卫、
 *       排序对齐复合索引（DDL + 存量迁移 1.97/1.98）、分镜 keyword 剔除大字段 LIKE、
 *       视频运维动作与用户列表的全表载入禁令（下推 SQL）。
 * EXPLAIN 实测（本地库 2026-09-20）：新索引下三条深翻页 SQL 均 Backward index scan，
 *   改造前全部 Using filesort（千万级致命）。
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAdminSources } from './helpers/admin-sources.mjs'

const root = new URL('..', import.meta.url)
const read = p => readFileSync(new URL(p, root), 'utf8')

test('七列表 total 走 cachedTotal（60s 缓存 + in-flight 去重），不再每请求裸 COUNT', () => {
  const src = readAdminSources(root)
  assert.match(src, /export async function cachedTotal/)
  assert.match(src, /const COUNT_TTL_MS = 60_000/)
  for (const base of ['admin:audit', 'admin:videos', 'admin:storyboards', 'admin:merges', 'admin:novels', 'admin:costs', 'admin:dramas']) {
    assert.match(src, new RegExp(`cachedTotal\\(countKey\\('${base}'`))
  }
  // 每文件恰好一处 COUNT（在 loader 闭包内），无遗留的裸 Promise.all count
  // videos 例外：一键重提/历史补跑各带一处结果计数 count()，共三处
  for (const [f, n] of [['audit', 1], ['storyboards', 1], ['merges', 1], ['novels', 1], ['costs', 1], ['videos', 3]]) {
    const srcRoute = read(`src/routes/admin/${f}.ts`)
    assert.equal((srcRoute.match(/count\(\)/g) || []).length, n, `${f}.ts count() 次数应为 ${n}`)
  }
})

test('七列表深页封顶：offset 超限直接 400 提示过滤', () => {
  const src = readAdminSources(root)
  assert.match(src, /export const MAX_PAGED_OFFSET = 50_000/)
  assert.match(src, /export function tooDeep\(page: number, pageSize: number\)/)
  for (const f of ['audit', 'videos', 'storyboards', 'merges', 'novels', 'costs', 'dramas']) {
    assert.match(read(`src/routes/admin/${f}.ts`), /if \(tooDeep\(page, pageSize\)\) return badRequest/, `${f}.ts 缺深页封顶守卫`)
  }
})

test('视频运维动作（一键重提/历史补跑）下推 SQL，禁止全表 sys_task 载入内存', () => {
  const src = read('src/routes/admin/videos.ts')
  assert.doesNotMatch(src, /let rows = await db\.select\(\)\.from\(schema\.sysTask\)/, '禁止无 WHERE 全表载入 sys_task')
  assert.match(src, /const BULK_RETRY_SCAN_LIMIT = BULK_RETRY_CAP \* 5/)
  assert.match(src, /orderBy\(desc\(schema\.sysTask\.updatedAt\)\)\.limit\(BULK_RETRY_SCAN_LIMIT\)/)
  assert.match(src, /isNotNull\(schema\.sysTask\.taskId\)/)
  assert.match(src, /orderBy\(desc\(schema\.sysTask\.updatedAt\)\)\.limit\(HISTORICAL_RESCUE_CAP\)/)
  // 原有语义锁：重提上限与放弃过滤仍在
  assert.match(src, /rows\.slice\(0, BULK_RETRY_CAP\)/)
  assert.match(src, /isAbandonedTask\(t\.retryCount\)/)
})

test('用户列表分页下推 SQL：先分页后算存储用量，不再全表用户逐个磁盘遍历', () => {
  const src = read('src/routes/admin/users.ts')
  assert.match(src, /\.limit\(pageSize\)\.offset\(\(page - 1\) \* pageSize\)/)
  assert.match(src, /db\.select\(\)\.from\(schema\.users\)\.where\(where\)/)
  assert.doesNotMatch(src, /paged\(withUsage/, '用量必须只算当页，禁止全表算完再切片')
  assert.doesNotMatch(src, /let rows = await db\.select\(\)\.from\(schema\.users\)\s*\n\s*if \(keyword\) rows = rows\.filter/)
})

test('拼接成片列表不选取 scenes 大字段（TEXT 分镜 JSON 只入库不进列表响应）', () => {
  const src = read('src/routes/admin/merges.ts')
  assert.match(src, /const cols = \{[\s\S]*?createdAt: VM\.createdAt, completedAt: VM\.completedAt,\s*\}/)
  assert.doesNotMatch(src, /scenes: VM\.scenes/, 'cols 不得选取 scenes')
  assert.doesNotMatch(src, /db\.select\(\)\.from\(VM\)/, '行查询必须指定列，禁止全列 SELECT')
})

test('分镜 keyword 检索剔除 videoPrompt 大字段 LIKE（TEXT 全扫禁止回退）', () => {
  const src = read('src/routes/admin/storyboards.ts')
  assert.doesNotMatch(src, /like\(S\.videoPrompt/, 'keyword 不得再对 videoPrompt 做 LIKE 全扫')
  assert.match(src, /or\(like\(D\.title, `%\$\{keyword\}%`\), like\(S\.title, `%\$\{keyword\}%`\)\)/)
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
  // video_merges 补时间索引：拼接成片列表按 created_at 排序（此前仅 episode_id/user_id）
  assert.match(platform, /INDEX idx_video_merges_created_id \(created_at, id\)/)
  // init.sql 为 DDL 生成产物，四者必须同步出现
  assert.match(initSql, /idx_sys_task_type_created/)
  assert.match(initSql, /idx_audit_logs_created_id/)
  assert.match(initSql, /idx_storyboards_created_id/)
  assert.match(initSql, /idx_video_merges_created_id/)
})

test('存量库迁移 1.97/1.98：先建复合再删被覆盖的老单列索引', () => {
  const mig = read('src/db/migrations-columns.ts')
  assert.match(mig, /ensureIndex\(pool, 'sys_task', 'idx_sys_task_type_created', 'type, created_at'\)/)
  assert.match(mig, /dropIndex\(pool, 'sys_task', 'idx_sys_task_type'\)/)
  assert.match(mig, /ensureIndex\(pool, 'audit_logs', 'idx_audit_logs_created_id', 'created_at, id'\)/)
  assert.match(mig, /dropIndex\(pool, 'audit_logs', 'idx_audit_logs_created_at'\)/)
  assert.match(mig, /ensureIndex\(pool, 'storyboards', 'idx_storyboards_created_id', 'created_at, id'\)/)
  assert.match(mig, /ensureIndex\(pool, 'video_merges', 'idx_video_merges_created_id', 'created_at, id'\)/)
  // 顺序：ensure 必须在对应 drop 之前（最左前缀接管后才移除旧索引）
  const s = mig.indexOf('idx_sys_task_type_created')
  const d = mig.indexOf("dropIndex(pool, 'sys_task', 'idx_sys_task_type')")
  assert.ok(s < d, '复合索引须先于旧索引删除')
})
