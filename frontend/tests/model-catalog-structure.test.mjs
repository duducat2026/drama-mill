import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readModelCatalogPageSources } from './helpers/model-catalog-page-sources.mjs'
import { readUseApiSources } from './helpers/use-api-sources.mjs'

const frontendRoot = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, frontendRoot), 'utf8')

test('模型目录价前端：菜单入口 + API 封装 + 双 Tab 只读检索页', () => {
  // 后台侧栏新增「模型目录价」入口
  const nav = read('app/layouts/admin.vue')
  assert.match(nav, /\/admin\/model-catalog/, '菜单缺路径')
  assert.match(nav, /模型目录价/, '菜单缺标签')

  // adminAPI 暴露四个只读端点
  const api = readUseApiSources(frontendRoot)
  assert.match(api, /modelCatalogStats: \(\) => api\.get\('\/admin\/model-catalog\/stats'\)/)
  assert.match(api, /modelCatalogModels: \(params\?: any\) => api\.get\(`\/admin\/model-catalog\/models/)
  assert.match(api, /modelCatalogPrices: \(params\?: any\) => api\.get\(`\/admin\/model-catalog\/prices/)
  assert.match(api, /modelCatalogPricesOf: \(modelId: string\)/)
  assert.match(api, /importModelCatalog: \(d: \{ usd_rate\?: number; dry_run\?: boolean \}\) => api\.post\('\/admin\/model-catalog\/import'/)

  // 页面：双 Tab + 检索分页 + 目录库不可达告警 + 导入按钮/预览弹窗
  const page = readModelCatalogPageSources(frontendRoot)
  assert.match(page, /definePageMeta\(\{ layout: 'admin' \}\)/)
  assert.match(page, /模型清单/)
  assert.match(page, /模型价格列表/)
  assert.match(page, /主库目录表（model_catalog_\*，随仓库快照 docker\/model-catalog-data\.sql 初始化）/)
  assert.doesNotMatch(page, /model_list/, '页面不应再出现 model_list 运行时字样')
  assert.match(page, /adminAPI\.modelCatalogStats\(\)/)
  assert.match(page, /adminAPI\.modelCatalogModels\(/)
  assert.match(page, /adminAPI\.modelCatalogPrices\(/)
  assert.match(page, /catalogError/, '缺目录库不可达告警')
  // 导入到平台：按钮 + dry-run 预览 + 确认导入
  assert.match(page, /导入到平台刊例价/)
  assert.match(page, /adminAPI\.importModelCatalog\(\{ usd_rate: usdRate\.value, dry_run: true \}\)/)
  assert.match(page, /adminAPI\.importModelCatalog\(\{ usd_rate: usdRate\.value, dry_run: false \}\)/)
})
