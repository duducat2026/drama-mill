// 视频任务 30 分钟超时判失败 + 失败任务自动恢复 + 控制台一键重提 — 结构测试（源码断言，沿用现有约定）
import { readMigrationsSources } from './helpers/migrations-sources.mjs'
import { readAdminSources } from './helpers/admin-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readSchemaSources } from './helpers/schema-sources.mjs'
import { readMysqlSchemaSources } from './helpers/mysql-schema-sources.mjs'
import { readUseApiSources } from '../../frontend/tests/helpers/use-api-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('rate-config：视频超时阈值与自动恢复配置', () => {
  const src = read('src/utils/rate-config.ts')
  // 视频生成超时默认 30 分钟
  assert.match(src, /VIDEO_TASK_TIMEOUT_MS/)
  assert.match(src, /30 \* 60_000/)
  // 自动恢复：巡检间隔/单任务重提上限/窗口期/冷却期/单轮上限
  assert.match(src, /GEN_TASK_RECOVERY_INTERVAL_MS/)
  assert.match(src, /GEN_TASK_AUTO_RETRY_MAX/)
  assert.match(src, /GEN_TASK_AUTO_RETRY_WINDOW_MS/)
  assert.match(src, /GEN_TASK_AUTO_RETRY_MIN_AGE_MS/)
  assert.match(src, /GEN_TASK_AUTO_RETRY_MAX_PER_SWEEP/)
  // 状态接口可见恢复配置
  assert.match(src, /task_recovery:\s*\{/)
})

test('generation：视频轮询按 30 分钟上限判超时，重试计数随重试方式增减', () => {
  const src = readGenerationSources(root)
  // 视频轮询上限改为 VIDEO_TASK_TIMEOUT_MS（30 分钟），不再是无限 10s×300
  assert.match(src, /video:\s*\{\s*attempts: Math\.ceil\(VIDEO_TASK_TIMEOUT_MS \/ 10_000\)/)
  assert.match(src, /maxDurationMs: VIDEO_TASK_TIMEOUT_MS/)
  assert.doesNotMatch(src, /Polling exceeded 10 minutes/)
  // 重试：自动重提计数 +1，手动重试计数归零
  assert.match(src, /opts\.auto \? \(record\.retryCount \|\| 0\) \+ 1 : 0/)
  assert.match(src, /retryCount, updatedAt/)
  // 完成态守卫：任务已被判失败时旧轮询迟到不再覆盖写回/重复计价
  assert.match(src, /markTaskCompleted/)
  assert.match(src, /eq\(schema\.sysTask\.status, 'processing'\)/)
  assert.match(src, /complete-skipped-stale/)
  // 终态错误（内容审核/凭证无效）不进入自动恢复
  assert.match(src, /isPermanentError/)
  // 巡检取数导出
  assert.match(src, /export async function findStuckVideoTasks/)
  assert.match(src, /export async function getFailedTasksForAutoRetry/)
  assert.match(src, /export async function failTask/)
})

test('task-recovery-watchdog：判卡死 + 自动重提 + 定时四要素', () => {
  const src = read('src/services/task-recovery-watchdog.ts')
  // 卡死判定：超阈值的 processing 视频任务判失败
  assert.match(src, /findStuckVideoTasks/)
  assert.match(src, /failTask/)
  // 自动重提：走统一重试入口并标记 auto（计数递增）
  assert.match(src, /retryTask\(t\.id, \{ auto: true \}\)/)
  // 自动恢复可整体关闭
  assert.match(src, /GEN_TASK_AUTO_RETRY_MAX <= 0/)
  // 定时循环 + 单轮入口
  assert.match(src, /setInterval/)
  assert.match(src, /runTaskRecoveryOnce/)
  assert.match(src, /startTaskRecoveryWatchdog/)
})

test('sys_task：retry_count 列落库（DDL/迁移/drizzle schema/init.sql）', () => {
  assert.match(readSchemaSources(root), /retryCount: int\('retry_count'\)/)
  assert.match(readMysqlSchemaSources(root), /retry_count INT NOT NULL DEFAULT 0/)
  assert.match(readMigrationsSources(root), /ensureColumn\(pool, 'sys_task', 'retry_count'/)
  assert.match(read('../docker/init.sql'), /retry_count INT NOT NULL DEFAULT 0/)
})

test('admin：失败任务一键重提与单任务重提接口', () => {
  const src = readAdminSources(new URL('..', import.meta.url))
  assert.match(src, /app\.post\('\/videos\/retry-failed'/)
  assert.match(src, /app\.post\('\/videos\/:id\/retry'/)
  // 批量重提限量，防一次性灌满生成队列
  assert.match(src, /BULK_RETRY_CAP/)
  assert.match(src, /rows\.slice\(0, BULK_RETRY_CAP\)/)
  assert.match(src, /retryTask/)
  // 历史任务补跑接口：只探测带 task_id 的失败任务（过滤/排序/限量已下推 SQL），小批并发，救回不重提
  assert.match(src, /app\.post\('\/videos\/rescue-historical'/)
  assert.match(src, /HISTORICAL_RESCUE_CAP/)
  assert.match(src, /probeHistoricalTask\(t\.id\)/)
  assert.match(src, /eq\(schema\.sysTask\.status, 'failed'\), isNotNull\(schema\.sysTask\.taskId\)/)
})

test('index：启动时挂上失败自动恢复看门狗', () => {
  const src = read('src/index.ts')
  assert.match(src, /import \{ startTaskRecoveryWatchdog \} from '\.\/services\/task-recovery-watchdog\.js'/)
  assert.match(src, /startTaskRecoveryWatchdog\(\)/)
})

test('前端控制台：一键重提按钮与行内重试', () => {
  const api = readUseApiSources(new URL('../frontend/', root))
  assert.match(api, /retryVideo: \(id: number\) => api\.post\(`\/admin\/videos\/\$\{id\}\/retry`/)
  assert.match(api, /retryFailedVideos: \(\) => api\.post/)
  // 历史任务补跑 API 封装：探测救回不重复计费，与后端接口同步维护
  assert.match(api, /rescueHistoricalVideos/)
  assert.match(api, /\/admin\/videos\/rescue-historical/)

  const page = read('../frontend/app/pages/admin/videos.vue')
  assert.match(page, /一键重提失败任务/)
  assert.match(page, /retryAllFailed/)
  assert.match(page, /retryOne/)
  assert.match(page, /adminAPI\.retryFailedVideos/)
  assert.match(page, /adminAPI\.retryVideo/)
  // 失败原因在状态列可见
  assert.match(page, /video-task-error/)
  // 历史任务补跑按钮入口
  assert.match(page, /补跑历史任务/)
  assert.match(page, /rescueHistorical/)
  assert.match(page, /adminAPI\.rescueHistoricalVideos/)
})

test('deploy：部署脚本对齐北京时区，PM2 进程内置 TZ 兜底', () => {
  const deploy = read('../deployment/deploy.sh')
  assert.match(deploy, /Asia\/Shanghai/)
  assert.match(deploy, /timedatectl/)

  const eco = read('../ecosystem.config.cjs')
  assert.match(eco, /TZ: 'Asia\/Shanghai'/)
})

test('generation：重提前先探测历史任务结果，救回不再重新提交', () => {
  const src = readGenerationSources(root)
  // 探测入口：用落库的上游 task_id 单次查上游结果，探测请求有独立超时上限
  assert.match(src, /export async function probeHistoricalTask/)
  assert.match(src, /HISTORICAL_PROBE_TIMEOUT_MS/)
  assert.match(src, /probe-historical/)
  // 重试入口前置探测：救回/恢复轮询时不再走重新提交链路（避免重复计费）
  assert.match(src, /const probe = await probeHistoricalTask\(id\)/)
  assert.match(src, /probe-rescued/)
  assert.match(src, /probe-resume-poll/)
  // 上游仍在生成：恢复轮询不消耗重试额度（状态翻回带 failed 守卫防并发）
  assert.match(src, /eq\(schema\.sysTask\.status, 'failed'\)/)
  assert.match(src, /pollTaskTracked\(record, config, record\.taskId\)/)
})

test('generation：不同模型独立队列，不混排互相阻塞', () => {
  const src = readGenerationSources(root)
  // 队列按「类型|模型」拆分，旧的全局单一队列已移除
  assert.match(src, /const taskQueues = new Map<string, QueuedSlot\[\]>/)
  assert.match(src, /queueKey = \(type: TaskType, model: string\)/)
  assert.doesNotMatch(src, /const taskQueue: QueuedSlot\[\]/)
  // 排队进本模型队列；入队时携带 model（创建/重启恢复/重试三条链路）
  assert.match(src, /withTaskSlot<T>\(type: TaskType, model: string, provider: string/)
  // 拆分为 generation-queue 后 processTask 经 setTaskProcessor 注入，队列入队处等价调用
  assert.match(src, /withTaskSlot\(type, model, config\.provider, \(\) => taskProcessor!\(id, config\)\)/)
  assert.match(src, /enqueueExecution\(id, config, type, fields\.model \|\| config\.model\)/)
  assert.match(src, /enqueueExecution\(record\.id, config, type, record\.model \|\| config\.model\)/)
  // 派发公平性：取队首等待最久且类型有余量的任务，多模型交替获得槽位
  assert.match(src, /head\.enqueuedAt < best\.slot\.enqueuedAt/)
  // 队列统计对外暴露按模型维度的排队分布，以及按网关（百炼等）聚合的排队长度
  assert.match(src, /by_model/)
  assert.match(src, /by_gateway/)
  assert.match(src, /const byGateway: Record<string, \{ queued: number; models: string\[\] \}>/)
})
