import { readAdminSources } from './helpers/admin-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readSchemaSources } from './helpers/schema-sources.mjs'
import { readMysqlSchemaSources } from './helpers/mysql-schema-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('runtime-config persists auto retry max in sys_config with hard cap 9', () => {
  const svc = read('src/services/runtime-config.ts')

  // 硬上限 9 + 放弃标记 99
  assert.match(svc, /AUTO_RETRY_HARD_MAX = 9/)
  assert.match(svc, /ABANDONED_RETRY_COUNT = 99/)
  // 读取：运行时配置优先，回退环境变量；统一夹到 0~9
  assert.match(svc, /stored \?\? GEN_TASK_AUTO_RETRY_MAX/)
  assert.match(svc, /Math\.min\(AUTO_RETRY_HARD_MAX/)
  // 写入：upsert 持久化
  assert.match(svc, /onDuplicateKeyUpdate/)
  // 放弃识别
  assert.match(svc, /retryCount \|\| 0\) >= ABANDONED_RETRY_COUNT/)
})

test('sys_config table defined in schema, DDL and init.sql', () => {
  assert.match(readSchemaSources(root), /mysqlTable\('sys_config'/)
  assert.match(readMysqlSchemaSources(root), /CREATE TABLE IF NOT EXISTS sys_config/)
  assert.match(read('../docker/init.sql'), /CREATE TABLE IF NOT EXISTS sys_config/)
})

test('auto retry uses dynamic cap and abandoned tasks cannot be retried', () => {
  const gen = readGenerationSources(root)

  // 自动重提上限动态读取（管理后台运行时配置优先）
  assert.match(gen, /const maxRetry = await getAutoRetryMax\(\)/)
  assert.match(gen, /lt\(schema\.sysTask\.retryCount, maxRetry\)/)
  // 放弃任务禁止手动重试（需先复活）
  assert.match(gen, /isAbandonedTask\(record\.retryCount\)\) throw new Error\('任务已被放弃/)
})

test('watchdogs respect abandonment and dynamic config', () => {
  const recovery = read('src/services/task-recovery-watchdog.ts')
  assert.match(recovery, /人工放弃的任务（retry_count=99）永不重提/)

  // 资产补跑看门狗跳过已放弃资产：防止无法处理的资产被反复创建新任务
  const asset = read('src/services/asset-watchdog.ts')
  assert.match(asset, /isAbandonedTask\(t\.retryCount\)/)
})

test('admin exposes retry config and abandon/restore endpoints', () => {
  const route = readAdminSources(new URL('..', import.meta.url))

  assert.match(route, /app\.get\('\/task-retry-config'/)
  assert.match(route, /app\.put\('\/task-retry-config'/)
  assert.match(route, /hard_max: AUTO_RETRY_HARD_MAX/)
  assert.match(route, /setAutoRetryMax\(body\.auto_retry_max\)/)

  // 放弃/复活
  assert.match(route, /app\.post\('\/videos\/:id\/abandon'/)
  assert.match(route, /app\.post\('\/videos\/:id\/restore'/)
  assert.match(route, /retryCount: ABANDONED_RETRY_COUNT/)
  // 复活清除放弃标记并还原错误信息
  assert.match(route, /\^\\\[已放弃\\\]\\s\*/)

  // 一键重提排除已放弃任务
  assert.match(route, /rows = rows\.filter\(t => !isAbandonedTask\(t\.retryCount\)\)/)
})
