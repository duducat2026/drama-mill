<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->

<!--
  AI 配置编辑器「模型目录价」块：解析模型列表逐行展示绑定价，
  选取（复用我的已有价格行）/ 新增（行内迷你表单写入用户级价格表）。
  价格绑定完全由 user_model_prices 按模型名承载，不改 ai_configs 表结构。
-->
<template>
  <div class="cfg-price-block field-wide">
    <div class="cfg-price-head">
      <h3 class="setup-title">模型目录价</h3>
      <p class="settings-desc">为上方模型逐个绑定你的用户级价格：计价优先用我的价格，未绑定回退平台基准，两级都查不到即计价缺口。</p>
    </div>

    <p v-if="!models.length" class="settings-desc">先在「模型」里填写模型名，再在这里设定价格。</p>
    <div v-else class="cfg-price-rows">
      <div v-for="m in models" :key="m" class="cfg-price-item">
        <div class="cfg-price-line">
          <span class="mono cfg-price-model">{{ m }}</span>
          <template v-if="priceOf(m)">
            <span class="cfg-price-val">{{ fmtPrice(priceOf(m)) }}</span>
            <span :class="['tag', priceOf(m).source === 'platform' ? 'tag-accent' : 'tag-success']">{{ priceOf(m).source === 'platform' ? '平台目录' : '自定义' }}</span>
          </template>
          <span v-else-if="platformBase[m]" class="dim cfg-price-val">基准 {{ fmtPrice(platformBase[m]) }} · 未绑定</span>
          <span v-else-if="checked[m]" class="tag tag-error">计价缺口</span>
          <span v-else class="dim">检查中…</span>
          <div class="cfg-price-ops">
            <BaseSelect
              :model-value="''" :options="pickOptions(m)" placeholder="选取已有价"
              @update:model-value="(v) => reuse(m, v)"
            />
            <button type="button" class="btn btn-sm" @click="toggleAdd(m)">{{ addFor === m ? '收起' : '新增' }}</button>
          </div>
        </div>

        <div v-if="addFor === m" class="cfg-price-add">
          <label class="field"><span class="field-label">计费类型</span>
            <BaseSelect v-model="addForm.billing_type" :options="billingOptions" />
          </label>
          <template v-if="addForm.billing_type === 'token'">
            <label class="field"><span class="field-label">输入价（元/百万Token）</span><input v-model.number="addForm.input_price" class="input" type="number" min="0" step="0.01" /></label>
            <label class="field"><span class="field-label">输出价（元/百万Token）</span><input v-model.number="addForm.output_price" class="input" type="number" min="0" step="0.01" /></label>
          </template>
          <label v-else class="field">
            <span class="field-label">{{ addForm.billing_type === 'image' ? '单价（元/张）' : '单价（元/秒）' }}</span>
            <input v-model.number="addForm.unit_price" class="input" type="number" min="0" step="0.01" />
          </label>
          <button type="button" class="btn btn-sm btn-primary" :disabled="saving" @click="doAdd(m)">{{ saving ? '保存中…' : `为 ${m} 新增价格` }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { userModelPriceAPI } from '~/composables/useApi'
import { useUserPrices, BILLING_BY_SERVICE, BILLING_LABELS, fmtMoney } from '~/composables/settings/useUserPrices'
import BaseSelect from '~/components/BaseSelect.vue'

const props = defineProps({
  serviceType: { type: String, default: 'text' },
  modelStr: { type: String, default: '' },
  provider: { type: String, default: '' },
})

const { myPrices, loadMyPrices, pricesOfService, priceOf, createPrice } = useUserPrices()

const models = computed(() => [...new Set((props.modelStr || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean))])
const billingOptions = Object.entries(BILLING_LABELS).map(([value, label]) => ({ value, label }))

function fmtPrice(p) {
  if (p.billing_type === 'token') return `入 ${fmtMoney(p.input_price)} / 出 ${fmtMoney(p.output_price)} 元/百万Token`
  return `${fmtMoney(p.unit_price)} ${p.billing_type === 'image' ? '元/张' : '元/秒'}`
}

/* 未绑定模型 → 平台基准价核对（结果缓存；服务类型切换即失效） */
const platformBase = reactive({})
const checked = reactive({})
watch(() => props.serviceType, () => {
  for (const k of Object.keys(platformBase)) delete platformBase[k]
  for (const k of Object.keys(checked)) delete checked[k]
})
watch(models, (list) => {
  for (const m of list) {
    if (checked[m] || priceOf(m)) continue
    checked[m] = true
    const bt = BILLING_BY_SERVICE[props.serviceType]
    userModelPriceAPI.catalog({ billing_type: bt, keyword: m, page: 1, page_size: 50 })
      .then(r => { platformBase[m] = (r.items || []).find(x => x.model === m) || null })
      .catch(() => { delete checked[m] })
  }
}, { immediate: true })

/* 选取：把我在同模态下的已有价格行复用为该模型的绑定价（计价按模型名匹配） */
function pickOptions(m) {
  return pricesOfService(props.serviceType)
    .filter(p => p.model !== m)
    .map(p => ({ value: p.model, label: `${p.model} · ${fmtPrice(p)}` }))
}
async function reuse(m, picked) {
  if (!picked) return
  const row = myPrices.value.find(p => p.model === picked)
  if (!row) return
  saving.value = true
  try {
    await createPrice({
      provider: props.provider || row.provider,
      model: m, billing_type: row.billing_type,
      input_price: row.input_price, output_price: row.output_price,
      unit_price: row.unit_price, currency: row.currency || 'CNY',
    })
    toast.success(`已复用「${picked}」的价格绑定到 ${m}`)
  } catch (e) { toast.error(e.message) } finally { saving.value = false }
}

/* 新增：行内迷你表单，默认计费类型跟随当前栏模态，命中平台基准时预填 */
const addFor = ref('')
const saving = ref(false)
const addForm = reactive({ billing_type: 'token', input_price: 0, output_price: 0, unit_price: 0 })
function toggleAdd(m) {
  if (addFor.value === m) { addFor.value = ''; return }
  addFor.value = m
  const bt = BILLING_BY_SERVICE[props.serviceType] || 'token'
  Object.assign(addForm, { billing_type: bt, input_price: 0, output_price: 0, unit_price: 0 })
  const base = platformBase[m]
  if (base) prefill(base)
  else userModelPriceAPI.catalog({ billing_type: bt, keyword: m, page: 1, page_size: 50 })
    .then(r => { const hit = (r.items || []).find(x => x.model === m); if (hit && addFor.value === m) prefill(hit) })
    .catch(() => {})
}
function prefill(base) {
  addForm.billing_type = base.billing_type
  addForm.input_price = base.input_price || 0
  addForm.output_price = base.output_price || 0
  addForm.unit_price = base.unit_price || 0
}
async function doAdd(m) {
  saving.value = true
  try {
    await createPrice({
      provider: props.provider || platformBase[m]?.provider || 'custom',
      model: m, ...addForm, currency: 'CNY',
    })
    toast.success(`已为 ${m} 新增用户级价格`)
    addFor.value = ''
  } catch (e) { toast.error(e.message) } finally { saving.value = false }
}

onMounted(() => loadMyPrices())
</script>

<style scoped src="~/assets/styles/settings.css"></style>

<style scoped>
.cfg-price-block { border: 1px dashed var(--border, #d1d5db); border-radius: 10px; padding: 12px 14px; }
.cfg-price-head { margin-bottom: 8px; }
.cfg-price-rows { display: grid; gap: 8px; }
.cfg-price-item { display: grid; gap: 8px; }
.cfg-price-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
.cfg-price-model { min-width: 160px; font-weight: 600; }
.cfg-price-val { color: var(--muted, #6b7280); }
.cfg-price-ops { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.cfg-price-ops .base-select { min-width: 170px; }
.cfg-price-add { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; padding: 10px 12px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; background: var(--panel-alt, #f9fafb); }
.cfg-price-add .field { display: grid; gap: 4px; }
.cfg-price-add .input { width: 160px; }
</style>
