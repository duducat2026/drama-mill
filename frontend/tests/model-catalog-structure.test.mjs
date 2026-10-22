import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readModelCatalogPageSources } from './helpers/model-catalog-page-sources.mjs'
import { readUseApiSources } from './helpers/use-api-sources.mjs'

const frontendRoot = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, frontendRoot), 'utf8')

test('模型目录价前端：菜单入口 + API 封装 + 单列表计价依托页', () => {
  // 后台侧栏新增「模型目录价」入口
  const nav = read('app/layouts/admin.vue')
  assert.match(nav, /\/admin\/model-catalog/, '菜单缺路径')
  assert.match(nav, /模型目录价/, '菜单缺标签')

  // adminAPI 暴露：概览 + 价格分页 + 批量删除（模型清单/明细、刊例价导入与独立增改均已下线）
  const api = readUseApiSources(frontendRoot)
  assert.match(api, /modelCatalogStats: \(\) => api\.get\('\/admin\/model-catalog\/stats'\)/)
  assert.match(api, /modelCatalogPrices: \(params\?: any\) => api\.get\(`\/admin\/model-catalog\/prices/)
  assert.match(api, /modelCatalogBatchDelete: \(ids: number\[\]\) => api\.post\('\/admin\/model-catalog\/batch-delete', \{ ids \}\)/)
  assert.doesNotMatch(api, /modelCatalogModels|modelCatalogPricesOf/, '模型清单/明细 API 应已删除')
  assert.doesNotMatch(api, /createModelPrice|updateModelPrice/, '刊例价独立增改 API 应已删除')
  assert.doesNotMatch(api, /importModelCatalog|modelPrices:/, '目录价即刊例价：导入 API 与 admin 刊例价查询应已删除')

  // 页面：单价格列表 + 检索分页 + 目录不可用告警 + 复选框批量删除
  const page = readModelCatalogPageSources(frontendRoot)
  assert.match(page, /definePageMeta\(\{ layout: 'admin' \}\)/)
  assert.match(page, /模型价格列表/)
  assert.match(page, /主库目录表（model_catalog_\*，随仓库快照 docker\/model-catalog-data\.sql 初始化）/)
  assert.doesNotMatch(page, /model_list/, '页面不应再出现 model_list 运行时字样')
  assert.doesNotMatch(page, /模型清单|mc-tab/, '双 Tab（模型清单）应已移除')
  assert.match(page, /adminAPI\.modelCatalogStats\(\)/)
  assert.match(page, /adminAPI\.modelCatalogPrices\(/)
  assert.match(page, /catalogError/, '缺目录库不可达告警')
  // 批量删除：全选/行内复选框 + 确认 + 调用 API
  assert.match(page, /批量删除/)
  assert.match(page, /function toggleAll\(\)/)
  assert.match(page, /adminAPI\.modelCatalogBatchDelete\(\[\.\.\.selected\.value\]\)/)
  // 计价定位文案：目录价即刊例价，AI 成本计价实时依托本目录
  assert.match(page, /目录价即刊例价/)
  assert.match(page, /后台 AI 成本计价实时依托本目录/)
  // 导入弹窗/按钮已随「目录价即刊例价」整合下线
  assert.doesNotMatch(page, /导入到平台刊例价|ModelCatalogImportModal|importModelCatalog/, '导入能力应已移除')
})
