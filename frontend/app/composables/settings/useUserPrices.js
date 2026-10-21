/**
 * 用户级模型价共享状态 — 「模型价格」面板与 AI 配置编辑器价格块共用一份列表。
 * 计价优先级由后端 cost-price-lookup 决定（用户价 → 平台刊例价），此处只管读写。
 */
import { userModelPriceAPI } from '~/composables/useApi'

export const BILLING_BY_SERVICE = { text: 'token', image: 'image', video: 'video_second' }
export const BILLING_LABELS = { token: '文本 (元/百万Token)', image: '图片 (元/张)', video_second: '视频 (元/秒)' }

const myPrices = ref([])
const pricesLoaded = ref(false)

export function useUserPrices() {
  async function loadMyPrices(force = false) {
    if (pricesLoaded.value && !force) return myPrices.value
    try {
      myPrices.value = (await userModelPriceAPI.list()) || []
      pricesLoaded.value = true
    } catch { myPrices.value = [] }
    return myPrices.value
  }

  /** 按服务类型（text/image/video）取我的价格行 */
  function pricesOfService(serviceType) {
    const bt = BILLING_BY_SERVICE[serviceType]
    return myPrices.value.filter(p => p.billing_type === bt)
  }

  /** 模型名 → 我的价格行（与后端计价口径一致：按 model 名匹配） */
  function priceOf(model) {
    return myPrices.value.find(p => p.model === model) || null
  }

  async function importPrices(items) {
    const r = await userModelPriceAPI.import(items)
    await loadMyPrices(true)
    return r
  }

  async function createPrice(payload) {
    const r = await userModelPriceAPI.create(payload)
    await loadMyPrices(true)
    return r
  }

  async function updatePrice(id, payload) {
    const r = await userModelPriceAPI.update(id, payload)
    await loadMyPrices(true)
    return r
  }

  async function removePrice(id) {
    const r = await userModelPriceAPI.remove(id)
    await loadMyPrices(true)
    return r
  }

  return {
    myPrices, pricesLoaded, loadMyPrices,
    pricesOfService, priceOf,
    importPrices, createPrice, updatePrice, removePrice,
  }
}
