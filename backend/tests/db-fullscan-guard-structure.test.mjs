// 全表扫描治理 — 结构测试（源码断言，沿用现有约定）
// 热路径查询必须按 inArray/条件定点下推，sys_task 等只增表禁止无条件全表加载
import { readMigrationsSources } from './helpers/migrations-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readProductionSources } from './helpers/production-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('production：编排轮询按任务 id 定点查，不再全表扫 sys_task', () => {
  const src = readProductionSources(root)
  // 资产图/视频轮询均按本批 taskIds 定点查询（仅取 id/status 投影）
  assert.match(src, /inArray\(schema\.sysTask\.id, taskIds\)/)
  assert.match(src, /db\.select\(\{ id: schema\.sysTask\.id, status: schema\.sysTask\.status \}\)/)
  // 失败原因只查本批任务的失败记录
  assert.match(src, /and\(inArray\(schema\.sysTask\.id, taskIds\), eq\(schema\.sysTask\.status, 'failed'\)\)/)
  // 不允许出现无投影无条件的 sys_task 全表查询
  assert.doesNotMatch(src, /db\.select\(\)\.from\(schema\.sysTask\)/)
})

test('production：getEpisodeAssets 按关联 id 用 inArray 定点查资产', () => {
  const src = readProductionSources(root)
  assert.match(src, /inArray\(schema\.characters\.id, charIds\)/)
  assert.match(src, /inArray\(schema\.scenes\.id, sceneIds\)/)
  assert.match(src, /inArray\(schema\.props\.id, propIds\)/)
  // 不允许全表加载三张资产表后内存过滤
  assert.doesNotMatch(src, /from\(schema\.characters\)\)\s*\n\s*\.filter/)
  assert.doesNotMatch(src, /from\(schema\.scenes\)\)\s*\n\s*\.filter/)
  assert.doesNotMatch(src, /from\(schema\.props\)\)\s*\n\s*\.filter/)
})

test('episode-videos：批量提交按本集分镜 inArray 收敛关联与资产查询', () => {
  const src = read('src/services/episode-videos.ts')
  assert.match(src, /inArray\(schema\.storyboardCharacters\.storyboardId, pendingIds\)/)
  assert.match(src, /inArray\(schema\.storyboardProps\.storyboardId, pendingIds\)/)
  assert.match(src, /inArray\(schema\.characters\.id, charIds\)/)
  assert.match(src, /inArray\(schema\.scenes\.id, sceneIds\)/)
  assert.match(src, /inArray\(schema\.props\.id, propIds\)/)
  // 不允许无 where 的全表关联表加载（行尾即语句结束 = 无链式 where）
  assert.doesNotMatch(src, /db\.select\(\)\.from\(schema\.storyboardCharacters\)\s*$/m)
  assert.doesNotMatch(src, /db\.select\(\)\.from\(schema\.storyboardProps\)\s*$/m)
})

test('generation：看门狗查询的时间窗口/重试额度下推 SQL', () => {
  const src = readGenerationSources(root)
  // findStuckVideoTasks：卡死窗口下推（updated_at 空串回退 created_at 语义保留）
  assert.match(src, /COALESCE\(NULLIF\(\$\{schema\.sysTask\.updatedAt\}, ''\), \$\{schema\.sysTask\.createdAt\}\)/)
  // getFailedTasksForAutoRetry：窗口 + 重试额度 + 排序限量全部下推（额度为运行时动态值，仍作为 SQL 条件下推）
  assert.match(src, /gte\(schema\.sysTask\.updatedAt, lower\)/)
  assert.match(src, /lte\(schema\.sysTask\.updatedAt, upper\)/)
  assert.match(src, /const maxRetry = await getAutoRetryMax\(\)/)
  assert.match(src, /lt\(schema\.sysTask\.retryCount, maxRetry\)/)
  assert.match(src, /\.orderBy\(desc\(schema\.sysTask\.updatedAt\)\)/)
  assert.match(src, /\.limit\(maxCount\)/)
})

test('migrations：大表与只增表补齐索引（幂等）', () => {
  const src = readMigrationsSources(root)
  // sys_task：状态/类型状态/项目/时间窗口/资产维度
  assert.match(src, /idx_sys_task_status/)
  assert.match(src, /idx_sys_task_type_status/)
  assert.match(src, /idx_sys_task_drama_id/)
  assert.match(src, /idx_sys_task_updated_at/)
  assert.match(src, /idx_sys_task_character_id/)
  assert.match(src, /idx_sys_task_scene_id/)
  assert.match(src, /idx_sys_task_prop_id/)
  // 集-资产关联表按 episode_id 查询依赖索引
  assert.match(src, /idx_episode_characters_episode_id/)
  assert.match(src, /idx_episode_scenes_episode_id/)
  assert.match(src, /idx_episode_props_episode_id/)
  // 只增明细表：成本聚合与审计分页
  assert.match(src, /idx_usage_records_drama_id/)
  assert.match(src, /idx_usage_records_created_at/)
  assert.match(src, /idx_audit_logs_created_at/)
})
