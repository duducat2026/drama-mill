import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readAgentRouteSources } from './helpers/agent-route-sources.mjs'
import { episodeViewSource } from '../../frontend/tests/helpers/episode-sources.mjs'
import { readUseApiSources } from '../../frontend/tests/helpers/use-api-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('agent routes expose script_rewriter async run + status + retry', () => {
  const route = readAgentRouteSources(root)

  // 异步三件套：run 启动、status 轮询、retry 重试
  assert.match(route, /app\.post\('\/script_rewriter\/run'/)
  assert.match(route, /app\.get\('\/script_rewriter\/status'/)
  assert.match(route, /app\.post\('\/script_rewriter\/retry'/)
  // 内存态任务追踪
  assert.match(route, /type RewriterRun/)
  assert.match(route, /rewriterRuns = new Map/)
  // 重试只处理失败的任务
  assert.match(route, /existing\.status !== 'failed'\) return badRequest/)
  // 失败原因作为反馈传给 Agent 优化改写
  assert.match(route, /上次改写失败/)
  assert.match(route, /请根据此失败原因优化改写/)
})

test('agent routes expose storyboard_breaker retry with failure reason feedback', () => {
  const route = readAgentRouteSources(root)

  // 重试路由
  assert.match(route, /app\.post\('\/storyboard_breaker\/retry'/)
  // 重试只处理失败的任务
  assert.match(route, /existing\.status !== 'failed'\) return badRequest/)
  // 失败原因作为反馈传给 Agent 优化拆分
  assert.match(route, /上次拆分失败/)
  assert.match(route, /请根据此失败原因优化拆分/)
  // 重试递增 attempt 计数（attempt 概念存在）
  assert.match(route, /retryReason/)
})

test('useApi exposes rewriterAPI and storyboardAPI.retry', () => {
  const api = readUseApiSources(new URL('../frontend/', root))

  assert.match(api, /rewriterAPI/)
  assert.match(api, /\/agent\/script_rewriter\/run/)
  assert.match(api, /\/agent\/script_rewriter\/status/)
  assert.match(api, /\/agent\/script_rewriter\/retry/)
  assert.match(api, /\/agent\/storyboard_breaker\/retry/)
})

test('episode.vue script rewrite uses async pattern with retry', () => {
  const vue = episodeViewSource()

  // 异步改写状态
  assert.match(vue, /rewriteRunning/)
  assert.match(vue, /rewriteError/)
  // 异步启动 + 轮询 + 重试
  assert.match(vue, /rewriterAPI\.run/)
  assert.match(vue, /rewriterAPI\.status/)
  assert.match(vue, /rewriterAPI\.retry/)
  assert.match(vue, /pollRewriteStatus/)
  assert.match(vue, /doRetryRewrite/)
  assert.match(vue, /restoreRewriteStatus/)
})

test('episode.vue storyboard split supports error display and retry', () => {
  const vue = episodeViewSource()

  // sbSplit 扩展 error 字段
  assert.match(vue, /sbSplit.*error/)
  assert.match(vue, /doRetryBreakdown/)
  assert.match(vue, /storyboardAPI\.retry/)
  // 按钮错误展示
  assert.match(vue, /sbSplit\.error \? doRetryBreakdown/)
})

test('episode.vue video generation supports batch retry', () => {
  const vue = episodeViewSource()

  assert.match(vue, /retryFailedVideos/)
  assert.match(vue, /videoTaskFailedCount > 0/)
})
