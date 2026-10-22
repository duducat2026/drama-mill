<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->

<!--
  「从平台目录导入」弹窗：目录行按固定列宽排布——
  模型名独占弹性列并可无限折行，厂商与价目永不换行，长名（如带括号区间说明）不再把右侧挤成两行。
  选中项按 model 名存整行（Map），因此翻页 / 切模态后仍是完整选择。
-->
<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="dialog price-import-dialog">
      <div class="dialog-head">
        <div class="dialog-title">从平台目录导入基准价</div>
        <button type="button" class="btn btn-icon btn-sm btn-ghost ml-auto dialog-close" @click="$emit('close')">✕</button>
      </div>

      <div class="dialog-body">
        <div class="pcat-toolbar">
          <div class="price-filter">
            <button
              v-for="m in MODALITIES" :key="m.key" type="button"
              :class="['price-pill', { active: catalogBilling === m.key }]" @click="switchCatalogBilling(m.key)"
            >{{ m.short }}</button>
            <span class="pcat-unit">{{ activeModality.unit }}</span>
          </div>
          <div class="pcat-search">
            <label class="pcat-all">
              <input type="checkbox" :checked="pageAllPicked" :disabled="!pickableItems.length" @change="togglePageAll" />
              本页全选
            </label>
            <input v-model="catalogKeyword" class="input" placeholder="搜索模型名…" @keyup.enter="loadCatalog(1)" />
            <button type="button" class="price-btn" @click="loadCatalog(1)">搜索</button>
          </div>
        </div>

        <div class="pcat-list">
          <label
            v-for="m in catalogItems" :key="`${m.provider}|${m.model}`"
            :class="['pcat-row', { 'is-picked': selected.has(m.model), 'is-done': m.imported }]"
          >
            <input type="checkbox" :disabled="m.imported" :checked="selected.has(m.model) || !!m.imported" @change="togglePick(m)" />
            <span class="pcat-model mono">{{ m.model }}</span>
            <span class="pcat-vendor">{{ m.provider }}</span>
            <span class="pcat-price">{{ fmtBase(m) }}</span>
            <span v-if="m.imported" class="pcat-done">已导入</span>
          </label>
          <p v-if="!catalogItems.length" class="pcat-empty">没有匹配的目录价，换个关键字试试。</p>
        </div>

        <div class="pcat-pager">
          <span>{{ catalogPage }} / {{ catalogPages }} 页 · 共 {{ catalogTotal }} 条</span>
          <span v-if="selected.size" class="pcat-picked">已选 {{ selected.size }} 项，翻页与切换模态都保留</span>
          <span class="pcat-pager-btns">
            <button type="button" class="price-btn" :disabled="catalogPage <= 1" @click="loadCatalog(catalogPage - 1)">上一页</button>
            <button type="button" class="price-btn" :disabled="catalogPage >= catalogPages" @click="loadCatalog(catalogPage + 1)">下一页</button>
          </span>
        </div>
      </div>

      <div class="dialog-foot">
        <button type="button" class="btn" @click="$emit('close')">取消</button>
        <button type="button" class="btn btn-primary" :disabled="!selected.size || importing" @click="doImport">
          {{ importing ? '导入中…' : `导入所选 ${selected.size} 项` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { userModelPriceAPI } from '~/composables/useApi'
import { useUserPrices, MODALITIES, fmtMoney } from '~/composables/settings/useUserPrices'

defineEmits(['close'])

const { importPrices } = useUserPrices()

const catalogBilling = ref('token')
const catalogKeyword = ref('')
const catalogItems = ref([])
const catalogPage = ref(1)
const catalogTotal = ref(0)
const catalogPages = computed(() => Math.max(1, Math.ceil(catalogTotal.value / 20)))
// 选中项按 model 名存整行（Map），翻页/切计费类型后仍能保留跨页选择并提交全部条目
const selected = ref(new Map())
const importing = ref(false)

const activeModality = computed(() => MODALITIES.find(m => m.key === catalogBilling.value) || MODALITIES[0])
function fmtBase(m) {
  if (m.billing_type === 'token') return `入 ${fmtMoney(m.input_price)} / 出 ${fmtMoney(m.output_price)}`
  return fmtMoney(m.unit_price)
}

const pickableItems = computed(() => catalogItems.value.filter(m => !m.imported))
const pageAllPicked = computed(() =>
  pickableItems.value.length > 0 && pickableItems.value.every(m => selected.value.has(m.model)))

async function loadCatalog(page) {
  catalogPage.value = page
  try {
    const r = await userModelPriceAPI.catalog({ billing_type: catalogBilling.value, keyword: catalogKeyword.value, page, page_size: 20 })
    catalogItems.value = r.items || []
    catalogTotal.value = r.total || 0
  } catch (e) { toast.error(e.message) }
}
function switchCatalogBilling(v) { catalogBilling.value = v; loadCatalog(1) }
function togglePick(m) {
  const s = new Map(selected.value)
  if (s.has(m.model)) s.delete(m.model)
  else s.set(m.model, m)
  selected.value = s
}
function togglePageAll() {
  const s = new Map(selected.value)
  if (pageAllPicked.value) pickableItems.value.forEach(m => s.delete(m.model))
  else pickableItems.value.forEach(m => s.set(m.model, m))
  selected.value = s
}
async function doImport() {
  const items = [...selected.value.values()].map(m => ({ provider: m.provider, model: m.model }))
  if (!items.length) return
  if (items.length > 200) { toast.error(`单次最多导入 200 项，当前已选 ${items.length} 项，请分批导入`); return }
  importing.value = true
  try {
    const r = await importPrices(items)
    toast.success(`导入完成：新增 ${r.inserted}，跳过已有 ${r.skipped_existing}${r.skipped_missing ? `，目录无此模型 ${r.skipped_missing}` : ''}`)
    selected.value = new Map()
    loadCatalog(catalogPage.value)
  } catch (e) { toast.error(e.message) } finally { importing.value = false }
}

onMounted(() => loadCatalog(1))
</script>

<style scoped src="~/assets/styles/settings.prices.css"></style>
