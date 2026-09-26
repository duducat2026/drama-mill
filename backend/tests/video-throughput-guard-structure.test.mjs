import { readCloudTasksSources } from './helpers/cloud-tasks-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('上游队列水位限流：配置项 + 轻量查询 + 提交闸门', () => {
  // 配置中心：水位线/复查间隔/等待上限均可经环境变量调节
  const rate = read('src/utils/rate-config.ts')
  assert.match(rate, /UPSTREAM_VIDEO_PENDING_WATERMARK = envInt\('UPSTREAM_VIDEO_PENDING_WATERMARK', 20\)/)
  assert.match(rate, /UPSTREAM_WATERMARK_CHECK_INTERVAL_MS/)
  assert.match(rate, /UPSTREAM_WATERMARK_MAX_WAIT_MS/)
  assert.match(rate, /upstream_video_pending_watermark: UPSTREAM_VIDEO_PENDING_WATERMARK/)

  // 轻量水位查询：只拉第一页取 total（共享 total 实现，供分流在途量查询复用），失败返回 error 由调用方放行
  const cloud = readCloudTasksSources(root)
  assert.match(cloud, /export async function fetchCloudPendingCount/)
  assert.match(cloud, /async function fetchCloudTaskTotal/)
  assert.match(cloud, /status=\$\{status\}&page_no=1&page_size=1/)

  // 提交闸门：仅百炼视频生效；查询失败放行；超限等待达上限强制放行；复查结果短缓存防打满列表接口限流
  const gen = readGenerationSources(root)
  assert.match(gen, /async function waitForUpstreamWatermark/)
  assert.match(gen, /config\.provider !== 'dashscope' \|\| UPSTREAM_VIDEO_PENDING_WATERMARK <= 0\) return/)
  assert.match(gen, /watermark-wait-timeout/)
  assert.match(gen, /WATERMARK_CACHE_TTL_MS/)
  // 闸门挂在视频任务提交前（图片任务不受影响）
  assert.match(gen, /if \(type === 'video'\) await waitForUpstreamWatermark\(id, config, record\.model \|\| config\.model\)/)
})

test('参考素材链接失效自愈：轮询/提交两阶段快速重排，限次防循环、不消耗重试额度', () => {
  const gen = readGenerationSources(root)
  // 识别上游下载输入素材失败的错误（与本地结果下载失败的 "Download failed" 措辞区分）
  assert.match(gen, /function isAssetExpiryError/)
  assert.match(gen, /Failed to download/)
  // failTask 前置拦截（轮询阶段上游判失败路径）+ 提交阶段 catch 兜底
  assert.match(gen, /if \(isAssetExpiryError\(message\) && await requeueExpiredAssetTask\(id\)\) return/)
  assert.match(gen, /async function requeueExpiredAssetTask/)
  assert.match(gen, /ASSET_EXPIRY_REQUEUE_MAX = 2/)
  // 重排落在 params 计数（不占用 retry_count 自动重试额度），并清空上游 task_id 重新入队
  assert.match(gen, /assetExpiryRequeue/)
  assert.match(gen, /taskId: null, params: JSON\.stringify\(nextParams\)/)
})

test('未开通模型配置自愈：解集级锁定重排活跃配置，有替代时自动停用失效配置', () => {
  const gen = readGenerationSources(root)
  // 精确识别 Unpurchased（不含一般 403），提交阶段 catch 先行于 failTask 落库
  assert.match(gen, /AccessDenied\\\.Unpurchased\|access to model denied/i)
  assert.match(gen, /if \(await maybeHandleConfigFailure\(id, err\.message\)\) return/)
  // 清掉集级配置锁定后重排；停用失效配置仅在有其它可用配置时执行（避免误伤唯一配置）
  assert.match(gen, /delete params\.configId/)
  assert.match(gen, /auto-deactivated-unpurchased/)
  assert.match(gen, /fallback\.configId !== params\.configId/)
})

test('绿网提交前本地预检：敏感词命中先改写再提交，与失败后修正共用额度与项目开关', () => {
  const mod = read('src/services/moderation-fix.ts')
  // 预检词表与额度导出（低误报词表，漏网仍由失败后修正链路兜底）
  assert.match(mod, /export function hasSensitiveTerms/)
  assert.match(mod, /export function getGreenNetFixMax/)
  // 改写函数对外导出并区分触发来源（措辞差异）
  assert.match(mod, /export async function rewritePromptForModeration/)
  assert.match(mod, /scene === 'precheck'/)

  const gen = readGenerationSources(root)
  // 预检挂在视频任务构建请求之前，改写后回写任务并重读 params
  assert.match(gen, /async function preSubmitVideoPrecheck/)
  assert.match(gen, /mod\.hasSensitiveTerms\(record\.prompt\)/)
  assert.match(gen, /fixCount >= mod\.getGreenNetFixMax\(\)\) return null/)
  assert.match(gen, /GreenNetPrecheck/)
  // 与失败后修正共用额度：预检同样累加 moderationFixCount
  assert.match(gen, /moderationFixCount: fixCount \+ 1/)
})
