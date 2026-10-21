import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const frontendRoot = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, frontendRoot), 'utf8')

test('CfgEditor 集成：模型字段下方挂载价格块，仅透传 service_type/modelStr/provider，不碰 ai_configs 保存链路', () => {
  const editor = read('app/components/settings/SettingsCfgEditor.vue')
  assert.match(editor, /import SettingsCfgPriceBlock from '~\/components\/settings\/SettingsCfgPriceBlock\.vue'/)
  // 挂载点紧跟「模型（逗号分隔）」字段之后
  const modelIdx = editor.indexOf('cfgForm.modelStr" class="textarea')
  const blockIdx = editor.indexOf('<SettingsCfgPriceBlock')
  assert.ok(modelIdx > 0 && blockIdx > modelIdx, '价格块应在模型字段下方')
  assert.match(editor, /:service-type="cfgServiceType" :model-str="cfgForm\.modelStr" :provider="cfgForm\.provider"/)
  // 保存配置逻辑不变：价格绑定由 user_model_prices 承载，saveCfg 仍来自 settings-ctx
  assert.match(editor, /saveCfg, testDraftCfg, backToConfigs,/)
  assert.doesNotMatch(editor, /userModelPriceAPI|createPrice/, '编辑器本体不应直接写价格表')
})

test('SettingsCfgPriceBlock：逐模型绑定价展示 + 计价缺口标注 + 选取/新增双入口', () => {
  const block = read('app/components/settings/SettingsCfgPriceBlock.vue')
  // 解析逗号分隔模型列表（兼容中文逗号/空白）
  assert.match(block, /split\(\/\[,，\\s\]\+\//)
  // 三级状态：已绑定价 → 平台基准未绑定 → 计价缺口（tag-error 红色标注）
  assert.match(block, /priceOf\(m\)/)
  assert.match(block, /基准 .*· 未绑定/)
  assert.match(block, /tag tag-error">计价缺口</)
  // 选取：BaseSelect 列出同模态已有价格行（pricesOfService）
  assert.match(block, /placeholder="选取已有价"/)
  assert.match(block, /pricesOfService\(props\.serviceType\)/)
  assert.match(block, /async function reuse\(m, picked\)/)
  // 新增：行内迷你表单，默认计费类型跟随当前栏模态
  assert.match(block, /const bt = BILLING_BY_SERVICE\[props\.serviceType\]/)
  assert.match(block, /async function doAdd\(m\)/)
  // 基准价预填：按模型名调 catalog 查询
  assert.match(block, /userModelPriceAPI\.catalog\(\{ billing_type: bt, keyword: m/)
  assert.match(block, /function prefill\(base\)/)
  // 写入均走共享 composable 的 createPrice（写后自动强刷列表）
  assert.match(block, /await createPrice\(\{/)
  assert.match(block, /useUserPrices\(\)/)
})
