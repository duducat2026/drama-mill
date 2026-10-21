import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readUseApiSources } from './helpers/use-api-sources.mjs'

const frontendRoot = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, frontendRoot), 'utf8')

test('userModelPriceAPI：六个用户级价格端点封装，删除走 api.del', () => {
  const api = readUseApiSources(frontendRoot)
  assert.match(api, /export const userModelPriceAPI = \{/)
  assert.match(api, /api\.get\(`\/model-prices\$\{query\.size/)
  assert.match(api, /api\.get\(`\/model-prices\/catalog\$\{query\.size/)
  assert.match(api, /api\.post\('\/model-prices\/import', \{ items \}\)/)
  assert.match(api, /create: \(d: any\) => api\.post\('\/model-prices', d\)/)
  assert.match(api, /update: \(id: number, d: any\) => api\.put\(`\/model-prices\/\$\{id\}`/)
  assert.match(api, /remove: \(id: number\) => api\.del\(`\/model-prices\/\$\{id\}`\)/)
})

test('useUserPrices：模块级单例共享状态 + 模态映射 + 写后强刷', () => {
  const composable = read('app/composables/settings/useUserPrices.js')
  // 面板与 AI 配置编辑器共用一份列表：状态在模块级而非 composable 内
  assert.match(composable, /^const myPrices = ref\(\[\]\)/m)
  assert.match(composable, /BILLING_BY_SERVICE = \{ text: 'token', image: 'image', video: 'video_second' \}/)
  // 计价口径与后端一致：按 model 名匹配
  assert.match(composable, /myPrices\.value\.find\(p => p\.model === model\)/)
  assert.match(composable, /pricesLoaded\.value && !force/)
  for (const fn of ['importPrices', 'createPrice', 'updatePrice', 'removePrice']) {
    assert.match(composable, new RegExp(`${fn}[\\s\\S]{0,120}loadMyPrices\\(true\\)`), `${fn} 写后应强刷`)
  }
})

test('SettingsPricesPanel + settings Tab：我的模型价/导入/自定义/删除回退', () => {
  const panel = read('app/components/settings/SettingsPricesPanel.vue')
  assert.match(panel, /我的模型价/)
  assert.match(panel, /从平台目录导入/)
  assert.match(panel, /自定义价格/)
  assert.match(panel, /loadMyPrices\(\)/)
  assert.match(panel, /userModelPriceAPI\.catalog\(/)
  assert.match(panel, /billingFilters/, '应有模态分组筛选')
  assert.match(panel, /回退平台基准/, '删除应提示回退基准计价')

  const page = read('app/pages/settings.vue')
  assert.match(page, /\{ id: 'prices', label: '模型价格', icon: Coins \}/)
  assert.match(page, /import SettingsPricesPanel from '~\/components\/settings\/SettingsPricesPanel\.vue'/)
  assert.match(page, /<SettingsPricesPanel v-else-if="tab === 'prices'" \/>/)
})
