/*
 * settings.vue「AI 服务配置」列表逻辑 composable（拆分超限文件）。
 * 持有配置列表、服务类型/图标/元信息、服务商模板数据、默认模型、启停/删除与服务 Tab 导航。
 * 通过 useSettingsPage 门面共享给配置编辑器与生成测试逻辑（cfgs / serviceMeta 等被它们复用）。
 */
import { toast } from 'vue-sonner'
import { Cpu, Palette, Star, FileText, Image, Video } from 'lucide-vue-next'
import { aiConfigAPI } from '~/composables/useApi'

// Model Router 按能力分协议（文本 OpenAI Chat 兼容、图片/视频 DashScope 兼容体，均在 /v1 下），
// 实测两个最常踩的坑：把文档里的完整端点当 Base URL、模型标识漏 symbol/ 前缀。
export const MODEL_ROUTER_HINT = 'Base URL 只填站点根，不要把文档里的完整端点粘进来（程序会按类型补 /v1/chat/completions、/v1/images/generations、/v1/videos/generations）；模型标识必须带 symbol/ 前缀（如 qwen/wan3.0-video），且该 Key 需已在控制台「授权管理」勾选过对应模型，否则回 403。'

export const providerPresets = {
  text: {
    gemini: { label: 'Gemini 官方', baseUrl: 'https://generativelanguage.googleapis.com', models: ['gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-3-flash-preview'] },
    openai: { label: 'OpenAI 官方', baseUrl: 'https://api.openai.com', models: ['deepseek-v4-pro', 'gpt-5.6-terra'] },
    dashscope: {
      label: '阿里云百炼（OpenAI 兼容）',
      baseUrl: 'https://ws-chxo3s48ugcpj1h0.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      models: ['qwen3.8-flash', 'qwen3.8-max', 'deepseek-v4-pro', 'deepseek-v4-flash'],
      hint: 'Base URL 中的 workspace ID（ws-…）与区域（cn-beijing）为示例，保存前请替换为您百炼控制台的实际值。',
    },
    'model-router': {
      label: 'Model Router 网关',
      baseUrl: 'https://model-router.edu-aliyun.com',
      models: ['qwen/qwen3.8-flash', 'qwen/qwen3.8-27b', 'qwen/deepseek-v4-pro'],
      hint: MODEL_ROUTER_HINT,
    },
  },
  image: {
    gemini: { label: 'Gemini 官方', baseUrl: 'https://generativelanguage.googleapis.com', models: ['gemini-3-pro-image', 'gemini-3.1-flash-image'] },
    openai: { label: 'OpenAI 官方', baseUrl: 'https://api.openai.com', models: ['gpt-image-2'] },
    dashscope: { label: '百炼 DashScope', baseUrl: 'https://dashscope.aliyuncs.com/api/v1', models: ['wan2.6-image', 'wan2.7-image', 'wan2.7-image-pro'] },
    'model-router': {
      label: 'Model Router 网关',
      baseUrl: 'https://model-router.edu-aliyun.com',
      models: ['qwen/wan2.7-image', 'qwen/wan2.7-image-pro'],
      hint: MODEL_ROUTER_HINT,
    },
  },
  video: {
    volcengine: { label: 'Seedance 2.0 官方', baseUrl: 'https://ark.cn-beijing.volces.com', models: ['doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-mini-260615'] },
    minimax: { label: 'MiniMax H3 官方', baseUrl: 'https://api.minimaxi.com', models: ['MiniMax-H3'] },
    dashscope: { label: '百炼 DashScope', baseUrl: 'https://dashscope.aliyuncs.com/api/v1', models: ['wan3.0-video', 'wan3.0-video-prime', 'wan2.7-t2v', 'wan2.7-i2v'] },
    'model-router': {
      label: 'Model Router 网关',
      baseUrl: 'https://model-router.edu-aliyun.com',
      models: ['qwen/wan3.0-video', 'qwen/wan3.0-video-prime', 'qwen/happyhorse-1.1-t2v', 'qwen/happyhorse-1.1-i2v', 'qwen/happyhorse-1.1-r2v'],
      hint: `${MODEL_ROUTER_HINT} t2v/i2v/r2v 三种模式的素材要求互斥，提交前会按任务素材形态自动换成兼容模型。`,
    },
  },
}

export function useAiConfigs() {
  const route = useRoute()
  const router = useRouter()

  const cfgs = ref([])
  const cfgListLoading = ref(true)
  const cfgListError = ref('')

  const providers = ['gemini', 'openai', 'volcengine', 'minimax', 'dashscope', 'model-router']
  const providerSelectOptions = computed(() => providers.map(p => ({ label: p, value: p })))
  const serviceTypes = [{ type: 'text', label: '文本' }, { type: 'image', label: '图片' }, { type: 'video', label: '视频' }]
  const serviceIcons = { text: FileText, image: Image, video: Video }
  const serviceMeta = {
    text: { label: '文本', desc: '剧本改写、角色场景提取、分镜拆解等 Agent 文本能力' },
    image: { label: '图片', desc: '角色图、场景图与镜头图等静态图像生成' },
    video: { label: '视频', desc: '镜头视频直出生成，默认 wan 系列' },
  }
  const validServiceType = type => serviceTypes.some(st => st.type === type)
  const serviceTab = computed(() => validServiceType(route.query.service) ? route.query.service : 'text')
  const activeServiceTypes = computed(() => serviceTypes.filter(st => st.type === serviceTab.value))
  const cfgServiceType = computed(() => validServiceType(route.params.serviceType) ? route.params.serviceType : 'text')

  function selectServiceTab(type) {
    return router.replace({ path: '/settings', query: { ...route.query, service: type } })
  }
  async function onServiceTabKeydown(event, type) {
    const index = serviceTypes.findIndex(st => st.type === type)
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % serviceTypes.length
    else if (event.key === 'ArrowLeft') next = (index + serviceTypes.length - 1) % serviceTypes.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = serviceTypes.length - 1
    else return
    event.preventDefault()
    const nextType = serviceTypes[next].type
    await selectServiceTab(nextType)
    document.getElementById(`service-tab-${nextType}`)?.focus()
  }
  function backToConfigs() {
    return navigateTo({ path: '/settings', query: { service: cfgServiceType.value } })
  }

  function byType(t) { return cfgs.value.filter(c => c.service_type === t) }
  function countActive(t) { return byType(t).filter(c => c.is_active).length }
  /** 列表行内的密钥掩码（与后端 maskApiKey 同规则），只用于区分多份配置 */
  function maskKey(k) {
    const s = String(k || '')
    if (!s) return ''
    return s.length <= 8 ? '****' : `${s.slice(0, 4)}****${s.slice(-4)}`
  }
  function copyText(val, okMsg = '已复制') {
    if (!val) return
    navigator.clipboard?.writeText(String(val)).then(() => toast.success(okMsg)).catch(() => toast.error('复制失败，请手动选取'))
  }

  // ===== 默认模型选择 =====
  // 默认解析规则与工作台/后端一致：启用配置中优先级最高者的模型列表首位
  function defaultModelOf(type) {
    const active = cfgs.value.filter(c => c.service_type === type && c.is_active)
    if (!active.length) return null
    const top = [...active].sort((a, b) => (b.priority || 0) - (a.priority || 0))[0]
    const first = Array.isArray(top.model) ? top.model[0] : null
    return first ? { configId: top.id, model: first } : null
  }
  function isDefaultModel(type, c, m) {
    const d = defaultModelOf(type)
    return !!d && d.configId === c.id && d.model === m
  }
  const defaultSaving = ref(false)
  async function setDefaultModel(type, c, m) {
    if (defaultSaving.value || isDefaultModel(type, c, m)) return
    defaultSaving.value = true
    try {
      const models = [m, ...(Array.isArray(c.model) ? c.model : []).filter(x => x !== m)]
      const maxPriority = Math.max(0, ...cfgs.value.filter(x => x.service_type === type).map(x => x.priority || 0))
      const payload = { model: models }
      if ((c.priority || 0) < maxPriority) payload.priority = maxPriority + 1
      if (!c.is_active) payload.is_active = true // 停用配置无法成为默认,选择即启用
      await aiConfigAPI.update(c.id, payload)
      toast.success(`默认${serviceMeta[type].label}模型已切换为 ${m}`)
      await loadCfgs()
    } catch (e) {
      toast.error(e.message)
    } finally {
      defaultSaving.value = false
    }
  }
  async function toggleCfg(c) { await aiConfigAPI.update(c.id, { is_active: !c.is_active }); loadCfgs() }
  async function delCfg(id) { await aiConfigAPI.del(id); toast.success('已删除'); loadCfgs() }
  function startAddCfg(t) { return navigateTo(`/settings/ai/${t}/new`) }
  function startEditCfg(c) { return navigateTo(`/settings/ai/${c.service_type}/${c.id}`) }

  async function loadCfgs() {
    cfgListLoading.value = true
    cfgListError.value = ''
    try { cfgs.value = await aiConfigAPI.list() }
    catch (e) { cfgListError.value = e.message || '配置加载失败'; toast.error(cfgListError.value) }
    finally { cfgListLoading.value = false }
  }

  return {
    route, router, Cpu, Palette, Star,
    cfgs, cfgListLoading, cfgListError,
    providers, providerSelectOptions, serviceTypes, serviceIcons, serviceMeta,
    providerPresets, MODEL_ROUTER_HINT, validServiceType,
    serviceTab, activeServiceTypes, cfgServiceType,
    selectServiceTab, onServiceTabKeydown, backToConfigs,
    byType, countActive, maskKey, copyText,
    isDefaultModel, setDefaultModel, toggleCfg, delCfg, startAddCfg, startEditCfg,
    loadCfgs,
  }
}
