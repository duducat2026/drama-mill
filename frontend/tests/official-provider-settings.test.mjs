import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { ref, reactive, computed, watch } from 'vue'
import { readUseApiSources } from './helpers/use-api-sources.mjs'
import { readSettingsSources } from './helpers/settings-page-sources.mjs'

const frontendRoot = new URL('..', import.meta.url)
const settingsPage = readSettingsSources(frontendRoot)
const useApi = readUseApiSources(new URL('..', import.meta.url))

// 拆分后配置逻辑落在 composable 里：读取源码、剥离 import、解除 export，交由 VM 组合执行。
function composableBody(path) {
  return readFileSync(new URL(path, frontendRoot), 'utf8')
    .replace(/^import [^\n]*$/gm, '')
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
}

function providerPresetBlock(serviceType) {
  const presetsStart = settingsPage.indexOf('const providerPresets = {')
  assert.notEqual(presetsStart, -1, 'missing providerPresets')
  const marker = `  ${serviceType}: {`
  const start = settingsPage.indexOf(marker, presetsStart)
  assert.notEqual(start, -1, `missing ${serviceType} provider presets`)
  const end = settingsPage.indexOf('\n  },', start)
  assert.notEqual(end, -1, `unterminated ${serviceType} provider presets`)
  return settingsPage.slice(start, end)
}

test('settings page exposes official provider templates only', () => {
  assert.doesNotMatch(settingsPage, /openrouter/i)
  assert.doesNotMatch(settingsPage, /vendorPreset/i)
  assert.doesNotMatch(settingsPage, /applyVendorPreset/i)
  assert.doesNotMatch(settingsPage, /\/vendor-preset/)
  assert.doesNotMatch(useApi, /applyVendorPreset/i)
  assert.doesNotMatch(useApi, /openrouter/i)
  assert.doesNotMatch(useApi, /vendorPreset/i)
  assert.doesNotMatch(useApi, /\/vendor-preset/)

  // 官方厂商模板：Gemini / OpenAI / 火山 / MiniMax / 百炼 DashScope / Model Router 网关
  assert.match(settingsPage, /const providers = \['gemini', 'openai', 'volcengine', 'minimax', 'dashscope', 'model-router'\]/)
  assert.match(settingsPage, /https:\/\/generativelanguage\.googleapis\.com/)
  assert.match(settingsPage, /https:\/\/api\.openai\.com/)
  assert.match(settingsPage, /https:\/\/ark\.cn-beijing\.volces\.com/)
  assert.match(settingsPage, /https:\/\/dashscope\.aliyuncs\.com\/api\/v1/)
  assert.match(settingsPage, /https:\/\/model-router\.edu-aliyun\.com/)
  assert.doesNotMatch(settingsPage, /https:\/\/api\.vidu\.com/)
  // 内置厂商快捷配置（含历史专属工作空间网关）已移除，网关由用户在配置中自行填写
  assert.doesNotMatch(settingsPage, /快捷配置/)
  assert.doesNotMatch(settingsPage, /applyQuickConfig/)
  assert.doesNotMatch(settingsPage, /ws-q0bib4vlqsc95zp1/)
})

test('settings page offers official default model IDs', () => {
  assert.match(settingsPage, /gemini-3\.1-pro-preview/)
  assert.match(settingsPage, /gemini-3\.5-flash/)
  assert.match(settingsPage, /gemini-3-flash-preview/)
  assert.match(settingsPage, /gpt-5\.6-terra/)
  assert.match(settingsPage, /deepseek-v4-pro/)
  assert.match(settingsPage, /gemini-3-pro-image/)
  assert.match(settingsPage, /gemini-3\.1-flash-image/)
  assert.match(settingsPage, /gpt-image-2/)
  assert.match(settingsPage, /doubao-seedance-2-0-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-fast-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-mini-260615/)
  // 百炼 Wan 系列（后续迭代新增）
  assert.match(settingsPage, /wan2\.6-image/)
  assert.match(settingsPage, /wan2\.7-t2v/)
  assert.match(settingsPage, /wan2\.7-i2v/)
  // 百炼文本官方模板（OpenAI 兼容模式）推荐模型
  assert.match(settingsPage, /qwen3\.8-flash/)
  assert.match(settingsPage, /qwen3\.8-max/)
  assert.match(settingsPage, /deepseek-v4-flash/)
  assert.match(settingsPage, /compatible-mode\/v1/)
  assert.doesNotMatch(settingsPage, /gpt-5\.4/)
  assert.doesNotMatch(settingsPage, /doubao-seed-1-6/)
  assert.doesNotMatch(settingsPage, /wan2\.6-t2i/)
  assert.doesNotMatch(settingsPage, /wan2\.6-i2v-flash/)
  assert.doesNotMatch(settingsPage, /viduq3-turbo/)
  assert.doesNotMatch(settingsPage, /viduq3-pro/)
  assert.doesNotMatch(settingsPage, /gemini-2\.5-flash/)
  assert.doesNotMatch(settingsPage, /gpt-4\.1-mini/)
  assert.doesNotMatch(settingsPage, /gpt-image-1/)
  assert.doesNotMatch(settingsPage, /gemini-3-pro-image-preview/)
  assert.doesNotMatch(settingsPage, /gemini-3\.1-flash-image-preview/)
  assert.doesNotMatch(settingsPage, /doubao-seedream/)
  assert.doesNotMatch(settingsPage, /speech-2\.8-hd/)
})

test('Model Router 网关模板：三类齐全 + Base URL 只填站点根 + 模型带 symbol/ 前缀', () => {
  // 实测踩过的两个坑：把文档里的 /v1/responses 粘进 Base URL（拼成双前缀 404）、模型不带 qwen/ 前缀（400 invalid model format）
  for (const type of ['text', 'image', 'video']) {
    const block = providerPresetBlock(type)
    assert.match(block, /'model-router': \{[\s\S]*?baseUrl: 'https:\/\/model-router\.edu-aliyun\.com'/)
    assert.match(block, /hint: `?\$?\{?MODEL_ROUTER_HINT/)
  }
  assert.match(settingsPage, /const MODEL_ROUTER_HINT = 'Base URL 只填站点根/)
  assert.match(settingsPage, /模型标识必须带 symbol\/ 前缀/)
  assert.match(settingsPage, /const providers = \[[^\]]*'model-router'\]/)
  // 前缀写进模板模型列表，用户照抄即可用
  assert.match(providerPresetBlock('text'), /'qwen\/qwen3\.8-flash'/)
  assert.match(providerPresetBlock('image'), /'qwen\/wan2\.7-image'/)
  assert.match(providerPresetBlock('video'), /'qwen\/wan3\.0-video'/)
  assert.match(providerPresetBlock('video'), /'qwen\/happyhorse-1\.1-i2v'/)
  // 视频模板额外说明 t2v/i2v/r2v 素材要求互斥（选模阶段会自动换兼容模型）
  assert.match(providerPresetBlock('video'), /t2v\/i2v\/r2v 三种模式的素材要求互斥/)
})

test('only text service configs expose the connection test button', () => {
  assert.match(settingsPage, /v-if="st\.type === 'text'" class="btn btn-ghost btn-sm" @click="testExistingCfg\(c\)">连通/)
})

test('settings page only offers official provider presets', () => {
  // 文本：Gemini / OpenAI / 百炼官方模板，无 minimax
  assert.doesNotMatch(providerPresetBlock('text'), /minimax/i)
  assert.match(providerPresetBlock('text'), /dashscope/)
  // 百炼文本模板提示用户替换 workspace ID 与区域
  assert.match(providerPresetBlock('text'), /workspace ID/)
  assert.match(providerPresetBlock('text'), /区域/)
  // 图片：Gemini / OpenAI / 百炼，无 vidu
  assert.doesNotMatch(providerPresetBlock('image'), /vidu/i)
  assert.match(providerPresetBlock('image'), /dashscope/)
  // 视频：火山 / MiniMax / 百炼
  assert.match(providerPresetBlock('video'), /volcengine/)
  assert.match(providerPresetBlock('video'), /dashscope/)
  assert.doesNotMatch(providerPresetBlock('video'), /vidu/)
  assert.doesNotMatch(settingsPage, /audio:\s*\{/)
})

function mountConfigLogic({ type = 'text', id = 'new', configs = [], api = {}, query = {} } = {}) {
  const route = reactive({ name: 'ai-config-editor', path: `/settings/ai/${type}/${id}`, params: { serviceType: type, configId: id }, query })
  const navigations = [], writes = [], messages = []
  const icons = Object.fromEntries('Plus Pencil Trash2 Loader2 Cpu Palette Star Power AlertTriangle TimerReset Eye EyeOff Copy ArrowLeft FileText Image Video'.split(' ').map(name => [name, name]))
  // 配置逻辑拆分进 useAiConfigs + useConfigEditor：VM 内按门面顺序组合，再暴露测试所需字段。
  const body = `
    ${composableBody('app/composables/settings/useAiConfigs.js')}
    ${composableBody('app/composables/settings/useConfigEditor.js')}
    const __cfgApi = useAiConfigs()
    const s = { ...__cfgApi, ...useConfigEditor(__cfgApi) }
    return {
      cfgForm: s.cfgForm, cfgEditId: s.cfgEditId, cfgReady: s.cfgReady, cfgLoadError: s.cfgLoadError,
      cfgDirty: s.cfgDirty, cfgSaving: s.cfgSaving, cfgs: s.cfgs, apiKeyVisible: s.apiKeyVisible,
      cfgTesting: s.cfgTesting, cfgTestResult: s.cfgTestResult, serviceTab: s.serviceTab,
      activeServiceTypes: s.activeServiceTypes, loadCfgEditor: s.loadCfgEditor, saveCfg: s.saveCfg,
      startAddCfg: s.startAddCfg, startEditCfg: s.startEditCfg, backToConfigs: s.backToConfigs,
      confirmLeaveCfg: s.confirmLeaveCfg, testDraftCfg: s.testDraftCfg,
      selectServiceTab: s.selectServiceTab, isDefaultModel: s.isDefaultModel,
    }
  `
  const state = runInNewContext(`(() => { ${body} })()`, {
    ...icons, ref, reactive, computed, watch,
    definePageMeta() {}, onMounted() {}, onBeforeUnmount() {}, onBeforeRouteLeave() {}, onBeforeRouteUpdate() {},
    useRoute: () => route,
    useRouter: () => ({ replace: async target => { navigations.push(target); route.query = target.query } }),
    navigateTo: async target => { navigations.push(target) },
    useAuth: () => ({ isAdmin: ref(false) }),
    useAiSwitch: () => ({ aiCallEnabled: ref(true) }),
    useWatchdogSwitch: () => ({ watchdogs: {}, watchdogItems: [] }),
    document: { getElementById: () => null },
    toast: Object.fromEntries(['warning', 'error', 'success'].map(key => [key, message => messages.push(message)])),
    window: { confirm: () => false },
    aiConfigAPI: {
      list: async () => configs,
      create: async payload => writes.push({ kind: 'create', payload }),
      update: async (id, payload) => writes.push({ kind: 'update', id, payload }),
      ...api,
    },
  })
  return { ...state, route, navigations, writes, messages }
}

const savedConfig = { id: 42, service_type: 'image', name: '已有图片服务', provider: 'openai', api_key: 'test-only-key', base_url: 'https://example.invalid', model: ['model-a', 'model-b'], priority: 7, temperature: null }

test('三类 Tab 只显示当前类型，选择保存在 URL，新增编辑使用独立路由', async () => {
  const s = mountConfigLogic({ query: { service: 'image' } })
  assert.equal(s.serviceTab.value, 'image')
  assert.equal(s.activeServiceTypes.value.length, 1)
  await s.selectServiceTab('video')
  assert.equal(s.activeServiceTypes.value[0].type, 'video')
  await s.startAddCfg('video')
  await s.startEditCfg(savedConfig)
  assert.deepEqual(s.navigations.slice(-2), ['/settings/ai/video/new', '/settings/ai/image/42'])
  s.route.query.service = 'invalid'
  assert.equal(s.serviceTab.value, 'text')
  assert.match(settingsPage, /role="tablist"[\s\S]*?role="tab"/)
  assert.match(settingsPage, /@keydown="onServiceTabKeydown/)
  assert.doesNotMatch(settingsPage, /cfgDialog/)
  const nuxt = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
  assert.match(nuxt, /name: 'ai-config-editor',[\s\S]*?path: '\/settings\/ai\/:serviceType\/:configId'/)
})

test('三类新增均初始化模板，保存后返回所属 Tab 且不会意外更新', async () => {
  for (const type of ['text', 'image', 'video']) {
    const s = mountConfigLogic({ type })
    await s.loadCfgEditor()
    assert.equal(s.cfgReady.value, true)
    assert.equal(s.cfgDirty.value, false)
    assert.equal(s.cfgForm.service_type, type)
    assert.ok(s.cfgForm.modelStr)
    s.cfgForm.name = '新增测试配置'
    await s.saveCfg()
    assert.equal(s.writes.length, 1)
    assert.equal(s.writes[0].kind, 'create')
    assert.equal(s.writes[0].payload.service_type, type)
    assert.equal(s.navigations.at(-1).query.service, type)
    assert.equal(s.cfgDirty.value, false)
  }
})

test('编辑可按地址重新加载，保留密钥和模型顺序，保存走更新接口', async () => {
  const s = mountConfigLogic({ type: 'image', id: '42', configs: [savedConfig] })
  s.apiKeyVisible.value = true
  await s.loadCfgEditor()
  assert.equal(s.apiKeyVisible.value, false)
  assert.equal(s.cfgForm.api_key, savedConfig.api_key)
  assert.equal(s.cfgForm.modelStr, 'model-a, model-b')
  assert.equal(s.cfgForm.priority, 7)
  assert.equal(s.cfgDirty.value, false)
  s.cfgForm.name = '修改后的名称'
  assert.equal(s.confirmLeaveCfg({ path: '/settings' }, s.route), false)
  await s.saveCfg()
  assert.equal(s.writes[0].kind, 'update')
  assert.equal(s.writes[0].id, 42)
  assert.equal(s.writes[0].payload.name, '修改后的名称')
  assert.equal(s.writes[0].payload.model.join(','), 'model-a,model-b')
  assert.equal(s.navigations.at(-1).query.service, 'image')
  assert.equal(s.confirmLeaveCfg({ path: '/settings' }, s.route), true)
})

test('失效地址、无权配置和加载失败不渲染可保存的空表单', async () => {
  for (const options of [
    { type: 'audio' }, { id: 'bad' }, { id: '404' },
    { type: 'video', id: '42', configs: [savedConfig] },
    { id: '42', api: { list: async () => { throw new Error('网络不可用') } } },
  ]) {
    const s = mountConfigLogic(options)
    await s.loadCfgEditor()
    assert.equal(s.cfgReady.value, false)
    assert.ok(s.cfgLoadError.value)
    await s.saveCfg()
    assert.equal(s.writes.length, 0)
  }
})

test('重复保存被拦截，失败保留草稿，不跳回列表', async () => {
  let rejectSave, requests = 0
  const s = mountConfigLogic({ api: { create: () => { requests++; return new Promise((_, reject) => { rejectSave = reject }) } } })
  await s.loadCfgEditor()
  s.cfgForm.name = '未保存的草稿'
  const saving = s.saveCfg()
  assert.equal(s.cfgSaving.value, true)
  await s.saveCfg()
  assert.equal(requests, 1)
  assert.equal(s.confirmLeaveCfg({ path: '/settings' }, s.route), false)
  rejectSave(new Error('保存失败'))
  await saving
  assert.equal(s.cfgSaving.value, false)
  assert.equal(s.cfgDirty.value, true)
  assert.equal(s.cfgForm.name, '未保存的草稿')
  assert.equal(s.navigations.length, 0)
})

test('修改表单使旧测试响应失效，不显示旧配置的测试结果', async () => {
  let resolveTest
  const s = mountConfigLogic({ api: { test: () => new Promise(resolve => { resolveTest = resolve }) } })
  await s.loadCfgEditor()
  const testing = s.testDraftCfg()
  assert.equal(s.cfgTesting.value, true)
  s.cfgForm.base_url = 'https://changed.invalid'
  resolveTest({ reachable: true })
  await testing
  assert.equal(s.cfgTestResult.value, null)
  assert.equal(s.cfgTesting.value, false)
})

test('连通测试入口只消费一次指令，刷新不会重复调用', async () => {
  let tests = 0
  const s = mountConfigLogic({ type: 'image', id: '42', configs: [savedConfig], query: { probe: '1' }, api: { test: async () => { tests++; return { reachable: true } } } })
  await s.loadCfgEditor()
  assert.equal(tests, 1)
  assert.equal(s.route.query.probe, undefined)
  await s.loadCfgEditor()
  assert.equal(tests, 1)
})
