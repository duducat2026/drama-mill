import { readMigrationsSources } from './helpers/migrations-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readSchemaSources } from './helpers/schema-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('ai-switch service: user-level gate with short TTL cache and route guard', () => {
  const svc = read('src/services/ai-switch.ts')

  // 统一文案 + 专用错误类型（status 供全局 errorHandler 透出）
  assert.match(svc, /export const AI_CALL_DISABLED_MESSAGE = '模型调用已关闭/)
  assert.match(svc, /class AiCallDisabledError extends Error/)
  assert.match(svc, /status = 409/)
  // 配置解析在热路径上：进程内短 TTL 缓存，避免每次 AI 调用回查 users 表
  assert.match(svc, /const CACHE_TTL_MS = \d+/)
  assert.match(svc, /cache\.get\(userId\)/)
  // 无归属链路（userId 缺省）与列值 NULL 一律按开启处理，存量行为不变
  assert.match(svc, /if \(!userId\) return true/)
  assert.match(svc, /row\.aiCallEnabled !== false : true/)
  // 拦截日志按用户去重，避免热路径刷屏；重新打开后清除去重标记
  assert.match(svc, /blockedLogged\.has\(userId\)/)
  assert.match(svc, /blockedLogged\.delete\(userId\)/)
  // 写入开关同时刷新缓存，使同进程后续读取立即看到新值
  assert.match(svc, /db\.update\(schema\.users\)/)
  assert.match(svc, /cache\.set\(userId, \{ at: Date\.now\(\), enabled \}\)/)
  // 路由守卫直接读鉴权注入状态，零额外查询
  assert.match(svc, /const user = c\.get\('user'\)/)
  assert.match(svc, /user\.aiCallEnabled === false/)
})

test('users schema and migration carry ai_call_enabled column (default on)', () => {
  const schema = readSchemaSources(root)
  const mig = readMigrationsSources(root)

  assert.match(schema, /aiCallEnabled: boolean\('ai_call_enabled'\)\.default\(true\)/)
  assert.match(mig, /'users', 'ai_call_enabled'/)
  assert.match(mig, /ai_call_enabled TINYINT\(1\) NOT NULL DEFAULT 1/)
})

test('config resolution choke point blocks new calls but not in-flight resume', () => {
  const ai = read('src/services/ai.ts')

  // 文本/图片/视频共用 getActiveConfig 作为唯一入口，开关在此拦截
  const active = ai.slice(ai.indexOf('export async function getActiveConfig'), ai.indexOf('export async function getResumeConfig'))
  assert.match(active, /await assertAiCallEnabled\(userId\)/)
  assert.match(active, /return loadActiveConfig\(serviceType, userId\)/)
  // 在途任务恢复走 getResumeConfig：不过开关，避免误伤已计费任务
  const resume = ai.slice(ai.indexOf('export async function getResumeConfig'), ai.indexOf('async function loadActiveConfig'))
  assert.match(resume, /return loadActiveConfig\(serviceType, userId\)/)
  assert.doesNotMatch(resume, /assertAiCallEnabled/)
  // 按集锁定的配置同样按归属人判定
  assert.match(ai, /await assertAiCallEnabled\(row\.userId\)/)
})

test('generation queue blocks every submit path', () => {
  const gen = readGenerationSources(root)

  // 排队/重排期间被关闭：不提交上游，直接判失败并给出可操作文案
  assert.match(gen, /if \(!await isAiCallEnabled\(record\.userId\)\) \{/)
  assert.match(gen, /await failTask\(id, AI_CALL_DISABLED_MESSAGE\)/)
  // 手动重试即时拒绝
  assert.match(gen, /await assertAiCallEnabled\(record\.userId\)/)
  // 恢复链路用 getResumeConfig（不拦截在途任务），且不替换成 getActiveConfig（拆分后 import 分布在 queue/selfheal 模块）
  assert.match(gen, /import \{ getResumeConfig, parseConfigQpm \} from '\.\/ai\.js'/)
  assert.doesNotMatch(gen, /import \{[^}]*\bgetActiveConfig\b[^}]*\bgetResumeConfig[^}]*\} from '\.\/ai\.js'/)
  assert.match(gen, /const fallback = await getResumeConfig\(record\.type as TaskType, record\.userId \?\? undefined\)/)
})

test('watchdogs soft-skip disabled users instead of writing failures', () => {
  const recovery = read('src/services/task-recovery-watchdog.ts')
  const asset = read('src/services/asset-watchdog.ts')

  // 跳过而非重提/判失败：不消耗重试额度，打开后下一轮自然续跑
  assert.match(recovery, /if \(!await isAiCallEnabled\(t\.userId\)\) continue/)
  assert.match(asset, /if \(!await isAiCallEnabled\(drama\.userId\)\) continue/)
})

test('auth surfaces switch state and exposes read/write endpoints', () => {
  const route = read('src/routes/auth.ts')
  const svc = read('src/services/auth.ts')
  const mw = read('src/middleware/auth.ts')

  assert.match(route, /app\.get\('\/ai-call'/)
  assert.match(route, /app\.put\('\/ai-call'/)
  // 入参严格布尔，避免字符串 "false" 被当成开启
  assert.match(route, /typeof body\?\.enabled !== 'boolean'/)
  // 开关不入 token：中间件按 DB 实时覆盖，避免关闭后旧 token 继续放行
  assert.match(svc, /aiCallEnabled: boolean/)
  assert.match(mw, /aiCallEnabled: row\.aiCallEnabled !== false/)
})

test('production orchestration refuses to start while switched off', () => {
  const single = read('src/routes/production.ts')
  const batch = read('src/routes/production-batch.ts')

  for (const src of [single, batch]) {
    assert.match(src, /import \{ aiCallGuard \} from '\.\.\/services\/ai-switch\.js'/)
    assert.match(src, /const blocked = aiCallGuard\(c\)/)
    assert.match(src, /if \(blocked\) return blocked/)
  }
})
