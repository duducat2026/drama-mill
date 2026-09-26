import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readDashScopeSources } from './helpers/dashscope-sources.mjs'
import { readDramasRouteSources } from './helpers/dramas-route-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const exists = (path) => existsSync(new URL(path, root))

test('绿网拦截修正服务存在：审核错误识别/项目开关/文本 AI 改写/限额重提', () => {
  assert.equal(exists('src/services/moderation-fix.ts'), true)
  const svc = read('src/services/moderation-fix.ts')

  // 审核类错误识别（绿网/敏感内容），且不含凭证类误伤
  assert.match(svc, /export function isModerationError/)
  // 关键词集合已抽到 utils/moderation.ts（失败诊断链路共用同一判定），本文件保留同名导出只做委托
  assert.match(svc, /return matchesModerationError\(msg\)/)
  assert.match(read('src/utils/moderation.ts'), /绿网\|green\.\?net/)
  assert.match(read('src/utils/moderation.ts'), /export function isModerationError/)
  assert.doesNotMatch(svc, /isModerationError[\s\S]{0,400}unauthorized/)

  // 项目级开关：metadata.green_net_auto_fix 显式 false 才关闭，默认开启
  assert.match(svc, /export async function isGreenNetFixEnabled/)
  assert.match(svc, /green_net_auto_fix !== false/)
  assert.match(svc, /if \(!dramaId\) return true/)

  // 文本 AI 改写走文本并发闸门，改写调用计入成本
  assert.match(svc, /withTextSlot/)
  assert.match(svc, /recordTextUsageFromResult/)

  // 修正计数落在任务 params JSON，达上限停止（默认 2 次，可经 GREEN_NET_FIX_MAX 覆盖）
  assert.match(svc, /moderationFixCount/)
  assert.match(svc, /GREEN_NET_FIX_MAX/)
  assert.match(svc, /process\.env\.GREEN_NET_FIX_MAX/)

  // 改写后清空上游 task_id 并重提（避免探测已判失败的上游任务）
  assert.match(svc, /taskId: null/)
  assert.match(svc, /await retryTask\(taskId\)/)
})

test('音频侧拦截确定性恢复：关闭音频重提，不耗文本 AI 不占改写额度', () => {
  const svc = read('src/services/moderation-fix.ts')

  // 音频侧拦截识别（audio_sync/音频审核），与提示词侧拦截区分
  assert.match(svc, /export function isAudioModerationFailure/)
  assert.match(svc, /audio\[_\\s-\]\?sync/)

  // 确定性恢复：params 置 generateAudio=0 + audioFallback 标记（只降级一次防循环）
  assert.match(svc, /generateAudio: 0, audioFallback: true/)
  assert.match(svc, /!params\.audioFallback/)
  assert.match(svc, /audio-fallback-resubmitted/)

  // 仅限视频任务；降级后仍被拦则继续走提示词改写链路（不 return 前置于改写逻辑之外）
  assert.match(svc, /record\.type === 'video' && isAudioModerationFailure/)
})

test('视频提交链路按 params.generateAudio 透传音频开关（降级重提生效前提）', () => {
  // 百炼/火山适配器均按记录值决定音频生成，关音频后上游不再产出音轨也就不再触发音频审核
  const dash = readDashScopeSources(root)
  assert.match(dash, /audio: record\.generateAudio !== false && record\.generateAudio !== 0/)
  const volc = read('src/services/adapters/volcengine-video.ts')
  assert.match(volc, /generate_audio: record\.generateAudio !== 0 && record\.generateAudio !== false/)
  // 合成环节对无音轨片段自动降级重编码（流拷贝要求全部片段有音轨，否则回退重编码）
  const merge = read('src/services/ffmpeg-merge.ts')
  assert.match(merge, /probes\.some\(p => !p\.v \|\| !p\.a\)/)
})

test('failTask 挂钩绿网修正：动态导入避免循环引用，异步触发不阻塞落库', () => {
  const gen = readGenerationSources(root)
  assert.match(gen, /import\('\.\/moderation-fix\.js'\)/)
  assert.match(gen, /isModerationError\(message\)/)
  assert.match(gen, /void mod\.attemptModerationAutoFix\(id\)/)
  // 终态错误识别保持不变：审核类仍不进自动重提（由绿网修正链路接管）
  assert.match(gen, /export function isPermanentError/)
})

test('dramas 路由 metadata 支持对象序列化（项目开关持久化载体）', () => {
  const routes = readDramasRouteSources(root)
  assert.match(routes, /function normalizeMetadata/)
  assert.match(routes, /metadata: normalizeMetadata\(body\.metadata\)/)
  assert.match(routes, /updates\.metadata = normalizeMetadata\(body\.metadata\)/)
})

test('前端项目详情页提供绿网修正开关且默认开启', () => {
  const view = read('../frontend/app/views/drama/detail.vue')
  assert.match(view, /toggleGreenNetFix/)
  assert.match(view, /green_net_auto_fix !== false/)
  assert.match(view, /dramaAPI\.update\(dramaId, \{ metadata: meta \}\)/)
  assert.match(view, /绿网修正/)
})
