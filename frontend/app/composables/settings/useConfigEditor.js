/*
 * settings.vue「AI 配置编辑器」逻辑 composable（拆分超限文件）。
 * 独立表单页（/settings/ai/:serviceType/:configId）的加载/保存/连通测试；
 * 复用 useAiConfigs 暴露的 route/router/serviceMeta/providerPresets/validServiceType/backToConfigs。
 */
import { toast } from 'vue-sonner'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { aiConfigAPI } from '~/composables/useApi'

export function useConfigEditor(cfgApi) {
  const { route, router, serviceMeta, providerPresets, validServiceType, backToConfigs } = cfgApi

  const cfgLoading = ref(true)
  const cfgLoadError = ref('')
  const cfgReady = ref(false)
  const cfgSaving = ref(false)
  const cfgBaseline = ref('')
  const cfgEditId = ref(null)
  const cfgTesting = ref(false)
  const cfgTestResult = ref(null)
  let cfgTestRound = 0
  let cfgDisposed = false
  const cfgForm = reactive({ name: '', provider: '', api_key: '', base_url: '', modelStr: '', service_type: 'text', priority: 0, temperature: '' })
  const cfgDirty = computed(() => cfgReady.value && JSON.stringify(cfgForm) !== cfgBaseline.value)
  // API Key 默认密文显示，点眼睛才明文（避免旁边有人屏幕时泄露，也便于核对多复制的空格/少一位）
  const apiKeyVisible = ref(false)

  function presetsByType(type) {
    const group = providerPresets[type] || {}
    return Object.entries(group).map(([provider, preset]) => ({ provider, ...preset }))
  }
  // 当前所选服务商模板的填写提示（如百炼文本模板需替换 workspace ID 与区域）
  const presetHint = computed(() => providerPresets[cfgForm.service_type]?.[cfgForm.provider]?.hint || '')
  function applyProviderPreset(type, provider) {
    const preset = providerPresets[type]?.[provider]
    if (!preset) return
    cfgForm.provider = provider
    cfgForm.base_url = preset.baseUrl
    cfgForm.modelStr = preset.models.join(', ')
    cfgForm.name = `${preset.label}-${serviceMeta[type].label}`
  }

  function confirmLeaveCfg(to, from) {
    if (to.path === from.path) return true
    if (cfgSaving.value) { toast.warning('配置正在保存，请稍候'); return false }
    return !cfgDirty.value || window.confirm('配置尚未保存，确定放弃更改并离开？')
  }
  onBeforeRouteLeave(confirmLeaveCfg)
  onBeforeRouteUpdate(confirmLeaveCfg)
  function warnBeforeUnload(event) {
    if (!cfgDirty.value && !cfgSaving.value) return
    event.preventDefault()
    event.returnValue = ''
  }

  async function loadCfgEditor() {
    cfgLoading.value = true
    cfgLoadError.value = ''
    cfgReady.value = false
    cfgEditId.value = null
    cfgTestResult.value = null
    apiKeyVisible.value = false
    const type = route.params.serviceType
    const id = route.params.configId
    try {
      if (!validServiceType(type) || (id !== 'new' && !/^[1-9]\d*$/.test(String(id)))) {
        throw new Error('配置页面地址无效，请返回配置列表。')
      }
      if (id === 'new') {
        Object.assign(cfgForm, { name: '', provider: '', api_key: '', base_url: '', modelStr: '', service_type: type, priority: 0, temperature: '' })
        const firstPreset = presetsByType(type)[0]
        if (firstPreset) applyProviderPreset(type, firstPreset.provider)
      } else {
        const configs = await aiConfigAPI.list(type)
        if (cfgDisposed) return
        const c = configs.find(c => String(c.id) === id && c.service_type === type)
        if (!c) throw new Error('配置不存在、已被删除或无权访问，请返回配置列表。')
        cfgEditId.value = c.id
        Object.assign(cfgForm, {
          name: c.name || '', provider: c.provider, api_key: c.api_key || '',
          base_url: c.base_url || '', modelStr: Array.isArray(c.model) ? c.model.join(', ') : c.model || '',
          service_type: c.service_type, priority: c.priority ?? 0, temperature: c.temperature ?? '',
        })
      }
      cfgBaseline.value = JSON.stringify(cfgForm)
      cfgReady.value = true
    } catch (e) {
      cfgLoadError.value = e.message || '配置加载失败，请重试。'
    } finally {
      cfgLoading.value = false
    }
    // 连通入口只消费一次测试指令，刷新编辑页不会重复发起模型探测。
    if (cfgReady.value && route.query.probe === '1') {
      const { probe, ...query } = route.query
      await router.replace({ path: route.path, query })
      if (!cfgDisposed) await testDraftCfg()
    }
  }
  watch(cfgForm, () => { cfgTestRound++; cfgTesting.value = false; cfgTestResult.value = null }, { flush: 'sync' })

  async function testCfgPayload(payload) {
    if (cfgTesting.value || cfgSaving.value || !cfgReady.value) return
    const round = ++cfgTestRound
    cfgTesting.value = true
    cfgTestResult.value = null
    try {
      const result = await aiConfigAPI.test(payload)
      if (round !== cfgTestRound || cfgDisposed) return
      cfgTestResult.value = result
      if (cfgTestResult.value.reachable) toast.success('端点已响应')
      else toast.warning('端点未通过测试')
    } catch (e) {
      if (round === cfgTestRound && !cfgDisposed) toast.error(e.message)
    } finally {
      if (round === cfgTestRound) cfgTesting.value = false
    }
  }
  async function testDraftCfg() {
    await testCfgPayload({
      service_type: cfgForm.service_type,
      provider: cfgForm.provider,
      api_key: cfgForm.api_key,
      base_url: cfgForm.base_url,
      model: cfgForm.modelStr.split(',').map(s => s.trim()).filter(Boolean),
    })
  }
  function testExistingCfg(c) {
    return navigateTo({ path: `/settings/ai/${c.service_type}/${c.id}`, query: { probe: '1' } })
  }

  async function saveCfg() {
    if (cfgSaving.value || !cfgReady.value) return
    if (!cfgForm.provider) { toast.warning('选择服务商'); return }
    const models = cfgForm.modelStr.split(',').map(s => s.trim()).filter(Boolean)
    const temperature = cfgForm.temperature === '' || cfgForm.temperature === null ? null : Number(cfgForm.temperature)
    if (temperature !== null && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
      toast.warning('Temperature 需为 0~2 的数字'); return
    }
    cfgSaving.value = true
    try {
      if (cfgEditId.value) await aiConfigAPI.update(cfgEditId.value, { name: cfgForm.name, provider: cfgForm.provider, api_key: cfgForm.api_key, base_url: cfgForm.base_url, model: models, priority: cfgForm.priority, temperature })
      else await aiConfigAPI.create({ service_type: cfgForm.service_type, provider: cfgForm.provider, name: cfgForm.name || `${cfgForm.provider}-${cfgForm.service_type}`, api_key: cfgForm.api_key, base_url: cfgForm.base_url, model: models, priority: cfgForm.priority, temperature })
      cfgBaseline.value = JSON.stringify(cfgForm)
      cfgSaving.value = false
      toast.success('已保存')
      await backToConfigs()
    } catch (e) { toast.error(e.message) }
    finally { cfgSaving.value = false }
  }

  onMounted(() => { window.addEventListener('beforeunload', warnBeforeUnload) })
  onBeforeUnmount(() => {
    cfgDisposed = true
    cfgTestRound++
    window.removeEventListener('beforeunload', warnBeforeUnload)
  })

  return {
    cfgLoading, cfgLoadError, cfgReady, cfgSaving, cfgEditId, cfgTesting, cfgTestResult,
    cfgForm, cfgDirty, apiKeyVisible, presetsByType, presetHint, applyProviderPreset,
    loadCfgEditor, saveCfg, testDraftCfg, testExistingCfg, confirmLeaveCfg,
  }
}
