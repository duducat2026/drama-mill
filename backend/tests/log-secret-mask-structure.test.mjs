// 请求日志凭证脱敏：登录/改密/模型配置的请求体会整体打印到日志，
// 口令与 API Key 必须先脱敏再落盘（开源部署常挂在共享日志或日志采集下）。
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const loggerSrc = readFileSync(new URL('../src/middleware/logger.ts', import.meta.url), 'utf8')
const { maskSecrets } = await import('../src/middleware/logger.ts')

test('日志中间件：请求体先脱敏再截断打印', () => {
  assert.match(loggerSrc, /export function maskSecrets\(/)
  assert.match(loggerSrc, /const masked = maskSecrets\(text\)/)
  // 截断必须发生在脱敏之后，否则被截断的凭证会绕过掩码
  assert.match(loggerSrc, /masked\.length > 500 \? masked\.slice\(0, 500\)[\s\S]{0,80}body: \$\{truncated\}/)
})

test('maskSecrets：口令/API Key/Token 整值掩码，字段名与长度保留', () => {
  assert.equal(
    maskSecrets('{"username":"drama-mill","password":"drama-mill"}'),
    '{"username":"drama-mill","password":"**********"}',
  )
  // 改密接口的两个口令字段都要覆盖
  assert.equal(maskSecrets('{"oldPassword":"abc123","newPassword":"xyz789"}'), '{"oldPassword":"******","newPassword":"******"}')
  // 云模型配置里的密钥（驼峰与下划线两种写法）
  assert.equal(maskSecrets('{"apiKey":"sk-12345"}'), '{"apiKey":"********"}')
  assert.equal(maskSecrets('{"api_key":"sk-12345"}'), '{"api_key":"********"}')
  // 值内含转义引号不得导致掩码越界
  assert.equal(maskSecrets('{"password":"a\\"b","keep":1}'), '{"password":"****","keep":1}')
})

test('maskSecrets：非凭证内容与非法 JSON 原样透传', () => {
  assert.equal(maskSecrets('not-json-body'), 'not-json-body')
  // 只是出现在普通文本里的单词不该被吞掉
  assert.equal(maskSecrets('{"note":"password reset requested"}'), '{"note":"password reset requested"}')
  // 掩码等长：日志排查时可凭长度判断口令是否被填错
  for (const body of ['{"password":"short"}', '{"token":"a-much-longer-token-value"}']) {
    assert.equal(maskSecrets(body).length, body.length)
  }
})
