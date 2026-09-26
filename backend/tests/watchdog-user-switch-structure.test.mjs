// 后台看门狗用户侧开关 — 结构测试（源码断言，沿用现有约定）
// 两项巡检都会后台替用户发起付费调用，故默认不启动，且必须在「提交」这一步判定
import { readMigrationsSources } from './helpers/migrations-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readSchemaSources } from './helpers/schema-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('users schema/migrations: 两个看门狗授权列默认 0（不启动）', () => {
  const schema = readSchemaSources(root)
  const mig = readMigrationsSources(root)

  assert.match(schema, /retryWatchdogEnabled: boolean\('retry_watchdog_enabled'\)\.default\(false\)/)
  assert.match(schema, /assetWatchdogEnabled: boolean\('asset_watchdog_enabled'\)\.default\(false\)/)
  assert.match(mig, /'users', 'retry_watchdog_enabled'/)
  assert.match(mig, /retry_watchdog_enabled TINYINT\(1\) NOT NULL DEFAULT 0/)
  assert.match(mig, /'users', 'asset_watchdog_enabled'/)
  assert.match(mig, /asset_watchdog_enabled TINYINT\(1\) NOT NULL DEFAULT 0/)
})

test('watchdog-switch service: 按 kind 定点读写，缺省与 NULL 均按不启动', () => {
  const svc = read('src/services/watchdog-switch.ts')

  assert.match(svc, /export type WatchdogKind = 'retry' \| 'asset'/)
  // 展示文案集中在服务侧，前后端不各写一份
  assert.match(svc, /export const WATCHDOG_META/)
  // 无归属（userId 缺省）按未授权：与「默认不启动」一致
  assert.match(svc, /if \(!userId\) return false/)
  // 单用户按主键定点查，不做全表扫描
  assert.match(svc, /db\.select\(\{ enabled: columnOf\(kind\) \}\)\.from\(schema\.users\)/)
  assert.match(svc, /\.where\(eq\(schema\.users\.id, userId\)\)/)
  // 总闸：按开关列定点取 1 行判断有无授权用户，无人授权时不做任何巡检取数
  assert.match(svc, /export async function anyWatchdogEnabled/)
  assert.match(svc, /\.where\(eq\(columnOf\(kind\), true\)\)/)
  assert.match(svc, /\.limit\(1\)/)
  // 写入后回读全部状态，供前端一次性校准两个开关
  assert.match(svc, /export async function setWatchdogSwitch\(userId: number, kind: WatchdogKind, enabled: boolean\)/)
  assert.match(svc, /return getWatchdogSwitches\(userId\)/)
  // 入参 kind 白名单（路由据此拒绝非法值）
  assert.match(svc, /export function isWatchdogKind\(kind: unknown\)/)
})

test('auth 路由暴露看门狗开关读写', () => {
  const route = read('src/routes/auth.ts')
  assert.match(route, /import \{ getWatchdogSwitches, isWatchdogKind, setWatchdogSwitch/)
  assert.match(route, /app\.get\('\/watchdogs'/)
  assert.match(route, /app\.put\('\/watchdogs'/)
  assert.match(route, /success\(c, await getWatchdogSwitches\(user\.id\)\)/)
  // kind 与 enabled 都严格校验，避免字符串 "false" 被当成开启
  assert.match(route, /if \(!isWatchdogKind\(kind\)\) return badRequest\(c, 'kind 必须为 retry 或 asset'\)/)
  assert.match(route, /typeof body\?\.enabled !== 'boolean'/)
})

test('失败任务自动重提看门狗：先总闸再逐用户判定，卡死判定不受开关影响', () => {
  const wd = read('src/services/task-recovery-watchdog.ts')

  const auto = wd.slice(wd.indexOf('async function autoRetryFailedTasksOnce'), wd.indexOf('/** 单轮巡检'))
  // 无人授权时整轮不取数（默认关闭，避免后台静默扫描 + 重提）
  assert.match(auto, /if \(!await anyWatchdogEnabled\('retry'\)\) return 0/)
  assert.match(auto, /if \(!await isWatchdogEnabled\('retry', t\.userId\)\) continue/)
  // 模型调用总开关仍是更强的闸门，二者为「与」关系
  assert.ok(auto.indexOf("isWatchdogEnabled('retry', t.userId)") < auto.indexOf('isAiCallEnabled(t.userId)'))
  // 跳过而非重提/判失败：不消耗重试额度、不写失败原因
  assert.match(auto, /await retryTask\(t\.id, \{ auto: true \}\)/)
  // 卡死判定属不碰模型的清理，保持在开关之外
  const stuck = wd.slice(wd.indexOf('async function failStuckVideoTasksOnce'), wd.indexOf('async function autoRetryFailedTasksOnce'))
  assert.doesNotMatch(stuck, /WatchdogEnabled/)
})

test('资产缺图补生成看门狗：整轮总闸 + 按项目归属人判定', () => {
  const wd = read('src/services/asset-watchdog.ts')
  assert.match(wd, /if \(!await anyWatchdogEnabled\('asset'\)\) return 0/)
  assert.match(wd, /if \(!await isWatchdogEnabled\('asset', drama\.userId\)\) continue/)
  // 与总开关同时生效：先判看门狗授权，再判模型调用总开关
  assert.ok(wd.indexOf("isWatchdogEnabled('asset', drama.userId)") < wd.indexOf('isAiCallEnabled(drama.userId)'))
})

test('授权条件下推取数：每轮限量只花在已授权用户的任务/项目上', () => {
  const svc = read('src/services/watchdog-switch.ts')
  const gen = readGenerationSources(root)
  const wd = read('src/services/asset-watchdog.ts')

  // EXISTS 子查询而非 join：避免与 sys_task/dramas 的同名列冲突打乱记录类型；归属人 NULL 天然不成立
  assert.match(svc, /export function watchdogConsentSql\(kind: WatchdogKind, ownerColumn: SQL \| Column\): SQL/)
  assert.match(svc, /EXISTS \(SELECT 1 FROM \$\{schema\.users\} WHERE \$\{schema\.users\.id\} = \$\{ownerColumn\} AND \$\{columnOf\(kind\)\} = 1\)/)
  assert.doesNotMatch(svc, /innerJoin|leftJoin/)

  // 重提候选：授权条件必须落在 WHERE 内（.limit 之前），否则未授权失败会占满每轮 20 条名额
  const autoRetry = gen.slice(gen.indexOf('export async function getFailedTasksForAutoRetry'), gen.indexOf('return rows.filter'))
  assert.match(autoRetry, /watchdogConsentSql\('retry', schema\.sysTask\.userId\)/)
  assert.ok(autoRetry.indexOf("watchdogConsentSql('retry'") < autoRetry.indexOf('.limit(maxCount)'), '授权条件必须先于 SQL 限量')
  // 补图候选同样下推，未授权项目不进入扫描范围
  assert.match(wd, /and\(isNull\(schema\.dramas\.deletedAt\), watchdogConsentSql\('asset', schema\.dramas\.userId\)\)/)

  // 循环内的逐条判定保留为纵深防御（取数已收紧，这里防后续有人放宽候选条件）
  assert.match(gen, /import \{ watchdogConsentSql \} from '\.\/watchdog-switch\.js'/)
  const recovery = read('src/services/task-recovery-watchdog.ts')
  assert.match(recovery, /二次确认归属人已授权/)
  assert.match(wd, /二次确认项目归属人已授权/)
})
