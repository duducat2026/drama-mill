import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../scripts/audit-storage-orphans.ts', import.meta.url), 'utf8')

test('历史媒体盘点仅使用独立只读事务，不导入应用启动模块或执行清理', () => {
  assert.match(source, /mysql\.createConnection\(connectionOptions\(\)\)/)
  assert.match(source, /SET SESSION TRANSACTION READ ONLY/)
  assert.match(source, /START TRANSACTION WITH CONSISTENT SNAPSHOT/)
  assert.doesNotMatch(source, /from ['"][^'"]*(?:src\/db|services|routes)/)
  assert.doesNotMatch(source, /\b(?:unlinkSync|rmSync|renameSync|copyFileSync)\s*\(/)
  assert.match(source, /mediaMutated: false, databaseMutated: false/)
  assert.match(source, /REMOTE_DATABASE_REQUIRES_CONFIRMATION/)
})

test('盘点包含历史合成 JSON 及软删除数据，分页、校验值和安全错误输出齐全', () => {
  assert.match(source, /'video_merges'/)
  assert.match(source, /url\|path\|image\|thumbnail\|params\|metadata\|scenes/)
  assert.match(source, /WHERE id > \? ORDER BY id LIMIT \?/)
  assert.doesNotMatch(source, /WHERE[^\n]*deleted_at IS NULL/)
  assert.match(source, /createHash\('sha256'\)/)
  assert.match(source, /errors\.push\(safeError\(err\)\)/)
  assert.match(source, /backupCreated: false, isolationStarted: false/)
})
