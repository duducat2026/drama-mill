// 分镜视频模型记录 — 结构测试（源码断言，沿用现有约定）
// 视频任务完成回写 video_url 时同步落实际使用的模型到 storyboards.video_model，免去联表 sys_task
import { readMigrationsSources } from './helpers/migrations-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readSchemaSources } from './helpers/schema-sources.mjs'
import { readMysqlSchemaSources } from './helpers/mysql-schema-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('storyboards：video_model 列建表（DDL）与 drizzle schema 一致', () => {
  // DDL：列紧跟 video_url 之后，VARCHAR(64) 可容纳全部视频模型名
  const ddl = readMysqlSchemaSources(root)
  const sbTable = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS storyboards'))
  assert.match(sbTable, /video_url TEXT,\s*\n\s*video_model VARCHAR\(64\),/)
  // drizzle schema 同步（videoModel 映射到 video_model）
  const schema = readSchemaSources(root)
  assert.match(schema, /videoModel: varchar\('video_model', \{ length: 64 \}\)/)
})

test('migrations：存量库幂等补 video_model 列', () => {
  const src = readMigrationsSources(root)
  assert.match(src, /ensureColumn\(pool, 'storyboards', 'video_model', 'video_model VARCHAR\(64\)'\)/)
})

test('generation：视频完成回写 video_url 时同步落实际模型（含分流结果）', () => {
  const src = readGenerationSources(root)
  // record.model 为多模型分流切换后同步更新过的实际提交模型
  assert.match(src, /\.set\(\{ videoUrl: localPath, videoModel: record\.model \|\| undefined, duration: duration \|\| undefined, updatedAt: now\(\) \}\)/)
})

test('docker init.sql：导出脚本产物包含 video_model 列', () => {
  const sql = read('../docker/init.sql')
  assert.match(sql, /video_model VARCHAR\(64\)/)
})
