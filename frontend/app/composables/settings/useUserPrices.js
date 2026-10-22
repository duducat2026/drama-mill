/**
 * 用户级模型价共享状态 — 「模型价格」面板与 AI 配置编辑器价格块共用一份列表。
 * 计价优先级由后端 cost-price-lookup 决定（用户价 → 平台刊例价），此处只管读写。
 */
import { userModelPriceAPI } from '~/composables/useApi'

export const BILLING_BY_SERVICE = { text: 'token', image: 'image', video: 'video_second' }
export const BILLING_LABELS = { token: '文本 (元/百万Token)', image: '图片 (元/张)', video_second: '视频 (元/秒)' }

/**
 * 模态目录：价格面板分节与目录导入弹窗共用。
 * kicker/unit 是「价目单」节头文案——单位只在节头声明一次，行内只留数字。
 */
export const MODALITIES = [
  { key: 'token', short: '文本', kicker: 'Text · 文本生成', unit: '元 / 百万 Token' },
  { key: 'image', short: '图片', kicker: 'Image · 图片生成', unit: '元 / 张' },
  { key: 'video_second', short: '视频', kicker: 'Video · 视频生成', unit: '元 / 秒' },
]

/**
 * 价格读数：按 4 位有效数字收敛（35.6472→35.65、0.198029→0.198、2.7→2.7），
 * 再削小数尾零——只削小数部分，绝不动整数位（100 不会变成 1）。
 * 目录价是美元按汇率折算的，原样直出会带六位小数噪声，看着像随机数。
 */
export function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  // ≥1000 保留两位小数（大额价削成 4 位有效数字会丢掉分），其余按有效数字收敛
  let s = n >= 1000 ? n.toFixed(2) : n.toPrecision(4)
  if (s.includes('e')) s = n.toFixed(6)
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

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
