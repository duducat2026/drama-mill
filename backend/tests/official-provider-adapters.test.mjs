import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAiConfigRouteSources } from './helpers/aiconfig-route-sources.mjs'
import { readAgentsIndexSources } from './helpers/agents-index-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const routeBlock = (source, route) => {
  const start = source.indexOf(route)
  assert.notEqual(start, -1, `Missing route: ${route}`)
  const next = source.indexOf('\n// ', start + route.length)
  return source.slice(start, next === -1 ? source.length : next)
}

test('backend provider registry only ships official model providers', () => {
  const registry = read('src/services/adapters/registry.ts')
  const ai = read('src/services/ai.ts')
  const aiConfigRoute = readAiConfigRouteSources(root)
  const useApi = read('../frontend/app/composables/useApi.ts')

  assert.doesNotMatch(ai, /openrouter/i)
  assert.doesNotMatch(aiConfigRoute, /openrouter/i)
  assert.doesNotMatch(aiConfigRoute, /\/vendor-preset/)
  assert.doesNotMatch(useApi, /vendorPreset/)
})

test('text agents use the official Gemini provider for gemini configs', () => {
  const agents = readAgentsIndexSources(root)

  assert.match(agents, /createGoogleGenerativeAI/)
  assert.match(agents, /providerName === 'gemini'/)
  assert.match(agents, /googleProvider\(\s*modelName\s*\)/)
})

test('text agents keep OpenAI provider routing for non-Gemini configs', () => {
  const agents = readAgentsIndexSources(root)

  assert.match(agents, /createOpenAI/)
  assert.match(agents, /const provider = createOpenAI\(/)
  assert.match(agents, /return provider\.chat\(modelName\)/)
})

test('text provider base URL handling uses official Gemini v1beta endpoint', () => {
  const ai = read('src/services/ai.ts')

  assert.match(ai, /provider === 'gemini'/)
  assert.match(ai, /return joinProviderUrl\(config\.baseUrl,\s*'\/v1beta',\s*''\)/)
})

test('backend rejects unsupported providers at DB and route boundaries', () => {
  const ai = read('src/services/ai.ts')
  const route = readAiConfigRouteSources(root)

  assert.match(ai, /officialProviders/)
  // 文本新增百炼官方入口（OpenAI 兼容模式），图片/视频既有百炼入口不变
  // Model Router 网关：文本走 OpenAI Chat 兼容、图片/视频走 DashScope 兼容体，三类均已开白名单
  assert.match(ai, /text:\s*\[\s*'openai',\s*'gemini',\s*'volcengine',\s*'dashscope',\s*'model-router'\s*\]/)
  // 后续迭代：图片新增百炼，视频新增 MiniMax / 百炼官方入口
  assert.match(ai, /image:\s*\[\s*'openai',\s*'gemini',\s*'volcengine',\s*'dashscope',\s*'model-router'\s*\]/)
  assert.match(ai, /video:\s*\[\s*'volcengine',\s*'minimax',\s*'dashscope',\s*'model-router'\s*\]/)
  assert.doesNotMatch(ai, /'deepseek'/)
  assert.doesNotMatch(ai, /'ali'/)
  assert.doesNotMatch(ai, /'vidu'/)
  assert.doesNotMatch(ai, /audio:\s*\[/)
  assert.match(ai, /isOfficialProvider/)
  assert.match(ai, /isOfficialProvider\(serviceType,\s*r\.provider\)/)
  assert.match(ai, /isOfficialProvider\(row\.serviceType as ServiceType,\s*row\.provider\)/)

  assert.match(route, /isOfficialProvider/)
  assert.match(route, /isOfficialProvider\(body\.service_type,\s*body\.provider\)/)
  assert.match(route, /isOfficialProvider\(serviceType,\s*provider\)/)
  assert.match(route, /Unsupported service_type\/provider/)
})

test('AI config routes reject unsupported service/provider pairs in create, test, and update paths', () => {
  const route = readAiConfigRouteSources(root)
  const createRoute = routeBlock(route, "app.post('/',")
  const testRoute = routeBlock(route, "app.post('/test',")
  const updateRoute = routeBlock(route, "app.put('/:id',")

  assert.match(createRoute, /if \(!body\.service_type \|\| !body\.provider\)/)
  assert.match(createRoute, /isOfficialProvider\(body\.service_type,\s*body\.provider\)/)
  assert.match(createRoute, /badRequest\(c,\s*'Unsupported service_type\/provider'\)/)

  assert.match(testRoute, /if \(!body\.service_type \|\| !body\.provider \|\| !body\.base_url\)/)
  assert.match(testRoute, /isOfficialProvider\(body\.service_type,\s*body\.provider\)/)
  assert.match(testRoute, /badRequest\(c,\s*'Unsupported service_type\/provider'\)/)

  assert.match(updateRoute, /const serviceType = 'service_type' in body \? body\.service_type : existing\.serviceType/)
  assert.match(updateRoute, /const provider = 'provider' in body \? body\.provider : existing\.provider/)
  assert.doesNotMatch(updateRoute, /body\.service_type \|\| existing\.serviceType/)
  assert.doesNotMatch(updateRoute, /body\.provider \|\| existing\.provider/)
  assert.match(updateRoute, /isOfficialProvider\(serviceType,\s*provider\)/)
  assert.match(updateRoute, /badRequest\(c,\s*'Unsupported service_type\/provider'\)/)
})

test('AI config update route persists service type changes after validation', () => {
  const route = readAiConfigRouteSources(root)
  const updateRoute = routeBlock(route, "app.put('/:id',")

  assert.match(updateRoute, /const updates: Record<string, any> = \{ updatedAt: now\(\) \}/)
  assert.match(updateRoute, /if \('service_type' in body\) updates\.serviceType = body\.service_type/)
  assert.match(updateRoute, /if \('provider' in body\) updates\.provider = body\.provider/)
})

test('AI config probe uses provider-specific auth schemes', () => {
  const route = readAiConfigRouteSources(root)
  const geminiHeadersStart = route.indexOf('function geminiHeaders')
  const buildProbeStart = route.indexOf('function buildProbe')
  const geminiHeaders = route.slice(geminiHeadersStart, buildProbeStart)

  assert.match(geminiHeaders, /x-goog-api-key/)
  assert.doesNotMatch(geminiHeaders, /Authorization\s*=\s*`Bearer/)
  // 探针统一走 generateContent（interactions 端点在中转站普遍未配置，会误报）
  assert.match(route, /gemini-3\.1-pro-preview/)
  assert.match(route, /generateContent/)
  assert.match(route, /function bearerHeaders/)
  assert.match(route, /p === 'openai'/)
  assert.match(route, /p === 'volcengine'/)
  assert.match(route, /'\/chat\/completions'/)
  // 百炼文本探针走 OpenAI 兼容模式 GET /models（base_url 已含 compatible-mode/v1）
  assert.match(route, /joinProviderUrl\(baseUrl, '', '\/models'\)/)
  assert.doesNotMatch(route, /viduHeaders/)
  assert.doesNotMatch(route, /p === 'deepseek'/)
  assert.doesNotMatch(route, /p === 'ali'/)
  assert.doesNotMatch(route, /p === 'vidu'/)
})

test('removed providers no longer ship adapters or webhook routes', () => {
  const registry = read('src/services/adapters/registry.ts')
  const index = read('src/index.ts')

  assert.doesNotMatch(registry, /ali-image|ali-video|vidu-video/)
  assert.doesNotMatch(registry, /AliImageAdapter|AliVideoAdapter|ViduVideoAdapter/)
  assert.doesNotMatch(index, /webhooks/)
})

test('adapter registry fails closed for unsupported providers', () => {
  const registry = read('src/services/adapters/registry.ts')

  assert.match(registry, /Unsupported image provider/)
  assert.match(registry, /Unsupported video provider/)
  assert.doesNotMatch(registry, /\|\|\s*imageAdapters\['minimax'\]/)
  assert.doesNotMatch(registry, /\|\|\s*videoAdapters\['minimax'\]/)
  assert.doesNotMatch(registry, /ttsAdapters/)
})

test('OpenAI image adapter defaults to GPT Image instead of legacy DALL-E', () => {
  const adapter = read('src/services/adapters/openai-image.ts')

  assert.match(adapter, /record\.model\s*\|\|\s*config\.model\s*\|\|\s*'gpt-image-2'/)
  assert.doesNotMatch(adapter, /record\.model\s*\|\|\s*'dall-e-3'/)
})

test('OpenAI image adapter uses GPT Image request shape and keeps DALL-E response format', () => {
  const adapter = read('src/services/adapters/openai-image.ts')

  assert.match(adapter, /model\.startsWith\('gpt-image-'\)/)
  assert.match(adapter, /normalizeGptImageSize/)
  assert.match(adapter, /'1536x1024'/)
  assert.match(adapter, /'1024x1536'/)
  assert.match(adapter, /'1024x1024'/)
  assert.match(adapter, /'auto'/)
  assert.match(adapter, /if \(!isGptImage\)[\s\S]*response_format = 'url'/)
})

test('new image and video models use their current API shapes', () => {
  const openaiImage = read('src/services/adapters/openai-image.ts')
  const geminiImage = read('src/services/adapters/gemini-image.ts')
  const volcVideo = read('src/services/adapters/volcengine-video.ts')

  assert.match(openaiImage, /isGptImage2/)
  assert.match(openaiImage, /normalizeGptImage2Size/)
  assert.match(geminiImage, /isGemini3Image/)
  assert.match(geminiImage, /\/v1beta'[\s\S]*'\/interactions'/)
  assert.match(geminiImage, /response_format/)
  assert.doesNotMatch(geminiImage, /Authorization': `Bearer/)
  assert.match(volcVideo, /DEFAULT_MODEL = 'doubao-seedance-2-0-fast-260128'/)
  // Seedance 2.0 多模态能力
  assert.match(volcVideo, /SEEDANCE2_MODEL_PREFIX/)
  assert.match(volcVideo, /startsWith\(SEEDANCE2_MODEL_PREFIX\)/)
  assert.match(volcVideo, /reference_video/)
  assert.match(volcVideo, /reference_audio/)
  assert.match(volcVideo, /generate_audio:\s*record\.generateAudio/)
})
