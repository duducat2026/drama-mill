// 小说导入分集与自动化生产 — 路由/服务结构测试（源码断言，沿用现有约定）
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readProductionSources } from './helpers/production-sources.mjs'
import { readProductionBatchSources } from './helpers/production-batch-sources.mjs'
import { readNovelRouteSources } from './helpers/novel-route-sources.mjs'
import { readSchemaSources } from './helpers/schema-sources.mjs'
import { readMysqlSchemaSources } from './helpers/mysql-schema-sources.mjs'
import { readAgentsIndexSources } from './helpers/agents-index-sources.mjs'
import { readUseApiSources } from '../../frontend/tests/helpers/use-api-sources.mjs'
import { readDetailSources } from '../../frontend/tests/helpers/detail-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('novels 路由：上传/列表/拆分/状态四端点与编码回退', () => {
  const src = readNovelRouteSources(root)
  assert.match(src, /app\.post\('\/upload'/)
  assert.match(src, /app\.get\('\/'/)
  assert.match(src, /app\.post\('\/:id\/split'/)
  assert.match(src, /app\.get\('\/:id\/split-status'/)
  // 编码：utf-8 严格解码失败回退 gb18030
  assert.match(src, /TextDecoder\('utf-8', \{ fatal: true \}\)/)
  assert.match(src, /TextDecoder\('gb18030'\)/)
  // 限制 .txt/.md ≤ 10MB
  assert.match(src, /10 \* 1024 \* 1024/)
  assert.match(src, /\.txt|\.md/)
})

test('novels 表：schema 与 DDL 与 init.sql 三处一致', () => {
  const schema = readSchemaSources(root)
  const ddl = readMysqlSchemaSources(root)
  const initSql = read('../docker/init.sql')
  assert.match(schema, /novels\s*=\s*mysqlTable/)
  assert.match(schema, /splitStatus/)
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS\s+`?novels`?/i)
  assert.match(initSql, /CREATE TABLE IF NOT EXISTS\s+`?novels`?/i)
})

test('production 路由：start/pause/resume/status 四端点', () => {
  const src = read('src/routes/production.ts')
  assert.match(src, /app\.post\('\/dramas\/:id\/start'/)
  assert.match(src, /app\.post\('\/dramas\/:id\/pause'/)
  assert.match(src, /app\.post\('\/dramas\/:id\/resume'/)
  assert.match(src, /app\.get\('\/dramas\/:id\/status'/)
})

test('production 编排器：6 步流水线（无自动拼接）与两阶段并发/幂等/暂停语义', () => {
  const src = readProductionSources(root)
  // 6 个步骤按序（整集合成不再属于自动生产，按需手动触发）
  for (const key of [
    'script_rewrite', 'extract_assets', 'storyboard_split',
    'video_prompts', 'asset_images', 'generate_videos',
  ]) {
    assert.match(src, new RegExp(`key: '${key}'`))
  }
  assert.doesNotMatch(src, /key: 'merge_episode'/)
  assert.doesNotMatch(src, /mergeEpisodeVideos/)
  // 集完成判定改为视频全部生成，且优先检查手动标记的 episodes.status === 'completed'
  assert.match(src, /generate_videos\.status === 'done'/)
  assert.match(src, /status === 'completed'/)
  // 两阶段解耦并发：前 5 步窗口由 PROD_PRE_VIDEO_CONCURRENCY 控制，前置完成即移交视频阶段释放槽位，
  // 视频生成单独受 PROD_EPISODE_CONCURRENCY 限制且不占前置窗口（前置任务尽早铺满）
  assert.match(src, /PROD_PRE_VIDEO_CONCURRENCY/)
  assert.match(src, /PROD_EPISODE_CONCURRENCY/)
  assert.match(src, /Promise\.race\(\[\.\.\.running, \.\.\.videoStage\]\)/)
  assert.match(src, /const videoStage = new Set<Promise<void>>\(\)/)
  // 启动预热：分镜拆分之前的步骤（剧本改写→资产提取）对所有集全量快速并行，防止队列空等；
  // 预热失败不中止整体（步骤幂等，主窗口回补），暂停经 PAUSED 传递，主窗口前二次检查暂停
  assert.match(src, /async function warmupPreStoryboard/)
  assert.match(src, /await warmupPreStoryboard\(list, dramaId, run, userId\)/)
  assert.match(src, /PROD_PRE_STORYBOARD_CONCURRENCY/)
  assert.match(src, /warmup-failed/)
  // 外层循环条件必须带 fatalError 逃逸：失败/暂停停止补新且两个集合均排空后若仍循环，
  // 内层无启动、下方无 await，会退化为同步死循环独占事件循环（全服务冻结回归防护）；
  // runLoop 条件含 videoStage 排空判定（预热窗口不含视频阶段，沿用旧式条件）
  assert.match(src, /while\s*\(\(!fatalError\s*&&\s*idx\s*<\s*list\.length\)\s*\|\|\s*running\.size\s*>\s*0\s*\|\|\s*videoStage\.size\s*>\s*0\)/)
  assert.match(src, /while\s*\(\(!fatalError\s*&&\s*idx\s*<\s*list\.length\)\s*\|\|\s*running\.size\s*>\s*0\)/)
  assert.match(read('src/utils/rate-config.ts'), /PROD_EPISODE_CONCURRENCY/)
  assert.match(read('src/utils/rate-config.ts'), /PROD_PRE_VIDEO_CONCURRENCY/)
  assert.match(read('src/utils/rate-config.ts'), /PROD_PRE_STORYBOARD_CONCURRENCY/)
  // 视频生成槽位信号量：限制同时生成视频的集数
  assert.match(src, /waitForVideoSlot/)
  assert.match(src, /releaseVideoSlot/)
  assert.match(src, /videoGenCount/)
  // 两阶段解耦：produceEpisodePreVideo 前 5 步循环中 break 跳过视频步；
  // produceEpisodeVideoStage 单独获取槽位执行，致命错误/暂停时前置完成后不再移交视频阶段（快速收敛）
  assert.match(src, /async function produceEpisodePreVideo/)
  assert.match(src, /async function produceEpisodeVideoStage/)
  assert.match(src, /key === 'generate_videos'\) break/)
  assert.match(src, /await waitForVideoSlot\(run\)/)
  assert.match(src, /if \(fatalError \|\| isPaused\(run\)\) return/)
  // 复用共享服务（重构产物）
  assert.match(src, /executeAgentRun/)
  assert.match(src, /startExtraction/)
  assert.match(src, /startVideoPromptBatch/)
  assert.match(src, /submitEpisodeVideoBatch/)
  // 建集走共享 createEpisode（拆分服务）
  assert.match(read('src/services/novel-split.ts'), /createEpisode/)
})

test('episode-videos：参考图顺序与 @引用替换（与前端逻辑对齐）', () => {
  const src = read('src/services/episode-videos.ts')
  assert.match(src, /getShotReferenceImages/)
  assert.match(src, /resolveVideoPromptRefs/)
  // 去重、≤9 张
  assert.match(src, />= 9/)
  // @名字 → @图片N名字
  assert.match(src, /@图片/)
  assert.match(src, /generateVideo\(/)
})

test('agents 导出 getModel 供轻量 Agent 复用', () => {
  const src = readAgentsIndexSources(root)
  assert.match(src, /export (async )?function getModel/)
})

test('拆分服务使用轻量无工具 Agent 生成集标题/概要', () => {
  const src = read('src/services/novel-split.ts')
  assert.match(src, /new Agent\(/)
  assert.match(src, /getModel\(/)
})

test('前端 useApi 新增 novelAPI/productionAPI', () => {
  const src = readUseApiSources(new URL('../frontend/', root))
  assert.match(src, /novelAPI/)
  assert.match(src, /productionAPI/)
  assert.match(src, /\/novels\/upload/)
  assert.match(src, /\/production\/dramas\//)
})

test('前端向导与详情面板接入', () => {
  const wizard = read('../frontend/app/components/NovelImportWizard.vue')
  assert.match(wizard, /novelAPI/)
  assert.match(wizard, /productionAPI/)
  const index = read('../frontend/app/pages/index.vue')
  assert.match(index, /NovelImportWizard/)
  const detail = readDetailSources(new URL('../frontend/', root))
  assert.match(detail, /productionAPI/)
  assert.match(detail, /prod-card/)
})

test('production 步骤前置校验：每步执行前验证上一步素材，缺失自动回补上一步', () => {
  const svc = readProductionSources(root)
  // 输入校验：按 DB 实时数据返回缺失的上一步 key
  assert.match(svc, /async function missingStepInputs/)
  assert.match(svc, /getFreshEpisode/)
  // 各步对上游产出的依赖断言：剧本→资产→分镜→提示词→资产图→视频
  assert.match(svc, /case 'extract_assets'/)
  assert.match(svc, /missing\.push\('script_rewrite'\)/)
  assert.match(svc, /missing\.push\('extract_assets'\)/)
  assert.match(svc, /missing\.push\('storyboard_split'\)/)
  assert.match(svc, /missing\.push\('video_prompts'\)/)
  assert.match(svc, /missing\.push\('asset_images'\)/)
  // 回补执行：缺失时先递归保证上游输入再执行对应步骤，回补后二次校验仍缺才抛错；深度上限防循环
  assert.match(svc, /async function ensureStepInputs/)
  assert.match(svc, /backfill-input/)
  assert.match(svc, /depth \+ 1/)
  assert.match(svc, /depth > PRODUCTION_STEPS\.length/)
  // 主循环每步执行前调用校验；步骤函数由 buildStepFns 统一构造以便两阶段复用回补
  assert.match(svc, /await ensureStepInputs\(/)
  assert.match(svc, /function buildStepFns/)
  assert.match(svc, /: Record<StepKey, StepFn>/)
})

test('production 失败恢复：资产图自动补跑 + resume 放宽 + 前端 idle 兜底入口', () => {
  const svc = readProductionSources(root)
  // stepAssetImages：缺图资产自动补跑重试轮次后才判步骤失败
  assert.match(svc, /ASSET_IMAGE_RETRY_ROUNDS/)
  assert.match(svc, /asset-images-retry/)
  // resumeProduction：error / 进程重启丢失 run（DB 状态 producing/failed）也可续跑
  assert.match(svc, /export async function resumeProduction/)
  assert.match(svc, /\['producing', 'failed'\]/)
  // 路由 await 异步 resume；批次编排同步适配
  assert.match(read('src/routes/production.ts'), /await resumeProduction\(/)
  assert.match(readProductionBatchSources(root), /await resumeProduction\(/)
  // 前端 idle 兜底：run 丢失/未开始但有未完成集时展示卡片与启动入口
  const detail = readDetailSources(new URL('../frontend/', root))
  assert.match(detail, /idleProd/)
  assert.match(detail, /续跑生产/)
  // idle 状态样式随样式外置拆分迁移到独立 CSS 文件
  const detailCss = read('../frontend/app/assets/styles/drama.detail.css')
  assert.match(detailCss, /prod-status-idle/)
})
