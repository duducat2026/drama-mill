// 多视频模型分流（按上游负载选模型）— 结构测试（源码断言，沿用现有约定）
// 背景：百炼视频各模型限流池相互独立（各 5 并发），配置内多模型时把新任务分给在途量小的池，
// 双池并行吃满双倍并发；查询失败回退默认模型，不基于残缺数据分流
import { readCloudTasksSources } from './helpers/cloud-tasks-sources.mjs'
import { readTasksRouteSources } from './helpers/tasks-route-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readDashScopeSources } from './helpers/dashscope-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('AIConfig 携带配置内全部模型（models 数组），三处构造点一致', () => {
  // 类型定义（两处镜像）：model 为首选默认模型，models 为分流候选全集
  for (const p of ['src/services/ai.ts', 'src/services/adapters/types.ts']) {
    const src = read(p)
    assert.match(src, /models\?: string\[\]/)
  }
  // 构造点：启用配置/按 ID 取配置/重启恢复均填充 models（过滤非字符串空项）
  const ai = read('src/services/ai.ts')
  assert.match(ai, /models: models\.filter\(\(m: any\) => typeof m === 'string' && m\.trim\(\)\)/)
  const gen = readGenerationSources(root)
  assert.match(gen, /models: models\.filter\(\(m: any\) => typeof m === 'string' && m\.trim\(\)\)/)
})

test('cloud-tasks：模型在途量查询（PENDING + RUNNING 合计），失败即整体报错', () => {
  const svc = readCloudTasksSources(root)
  // 轻量 total 查询抽为共享实现，水位闸门复用（仅拉第一页取 total，不分页）
  assert.match(svc, /async function fetchCloudTaskTotal\(/)
  assert.match(svc, /status=\$\{status\}&page_no=1&page_size=1/)
  assert.match(svc, /export async function fetchCloudPendingCount/)
  assert.match(svc, /fetchCloudTaskTotal\(apiKey, model, 'PENDING'\)/)
  // 在途量 = PENDING + RUNNING 并行查询后合计；任一失败整体返回 error（调用方回退默认模型）
  assert.match(svc, /export async function fetchCloudInflightCount/)
  assert.match(svc, /fetchCloudTaskTotal\(apiKey, model, 'RUNNING'\)/)
  assert.match(svc, /pending\.count \+ running\.count/)
  assert.match(svc, /if \(pending\.error\) return/)
})

test('generation：提交前按上游负载选模型，切换即回写任务落库模型', () => {
  const gen = readGenerationSources(root)
  // 选模：仅百炼系（含 Model Router 网关，后者只做素材过滤不探负载）+ 候选 ≥2 才分流；负载相同取配置顺序靠前（稳定不震荡）
  assert.match(gen, /async function pickLeastLoadedVideoModel/)
  assert.match(gen, /config\.provider !== 'dashscope' && config\.provider !== 'model-router'\) return fallback/)
  assert.match(gen, /candidates\.length < 2\) return fallback/)
  assert.match(gen, /count < bestLoad/)
  // 单候选探测失败（如不支持列表查询/429）仅跳过该候选；成功探测不足 2 个才整体回退，
  // 否则部分模型探测故障会让分流永远不生效（云端实测 wan2.7-* 列表接口 429）
  assert.match(gen, /model-balance-skip/)
  assert.match(gen, /model-balance-skip[^\n]*\n\s+continue/)
  assert.match(gen, /if \(probed < 2\) return fallback/)
  assert.match(gen, /model-balance/)
  // 探测结果 15s 短缓存（与水位闸门同款）：并发提交共享，避免打满列表接口 20 QPS 限流
  assert.match(gen, /const inflightCache = new Map/)
  assert.match(gen, /async function upstreamInflightCount/)
  assert.match(gen, /WATERMARK_CACHE_TTL_MS/)
  // 失败也缓存 15s：斩断并发重探风暴（不缓存时 N 个并发各自重探，403/429 自我放大）
  assert.match(gen, /error: res\.error/)
  assert.match(gen, /error: cached\.error/)
  // 挂载点：视频任务提交前选模；切换后回写落库模型（轮询/展示/水位闸门均按实际提交模型）
  assert.match(gen, /const picked = await pickLeastLoadedVideoModel\(id, config, record\.model \|\| config\.model, media\)/)
  assert.match(gen, /\.set\(\{ model: picked, updatedAt: now\(\) \}\)/)
  // 候选素材兼容性过滤：t2v 仅无素材任务 / i2v 需首帧 / r2v 需参考图，不兼容候选不参与分流；回退模型永不过滤
  assert.match(gen, /function isModelCompatibleWithMedia\(/)
  assert.match(gen, /endsWith\('-t2v'\)\) return !media\.hasReferenceImages && !media\.hasFirstFrame/)
  assert.match(gen, /endsWith\('-i2v'\)\) return media\.hasFirstFrame/)
  assert.match(gen, /endsWith\('-r2v'\)\) return media\.hasReferenceImages/)
  assert.match(gen, /m === fallback \|\| isModelCompatibleWithMedia\(m, media\)/)
  // 素材形态从任务参数推导：参考图兼容数组/JSON 字符串，首帧取 firstFrameUrl 或 imageUrl
  assert.match(gen, /hasFirstFrame: !!\(params\.firstFrameUrl \|\| params\.imageUrl\)/)
  // 水位缓存键修正：多模型后按「Key:模型」缓存，防不同模型队列深度互相串用
  assert.match(gen, /`\$\{config\.apiKey\}:\$\{model\}`/)
  assert.match(gen, /watermarkCache\.delete\(`\$\{config\.apiKey\}:\$\{model\}`\)/)
})

test('锁定模型（noBalance）：用户显式指定时跳过分流，路由透传并随任务参数落库', () => {
  const gen = readGenerationSources(root)
  // 参数声明与落库：noBalance 随任务 params JSON 持久化（重试/重启恢复链路同样生效；未锁定时不写入）
  assert.match(gen, /noBalance\?: boolean/)
  assert.match(gen, /noBalance: params\.noBalance \? true : undefined/)
  // 提交前分流入口的逃逸条件：锁定时不调 pickLeastLoadedVideoModel，直接按落库模型提交并留痕
  assert.match(gen, /params\.noBalance/)
  assert.match(gen, /model-locked/)
  assert.match(gen, /if \(type === 'video' && params\.noBalance\) \{/)
  // 路由层透传前端 no_balance 开关（未传时不得误锁）
  const routes = readTasksRouteSources(new URL('..', import.meta.url))
  assert.match(routes, /noBalance: !!body\.no_balance/)
})

test('dashscope 适配器：happyhorse 系列按后缀裁剪素材，格式与 wan3.0 同源（ratio + resolution）', () => {
  const ds = readDashScopeSources(root)
  // 模型族判定先剥 symbol/ 前缀：网关（Model Router）模型标识形如 qwen/happyhorse-1.1-i2v
  assert.match(ds, /export const isHappyHorseVideoModel = \(model: string\) => stripModelSymbol\(model\)\.startsWith\('happyhorse'\)/)
  assert.match(ds, /if \(isHappyHorseVideoModel\(model\)\) \{/)
  assert.match(ds, /private buildHappyHorseRequest\(/)
  // r2v 仅参考图（缺失即抛错防无效提交）；i2v 仅首帧；t2v 不传 media；提示词三变体均必传
  assert.match(ds, /endsWith\('-r2v'\)/)
  assert.match(ds, /reference_image/)
  assert.match(ds, /happyhorse 参考生视频（r2v）要求至少 1 张参考图/)
  assert.match(ds, /happyhorse 图生视频（i2v）要求提供首帧图/)
  assert.match(ds, /happyhorse 视频生成要求提供提示词/)
  // 水印固定关闭（生产视频不允许 Happy Horse 水印）；i2v 无 ratio 参数（画幅跟随首帧）
  assert.match(ds, /watermark: false/)
  assert.match(ds, /if \(!model\.endsWith\('-i2v'\)\) parameters\.ratio = toWan3Ratio\(record\.aspectRatio\)/)
  // 时长钳制：happyhorse 3-15 秒（下限高于 wan 系）
  assert.match(ds, /const min = model && isHappyHorseVideoModel\(model\) \? 3 : 2/)
})

test('rate-config：分流不改全局闸门默认值（并发/水位仍可通过环境变量校准）', () => {
  const cfg = read('src/utils/rate-config.ts')
  assert.match(cfg, /GEN_MAX_CONCURRENT_VIDEO/)
  assert.match(cfg, /UPSTREAM_VIDEO_PENDING_WATERMARK/)
})
