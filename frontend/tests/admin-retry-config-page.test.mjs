import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readVideosPageSources } from './helpers/videos-page-sources.mjs'
import { readUseApiSources } from './helpers/use-api-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('useApi exposes retry config and abandon/restore admin APIs', () => {
  const api = readUseApiSources(root)

  assert.match(api, /retryConfig: \(\) => api\.get.*\/admin\/task-retry-config/)
  assert.match(api, /updateRetryConfig: \(v: number\) => api\.put/)
  assert.match(api, /abandonVideo: \(id: number\) => api\.post/)
  assert.match(api, /restoreVideo: \(id: number\) => api\.post/)
})

test('videos page renders retry cap config bar (0~9, runtime effective)', () => {
  const page = readVideosPageSources(root)

  assert.match(page, /失败任务自动重提上限/)
  assert.match(page, /v-model\.number="retryMax"/)
  assert.match(page, /:max="retryHardMax"/)
  // 保存走 PUT 配置接口；加载时取后端当前值
  assert.match(page, /adminAPI\.updateRetryConfig\(v\)/)
  assert.match(page, /adminAPI\.retryConfig\(\)/)
})

test('videos page supports abandon/restore per failed task', () => {
  const page = readVideosPageSources(root)

  // 放弃标记识别（后端 retry_count=99）
  assert.match(page, /\(t\?\.retry_count \|\| 0\) >= 99/)
  // 放弃/复活按钮与状态标签
  assert.match(page, /@click="abandonOne\(t\)"/)
  assert.match(page, /@click="restoreOne\(t\)"/)
  assert.match(page, /已放弃/)
  assert.match(page, /复活/)
  // 放弃任务不再展示"重试"按钮
  assert.match(page, /v-if="t\.status === 'failed' && !isAbandoned\(t\)"/)
})
