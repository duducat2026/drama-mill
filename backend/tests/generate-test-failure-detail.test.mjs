// 生成测试失败诊断 — 行为单测（真实 import 纯解析函数）+ 接线结构断言
// 目标：任何上游错误形态（SDK 包装层 / HTML 错误页 / JSON 错误体 / 空 body）都要给出可读结论
import { readTasksRouteSources } from './helpers/tasks-route-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeFailure } from '../src/services/failure-detail.ts'
import { readAiConfigRouteSources } from './helpers/aiconfig-route-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('AI SDK 包装层：状态码与 request_id 从 statusCode/responseBody 里挖出来', () => {
  const err = new Error('Failed to create provider tool')
  err.statusCode = 401
  err.responseBody = JSON.stringify({
    error: { message: 'Incorrect API key provided: sk-abcdef123456.', type: 'invalid_request_error', code: 'invalid_api_key' },
    request_id: 'req_1A2B3C',
  })
  err.cause = new Error('401 Unauthorized')

  const d = describeFailure(err, { serviceType: 'text', provider: 'openai' })
  assert.equal(d.kind, 'auth')
  assert.match(d.summary, /API Key 无效/)
  assert.match(d.summary, /HTTP 401/)
  assert.equal(d.upstream_status, 401)
  assert.equal(d.upstream_code, 'invalid_api_key')
  assert.equal(d.request_id, 'req_1A2B3C')
  // 结论要落到动作上：告诉用户去哪核对密钥
  assert.match(d.hint, /眼睛图标/)
  assert.match(d.hint, /\/v1\/chat\/completions/)
})

test('原始返回里的密钥一律去密，不把 Key 回显到浏览器', () => {
  const d = describeFailure('API error 401: {"error":{"message":"key sk-live-realsecret123456 rejected"}}')
  assert.doesNotMatch(d.raw, /realsecret123456/)
  assert.match(d.raw, /sk-\*\*\*/)

  const q = describeFailure('https://gw.example.com/v1?api_key=supersecret99 unreachable')
  assert.doesNotMatch(q.raw, /supersecret99/)
})

test('状态码分类：404 端点/模型、429 限流、额度不足优先于 429、5xx 归上游', () => {
  assert.equal(describeFailure('API error 404: <html>404 Not Found</html>', { serviceType: 'image', provider: 'openai' }).kind, 'not_found')
  assert.equal(describeFailure('API error 429: Too Many Requests').kind, 'rate_limit')
  // 百炼/通义系把配额耗尽也回 429，结论必须是「充值」而不是「稍后重试」
  const quota = describeFailure('API error 429: {"code":"Throttling.AllocationQuota","message":"Free allocated quota exceeded","request_id":"7c9f"}')
  assert.equal(quota.kind, 'balance')
  assert.equal(quota.request_id, '7c9f')
  assert.equal(describeFailure('API error 500: Internal Server Error').kind, 'upstream')
  // 504 措辞含 timeout，但不能被判成本机网络/超时问题
  assert.equal(describeFailure('API error 504: Gateway Time-out').kind, 'upstream')
})

test('网络与超时：ENOTFOUND 不能被当成 404 模型不存在', () => {
  const err = new Error('fetch failed')
  err.cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.invalid.host'), { code: 'ENOTFOUND' })

  const d = describeFailure(err, { serviceType: 'text', provider: 'dashscope' })
  assert.equal(d.kind, 'network')
  assert.equal(d.upstream_status, null)
  assert.equal(d.upstream_code, 'ENOTFOUND')
  assert.match(d.summary, /无法连接到上游服务/)

  assert.equal(describeFailure('Error: Request timed out after 60000ms').kind, 'timeout')
})

test('绿网拦截复用审核关键词判定，并说明与配置无关', () => {
  const d = describeFailure('API error 400: {"code":"DataInspectionFailed","message":"Input text may contain sensitive information"}', { serviceType: 'image', provider: 'dashscope' })
  assert.equal(d.kind, 'moderation')
  assert.match(d.summary, /内容安全审核/)
  assert.equal(d.upstream_code, 'DataInspectionFailed')
})

test('空 body 与自有校验文案：不静默留白，也不乱扣上游故障', () => {
  const empty = describeFailure('')
  assert.equal(empty.kind, 'empty')
  assert.match(empty.summary, /未返回任何错误信息/)

  const own = describeFailure('该文本配置未启用或不可用，请先在设置页启用后再测试', { serviceType: 'text', provider: 'openai' })
  assert.equal(own.kind, 'unknown')
  assert.match(own.summary, /该文本配置未启用/)
})

test('超长原文截断，避免 HTML 错误页撑爆弹层', () => {
  const d = describeFailure(`API error 502: ${'x'.repeat(5000)}`)
  assert.ok(d.raw.length < 1700, `raw 长度应受限，实际 ${d.raw.length}`)
  assert.match(d.raw, /已截断/)
})

test('generate-test 路由：失败按 200 + ok:false 回传结构化诊断（密钥仅掩码）', () => {
  const route = readAiConfigRouteSources(root)
  assert.match(route, /import \{ describeFailure \} from '\.\.\/services\/failure-detail\.js'/)
  assert.match(route, /const detail = describeFailure\(error, \{ serviceType: row\.serviceType, provider: row\.provider \}\)/)
  // 成功与失败都带 ok 字段，前端不再靠 HTTP 400 分支判断
  assert.match(route, /success\(c, \{ ok: true, \.\.\.await runTextGenerationTest\(id, user\.id\) \}\)/)
  assert.match(route, /success\(c, \{ ok: true, \.\.\.await submitMediaGenerationTest\(row\.serviceType, id, user\.id\) \}\)/)
  assert.match(route, /ok: false,/)
  // 回传配置上下文用于核对，但密钥走掩码
  assert.match(route, /api_key: maskApiKey\(row\.apiKey\)/)
  assert.doesNotMatch(route, /api_key: row\.apiKey/)
  // 不再只把 err.message 丢给前端
  assert.doesNotMatch(route, /badRequest\(c, error\?\.message \|\| '生成测试失败'\)/)
})

test('任务失败详情接口：归属校验 + 诊断 + 配置上下文（密钥掩码）', () => {
  const tasks = readTasksRouteSources(new URL('..', import.meta.url))
  assert.match(tasks, /app\.get\('\/:id\/failure-detail'/)
  // 复用列表/重试同一套归属校验，不给越权诊断留口子
  assert.match(tasks, /const row = await getTaskOwned\(id, user\)\n\s*const params = parseJsonField\(row\.params\)/)
  assert.match(tasks, /describeFailure\(row\.errorMsg, \{ serviceType: row\.type, provider: row\.provider \}\)/)
  assert.match(tasks, /api_key: maskApiKey\(cfg\.apiKey\)/)
  assert.match(tasks, /error: row\.status === 'failed'/)
})
