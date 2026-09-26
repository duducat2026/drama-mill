import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readEpisodeRouteSources } from './helpers/episode-route-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('video prompt batch service runs per-shot async agent loop', () => {
  const svc = read('src/services/video-prompts.ts')

  // 默认只处理缺少 video_prompt 的分镜；指定 storyboardIds 时只处理所选（已有提示词也重新生成）
  assert.match(svc, /filter\(sb => !\(sb\.videoPrompt \|\| ''\)\.trim\(\)\)/)
  assert.match(svc, /storyboardIds\?\.length/)
  assert.match(svc, /storyboardIds\.includes\(sb\.id\)/)
  // 运行中不重复启动
  assert.match(svc, /status === 'running'\) return \{ started: false, total: -1 \}/)
  // 逐个分镜调用 prompt_generator，以落库结果判定成败
  assert.match(svc, /mastra\.getAgent\('prompt_generator'\)/)
  assert.match(svc, /read_storyboard_context/)
  assert.match(svc, /update_storyboard/)
  assert.match(svc, /fresh\?\.videoPrompt/)
  // 进度跟踪与文本模型覆盖
  assert.match(svc, /current_storyboard_id/)
  assert.match(svc, /modelOverride: opts\.model/)
})

test('video prompt batch tracks per-storyboard status items with failure reasons', () => {
  const svc = read('src/services/video-prompts.ts')

  // 每个分镜的独立状态跟踪项：pending/running/done/failed + error + attempt
  assert.match(svc, /VideoPromptBatchItem/)
  assert.match(svc, /storyboard_id/)
  assert.match(svc, /storyboard_number/)
  assert.match(svc, /status: 'pending' \| 'running' \| 'done' \| 'failed'/)
  assert.match(svc, /attempt: number/)
  // items 数组在任务状态中
  assert.match(svc, /items: VideoPromptBatchItem\[\]/)
  // 每个分镜的成败状态更新到 item
  assert.match(svc, /item\.status = 'running'/)
  assert.match(svc, /item\.status = 'done'/)
  assert.match(svc, /item\.status = 'failed'/)
  assert.match(svc, /item\.error/)
})

test('video prompt batch supports retry with failure reason feedback', () => {
  const svc = read('src/services/video-prompts.ts')

  // 重试函数：只处理失败的分镜
  assert.match(svc, /export async function retryVideoPromptBatch/)
  assert.match(svc, /it\.status === 'failed'/)
  // 失败原因作为反馈传给 Agent 优化生成
  assert.match(svc, /buildPromptMessage/)
  assert.match(svc, /retryReason/)
  assert.match(svc, /上次生成失败/)
  assert.match(svc, /请根据此失败原因优化生成/)
  // 重试递增 attempt 计数
  assert.match(svc, /it\.attempt\+\+/)
})

test('episodes route exposes video prompt batch endpoints', () => {
  const route = readEpisodeRouteSources(root)

  assert.match(route, /app\.post\('\/:id\/generate-video-prompts'/)
  assert.match(route, /app\.get\('\/:id\/video-prompts-status'/)
  assert.match(route, /startVideoPromptBatch\(ep\.id, ep\.dramaId/)
  assert.match(route, /body\.storyboard_ids/)
  assert.match(route, /already_running/)
  // 重试路由
  assert.match(route, /app\.post\('\/:id\/retry-video-prompts'/)
  assert.match(route, /retryVideoPromptBatch\(ep\.id, ep\.dramaId/)
})
