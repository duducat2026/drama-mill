import { readTasksRouteSources } from './helpers/tasks-route-sources.mjs'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readAiConfigRouteSources } from './helpers/aiconfig-route-sources.mjs'
import { readAgentsIndexSources } from './helpers/agents-index-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('ai-test service: text 同步最小生成 + 图片/视频任务提交', () => {
  const svc = read('src/services/ai-test.ts')

  // 三类最小测试提示词集中定义，短且可肉眼判定
  assert.match(svc, /export const GENERATE_TEST_PROMPTS = \{/)
  assert.match(svc, /text: '.*'/)
  assert.match(svc, /image: '.*'/)
  assert.match(svc, /video: '.*'/)

  // 文本：走 getConfigById（含总开关/官方厂商校验）→ createTextModel（锁定本配置模型）→ withTextSlot → 计价
  assert.match(svc, /import \{ createTextModel \} from '\.\.\/agents\/index\.js'/)
  assert.match(svc, /import \{ withTextSlot \} from '\.\.\/utils\/rate-config\.js'/)
  assert.match(svc, /const config = await getConfigById\(configId\)/)
  // 上限用命名常量而非字面量：思考型模型把额度花在 reasoning_content 上，过小会「调用成功但正文为空」
  assert.match(svc, /export const TEXT_TEST_MAX_TOKENS = 256/)
  assert.match(svc, /createTextModel\(config, config\.model, TEXT_TEST_MAX_TOKENS\)/)
  assert.match(svc, /withTextSlot\(\(\) => agent\.generate\(/)
  assert.match(svc, /maxSteps: 1/)
  assert.match(svc, /recordTextUsageFromResult\(/)
  // 配置未启用/不可用时明确抛错，不回退到其它配置
  assert.match(svc, /if \(!config\) throw new Error\(/)

  // 图片/视频：提交一次性任务返回 task_id
  assert.match(svc, /submitMediaGenerationTest\(type: 'image' \| 'video'/)
  assert.match(svc, /generateConfigTest\(type, config, GENERATE_TEST_PROMPTS\[type\], userId\)/)
  assert.match(svc, /task_id: taskId/)
})

test('generation queue: configTest 任务复用队列、跳过预检/看门狗、单次提交', () => {
  const gen = readGenerationSources(root)

  // 提供 generateConfigTest：锁定本配置模型、无项目关联、noBalance 跳过多模型分流
  assert.match(gen, /export async function generateConfigTest\(type: TaskType, config: AIConfig/)
  assert.match(gen, /await assertAiCallEnabled\(userId\)/)
  assert.match(gen, /configTest: true,/)
  assert.match(gen, /noBalance: true,/)

  // 提交走 submitWithRetry 单次模式（singleShot），并在其中再过总开关；限流不重试
  const retry = gen.slice(gen.indexOf('async function submitWithRetry'), gen.indexOf('async function generateImage'))
  assert.match(retry, /singleShot = false, userId\?: number \| null/)
  assert.match(retry, /if \(singleShot\) await assertAiCallEnabled\(userId\)/)
  assert.match(retry, /if \(singleShot \|\| !isRateLimitError\(msg\)/)
  assert.match(gen, /params\.configTest, record\.userId\)/)

  // 视频提交前本地预检与素材失效重排都跳过测试任务
  assert.match(gen, /if \(params\.configTest \|\| !record\.prompt\?\.trim\(\)\) return null/)
  assert.match(gen, /if \(params\.configTest\) return false/)
})

test('ai-configs route exposes generate-test with ownership check', () => {
  const route = readAiConfigRouteSources(root)
  assert.match(route, /import \{ runTextGenerationTest, submitMediaGenerationTest \} from '\.\.\/services\/ai-test\.js'/)
  assert.match(route, /app\.post\('\/:id\/generate-test'/)
  // 归属校验：非本人配置直接 404
  assert.match(route, /if \(!row \|\| row\.userId !== user\.id\) return notFound\(c\)/)
  // 文本与图片/视频分流，其它类型拒绝；成功回包带 ok:true 供前端区分「探测通/生成通」
  assert.match(route, /return success\(c, \{ ok: true, \.\.\.await runTextGenerationTest\(id, user\.id\) \}\)/)
  assert.match(route, /row\.serviceType === 'image' \|\| row\.serviceType === 'video'/)
  assert.match(route, /return success\(c, \{ ok: true, \.\.\.await submitMediaGenerationTest\(row\.serviceType, id, user\.id\) \}\)/)
})

test('agents: createTextModel 接受显式配置与 maxOutputTokens，测试不回退默认', () => {
  const agents = readAgentsIndexSources(root)
  assert.match(agents, /export function createTextModel\(textConfig: AIConfig, modelName = textConfig\.model, maxOutputTokens = defaultMaxTokens\)/)
  assert.match(agents, /body\.generationConfig = \{ \.\.\.\(body\.generationConfig \|\| \{\}\), maxOutputTokens \}/)
  assert.match(agents, /body\.max_tokens = maxOutputTokens/)
})

test('configTest 任务不会被任何自动路径复活（重提/换配置/审核修正/人工重试）', () => {
  const gen = readGenerationSources(root)

  // 看门狗自动重提取数即在 SQL 层排除，不占每轮限量
  const autoRetry = gen.slice(gen.indexOf('export async function getFailedTasksForAutoRetry'), gen.indexOf('export async function getTaskQueueStats') > -1
    ? gen.indexOf('export async function getTaskQueueStats') : gen.length)
  assert.match(autoRetry, /NOT LIKE '%"configTest":true%'/)
  // 人工/自动重试一律拒绝，并引导回设置页重新发起
  assert.match(gen, /if \(isConfigTestParams\(parseTaskParams\(record\.params\)\)\) \{\n\s*throw new Error\('生成测试任务不支持重试/)
  // 失败落库不触发绿网提示词自动修正（会再花一次文本调用并重新提交上游）
  assert.match(gen, /isModerationError\(message\) && !isConfigTestParams\(parseTaskParams\(row\?\.params\)\)/)
  // 提交阶段配置故障自愈跳过：不自动停用配置、不换配置重提
  const cfgFailure = gen.slice(gen.indexOf('async function maybeHandleConfigFailure'), gen.indexOf('async function isConfigTestTask'))
  assert.match(cfgFailure, /if \(await isConfigTestTask\(id\)\) return false/)
  // 成本明细标记为生成测试，便于在用量页区分
  assert.match(gen, /detail: isConfigTestParams\(params\) \? `生成测试 task#\$\{record\.id\}`/)
})

test('重启恢复：测试任务按落库 configId 精确续轮询，且轮询有有限墙钟', () => {
  const gen = readGenerationSources(root)
  const resume = gen.slice(gen.indexOf('export async function resumeInterruptedTasks'), gen.indexOf('/** 历史任务探测'))

  // 只测一次：无上游 task_id 的测试任务不自动重提，直接判失败并给出可操作文案
  assert.match(resume, /if \(!record\.taskId \|\| testAgeMs >= CONFIG_TEST_MAX_MS\)/)
  assert.match(resume, /服务重启，生成测试已中断/)
  // 继续取结果走精确配置（不被「同厂商最高优先级」宽松解析换到别的配置）
  assert.match(resume, /getResumeConfigById\(Number\(testParams\.configId\)\)/)
  assert.match(resume, /pollTask\(record, locked, record\.taskId\)/)
  assert.ok(resume.indexOf('isConfigTestParams(testParams)') < resume.indexOf('resolveResumeConfig'), '测试分支必须先于宽松解析')

  // 测试任务轮询挂有限墙钟（图片轮询本无硬墙钟，测试必须有限结束）
  assert.match(gen, /const CONFIG_TEST_MAX_MS = Math\.max\([\d_]+, Number\(process\.env\.AI_CONFIG_TEST_MAX_MS/)
  const poll = gen.slice(gen.indexOf('async function pollTask'))
  assert.match(poll, /if \(configTest && Date\.now\(\) - createdAtMs >= CONFIG_TEST_MAX_MS\)/)
})

test('ai.ts: getResumeConfigById 精确取配置且不过模型调用总开关', () => {
  const ai = read('src/services/ai.ts')
  const fn = ai.slice(ai.indexOf('export async function getResumeConfigById'))
  assert.ok(fn.length > 0)
  assert.match(fn, /eq\(schema\.aiServiceConfigs\.id, id\)/)
  assert.match(fn, /return toAIConfig\(row\)/)
  // 在途任务取结果不受总开关影响（与 getResumeConfig 同语义）
  assert.doesNotMatch(fn, /assertAiCallEnabled/)
})

test('tasks 路由：无项目但落了 user_id 的任务只归本人', () => {
  const route = readTasksRouteSources(new URL('..', import.meta.url))
  // 单任务读/重试/删除共用归属校验
  assert.match(route, /else if \(row\.userId != null && row\.userId !== user\.id\) throw new OwnershipError\(404, '任务不存在'\)/)
  // 列表与云排队对比条件同样收紧（不再放行全部 dramaId IS NULL 行）
  const listBlock = route.slice(route.indexOf("} else {", route.indexOf('// GET /tasks')), route.indexOf('if (type) conds.push'))
  assert.match(listBlock, /\$\{schema\.sysTask\.userId\} IS NULL OR \$\{schema\.sysTask\.userId\} = \$\{user\.id\}/)
  assert.doesNotMatch(listBlock, /or\(isNull\(schema\.sysTask\.dramaId\), inArray/)
  const cloudBlock = route.slice(route.indexOf('const ownerCond'), route.indexOf('const localRows'))
  assert.match(cloudBlock, /\$\{schema\.sysTask\.userId\} IS NULL OR \$\{schema\.sysTask\.userId\} = \$\{user\.id\}/)
})
