<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->

<template>
  <div class="settings-scroll">
    <div class="settings-head">
      <h2 class="settings-title">模型价格</h2>
      <p class="settings-desc">从平台基准价导入或自定义单价，作为你的 AI 调用成本测算依据：新产生的用量记录优先按这里的价格计价，未配置的模型回退平台基准。</p>
    </div>

    <section class="card">
      <div class="setup-panel-head compact">
        <div>
          <div class="setup-title">我的模型价</div>
          <div class="setup-desc">{{ myPrices.length ? `已配置 ${myPrices.length} 个模型价格` : '还没有配置任何模型价格，可从平台目录导入' }}</div>
        </div>
        <div class="config-actions">
          <button type="button" class="btn btn-sm" @click="openAdd">自定义价格</button>
          <button type="button" class="btn btn-sm btn-primary" @click="openImport">从平台目录导入</button>
        </div>
      </div>

      <div class="price-filter">
        <button
          v-for="f in billingFilters" :key="f.value" type="button"
          :class="['preset-pill', { active: billingFilter === f.value }]" @click="billingFilter = f.value"
        >{{ f.label }}</button>
      </div>

      <table v-if="filteredPrices.length" class="price-table">
        <thead>
          <tr><th>模型</th><th>服务商</th><th>计费</th><th>输入价</th><th>输出价</th><th>单价</th><th>来源</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="p in filteredPrices" :key="p.id">
            <td class="mono">{{ p.model }}</td>
            <td>{{ p.provider }}</td>
            <td>{{ billingShort[p.billing_type] }}</td>
            <td v-if="p.billing_type === 'token'">
              <input v-if="editing === p.id" v-model.number="editForm.input_price" class="input" type="number" min="0" step="0.01" />
              <span v-else>{{ p.input_price }}</span>
            </td>
            <td v-else class="dim">—</td>
            <td v-if="p.billing_type === 'token'">
              <input v-if="editing === p.id" v-model.number="editForm.output_price" class="input" type="number" min="0" step="0.01" />
              <span v-else>{{ p.output_price }}</span>
            </td>
            <td v-else class="dim">—</td>
            <td v-if="p.billing_type !== 'token'">
              <input v-if="editing === p.id" v-model.number="editForm.unit_price" class="input" type="number" min="0" step="0.01" />
              <span v-else>{{ p.unit_price }}</span>
            </td>
            <td v-else class="dim">—</td>
            <td><span :class="['tag', p.source === 'platform' ? 'tag-accent' : 'tag-success']">{{ p.source === 'platform' ? '平台导入' : '自定义' }}</span></td>
            <td class="price-ops">
              <template v-if="editing === p.id">
                <button type="button" class="btn btn-sm btn-primary" :disabled="saving" @click="saveEdit(p)">保存</button>
                <button type="button" class="btn btn-sm" @click="editing = 0">取消</button>
              </template>
              <template v-else>
                <button type="button" class="btn btn-sm" @click="startEdit(p)">改价</button>
                <button type="button" class="btn btn-sm btn-danger" :disabled="saving" @click="del(p)">删除</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="settings-desc">当前筛选下没有价格行。导入平台基准价或点「自定义价格」手工添加。</p>
    </section>

    <!-- 从平台目录导入（复用 studio.css overlay/dialog 骨架） -->
    <div v-if="importOpen" class="overlay" @click.self="importOpen = false">
      <div class="dialog price-import-dialog">
        <div class="dialog-head">
          <div class="dialog-title">从平台目录导入基准价</div>
          <button type="button" class="btn btn-icon btn-sm btn-ghost ml-auto dialog-close" @click="importOpen = false">✕</button>
        </div>
        <div class="dialog-body">
          <div class="price-filter">
            <button
              v-for="f in billingFilters.filter(x => x.value)" :key="f.value" type="button"
              :class="['preset-pill', { active: catalogBilling === f.value }]" @click="switchCatalogBilling(f.value)"
            >{{ f.label }}</button>
            <input v-model="catalogKeyword" class="input" placeholder="搜索模型名…" @keyup.enter="loadCatalog(1)" />
            <button type="button" class="btn btn-sm" @click="loadCatalog(1)">搜索</button>
          </div>
          <div class="price-catalog-list">
            <label v-for="m in catalogItems" :key="`${m.provider}|${m.model}`" class="price-catalog-row">
              <input type="checkbox" :disabled="m.imported" :checked="selected.has(m.model) || !!m.imported" @change="togglePick(m)" />
              <span class="mono">{{ m.model }}</span>
              <span class="dim">{{ m.provider }}</span>
              <span class="price-catalog-val">{{ fmtBase(m) }}</span>
              <span v-if="m.imported" class="tag tag-success">已导入</span>
            </label>
            <p v-if="!catalogItems.length" class="settings-desc">没有匹配的目录价，换个关键字试试。</p>
          </div>
          <div class="price-pager">
            <button type="button" class="btn btn-sm" :disabled="catalogPage <= 1" @click="loadCatalog(catalogPage - 1)">上一页</button>
            <span class="dim">{{ catalogPage }} / {{ catalogPages }} 页 · 共 {{ catalogTotal }} 条</span>
            <button type="button" class="btn btn-sm" :disabled="catalogPage >= catalogPages" @click="loadCatalog(catalogPage + 1)">下一页</button>
          </div>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="importOpen = false">取消</button>
          <button type="button" class="btn btn-primary" :disabled="!selected.size || importing" @click="doImport">
            {{ importing ? '导入中…' : `导入所选 ${selected.size} 项` }}
          </button>
        </div>
      </div>
    </div>

    <!-- 自定义价格 -->
    <div v-if="addOpen" class="overlay" @click.self="addOpen = false">
      <div class="dialog price-add-dialog">
        <div class="dialog-head">
          <div class="dialog-title">自定义模型价格</div>
          <button type="button" class="btn btn-icon btn-sm btn-ghost ml-auto dialog-close" @click="addOpen = false">✕</button>
        </div>
        <div class="dialog-body price-add-body">
          <label class="field"><span class="field-label">模型名</span><input v-model="addForm.model" class="input mono" placeholder="如 qwen-plus" /></label>
          <label class="field"><span class="field-label">服务商</span><input v-model="addForm.provider" class="input" placeholder="如 bailian / openai" /></label>
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
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="addOpen = false">取消</button>
          <button type="button" class="btn btn-primary" :disabled="!addForm.model || !addForm.provider || saving" @click="doAdd">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { userModelPriceAPI } from '~/composables/useApi'
import { useUserPrices, BILLING_LABELS } from '~/composables/settings/useUserPrices'
import BaseSelect from '~/components/BaseSelect.vue'

const { myPrices, loadMyPrices, createPrice, updatePrice, removePrice } = useUserPrices()

const billingShort = { token: '文本', image: '图片', video_second: '视频' }
const billingFilters = [
  { value: '', label: '全部' },
  { value: 'token', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'video_second', label: '视频' },
]
const billingOptions = Object.entries(BILLING_LABELS).map(([value, label]) => ({ value, label }))

const billingFilter = ref('')
const filteredPrices = computed(() => myPrices.value.filter(p => !billingFilter.value || p.billing_type === billingFilter.value))

/* 行内改价 */
const editing = ref(0)
const editForm = reactive({ input_price: 0, output_price: 0, unit_price: 0 })
const saving = ref(false)
function startEdit(p) {
  editing.value = p.id
  editForm.input_price = p.input_price
  editForm.output_price = p.output_price
  editForm.unit_price = p.unit_price
}
async function saveEdit(p) {
  saving.value = true
  try {
    await updatePrice(p.id, p.billing_type === 'token'
      ? { input_price: editForm.input_price, output_price: editForm.output_price }
      : { unit_price: editForm.unit_price })
    toast.success('价格已更新')
    editing.value = 0
  } catch (e) { toast.error(e.message) } finally { saving.value = false }
}
async function del(p) {
  saving.value = true
  try { await removePrice(p.id); toast.success(`已删除 ${p.model}，该模型回退平台基准计价`) }
  catch (e) { toast.error(e.message) } finally { saving.value = false }
}

/* 平台目录导入 */
const importOpen = ref(false)
const catalogBilling = ref('token')
const catalogKeyword = ref('')
const catalogItems = ref([])
const catalogPage = ref(1)
const catalogTotal = ref(0)
const catalogPages = computed(() => Math.max(1, Math.ceil(catalogTotal.value / 20)))
const selected = ref(new Set())
const importing = ref(false)

function openImport() {
  importOpen.value = true
  selected.value = new Set()
  loadCatalog(1)
}
function switchCatalogBilling(v) { catalogBilling.value = v; loadCatalog(1) }
async function loadCatalog(page) {
  catalogPage.value = page
  try {
    const r = await userModelPriceAPI.catalog({ billing_type: catalogBilling.value, keyword: catalogKeyword.value, page, page_size: 20 })
    catalogItems.value = r.items || []
    catalogTotal.value = r.total || 0
  } catch (e) { toast.error(e.message) }
}
function togglePick(m) {
  const s = new Set(selected.value)
  if (s.has(m.model)) s.delete(m.model)
  else s.add(m.model)
  selected.value = s
}
async function doImport() {
  importing.value = true
  try {
    const items = catalogItems.value.filter(m => selected.value.has(m.model)).map(m => ({ provider: m.provider, model: m.model }))
    const r = await userModelPriceAPI.import(items)
    toast.success(`导入完成：新增 ${r.inserted}，跳过已有 ${r.skipped_existing}${r.skipped_missing ? `，目录无此模型 ${r.skipped_missing}` : ''}`)
    importOpen.value = false
  } catch (e) { toast.error(e.message) } finally { importing.value = false }
}
function fmtBase(m) {
  if (m.billing_type === 'token') return `入 ${m.input_price} / 出 ${m.output_price} 元/百万Token`
  return `${m.unit_price} ${m.billing_type === 'image' ? '元/张' : '元/秒'}`
}

/* 自定义新增 */
const addOpen = ref(false)
const addForm = reactive({ model: '', provider: '', billing_type: 'token', input_price: 0, output_price: 0, unit_price: 0 })
function openAdd() {
  Object.assign(addForm, { model: '', provider: '', billing_type: 'token', input_price: 0, output_price: 0, unit_price: 0 })
  addOpen.value = true
}
async function doAdd() {
  saving.value = true
  try {
    await createPrice({ ...addForm })
    toast.success(`已添加 ${addForm.model} 的自定义价格`)
    addOpen.value = false
  } catch (e) { toast.error(e.message) } finally { saving.value = false }
}

onMounted(() => loadMyPrices())
</script>

<style scoped src="~/assets/styles/settings.css"></style>

<style scoped>
.price-filter { display: flex; flex-wrap: wrap; gap: var(--sp-2, 8px); align-items: center; margin-bottom: var(--sp-4, 14px); }
.price-filter .input { width: 200px; }
.price-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.price-table th, .price-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border, #e5e7eb); white-space: nowrap; }
.price-table th { color: var(--muted, #6b7280); font-weight: 600; }
.price-table .input { width: 92px; padding: 4px 8px; }
.price-ops { display: flex; gap: 6px; }
.price-import-dialog, .price-add-dialog { width: min(720px, 92vw); }
.price-add-dialog { width: min(460px, 92vw); }
.price-add-body { display: grid; gap: 12px; }
.price-catalog-list { max-height: 340px; overflow-y: auto; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; }
.price-catalog-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border, #e5e7eb); font-size: 13px; cursor: pointer; }
.price-catalog-row:last-child { border-bottom: none; }
.price-catalog-row input[type='checkbox'] { accent-color: var(--accent, #4f46e5); }
.price-catalog-val { margin-left: auto; color: var(--muted, #6b7280); }
.price-pager { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; font-size: 13px; }
</style>
