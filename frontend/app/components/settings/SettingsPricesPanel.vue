<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->

<!--
  「模型价格」面板 —— 价目单（tariff sheet）式排布：
  按模态分节，单位只在节头声明一次（消除旧表格里任一模态必空的三列），
  数字右对齐等宽成一条竖线，来源降格为「点 + 字」，操作 hover/聚焦时才浮现。
  目录导入弹窗拆到 SettingsPricesImportDialog.vue。
-->
<template>
  <div class="settings-scroll">
    <div class="settings-head">
      <h2 class="settings-title">模型价格</h2>
      <p class="settings-desc">从平台基准价导入或自定义单价，作为你的 AI 调用成本测算依据：新产生的用量记录优先按这里的价格计价，未配置的模型回退平台基准。</p>
    </div>

    <section class="card">
      <!-- 卡头工具条：标题 + 自带计数的筛选 chips 成左簇、操作右靠、下边框与价目分区（同 AI 服务卡头）。
           旧版卡头是两端对拉，宽栏下标题与按钮之间拉出数百像素死白；
           且「已配置 N 个模型价格」与 chips 的「全部 N」是同一件事说两遍。 -->
      <div class="price-bar">
        <div class="price-bar-title">我的模型价</div>
        <div v-if="myPrices.length" class="price-filter">
          <button
            v-for="f in billingFilters" :key="f.value" type="button"
            :class="['price-pill', { active: billingFilter === f.value }]" @click="billingFilter = f.value"
          >{{ f.label }}<span class="price-pill-count">{{ f.count }}</span></button>
        </div>
        <!-- 空态的操作只在下方引导块里出现一次，卡头不再重复一对按钮 -->
        <div v-if="myPrices.length" class="config-actions price-bar-ops">
          <button type="button" class="btn btn-sm" @click="openAdd">自定义价格</button>
          <button type="button" class="btn btn-sm btn-primary" @click="importOpen = true">从平台目录导入</button>
        </div>
      </div>

      <div v-if="!myPrices.length" class="price-empty">
        <div class="price-empty-title">还没有属于你的价格表</div>
        <p class="price-empty-desc">不配置也会计价——此时按平台目录价（刊例价）。导入后，你可以给个别模型设自己的价。</p>
        <div class="price-empty-cta">
          <button type="button" class="btn btn-sm btn-primary" @click="importOpen = true">从平台目录导入</button>
          <button type="button" class="btn btn-sm" @click="openAdd">自定义价格</button>
        </div>
      </div>

      <template v-else>
        <section v-for="sheet in sheets" :key="sheet.key" class="price-sheet">
          <header class="price-sheet-head">
            <span class="price-sheet-kicker">{{ sheet.kicker }}</span>
            <span class="price-sheet-unit">{{ sheet.unit }}</span>
            <span class="price-sheet-count">{{ sheet.total }}</span>
          </header>
          <ul class="price-sheet-list">
            <li v-for="p in sheet.rows" :key="p.id" class="price-row">
              <div class="price-row-id">
                <span class="price-row-model mono">{{ p.model }}</span>
                <!-- 来源并进厂商行：省下一整列宽度，窄屏不会把操作列挤到第二行 -->
                <span class="price-row-vendor">
                  {{ p.provider }}
                  <em class="price-row-from" :data-src="p.source === 'platform' ? 'platform' : 'manual'">
                    {{ p.source === 'platform' ? '平台目录' : '自定义' }}
                  </em>
                </span>
              </div>
              <!-- 点引导线：价目单的招牌元素，把模型名与价目之间的死白变成可读的牵引 -->
              <span class="price-row-leader" aria-hidden="true" />

              <div class="price-row-fig">
                <div v-if="editing === p.id" class="price-edit">
                  <template v-if="p.billing_type === 'token'">
                    <span class="price-key">入</span>
                    <input v-model.number="editForm.input_price" class="input" type="number" min="0" step="0.01" />
                    <span class="price-key">出</span>
                    <input v-model.number="editForm.output_price" class="input" type="number" min="0" step="0.01" />
                  </template>
                  <input v-else v-model.number="editForm.unit_price" class="input" type="number" min="0" step="0.01" />
                </div>
                <template v-else-if="p.billing_type === 'token'">
                  <span class="price-key">入</span><span class="price-num">{{ fmtMoney(p.input_price) }}</span>
                  <span class="price-sep">/</span>
                  <span class="price-key">出</span><span class="price-num">{{ fmtMoney(p.output_price) }}</span>
                </template>
                <span v-else class="price-num">{{ fmtMoney(p.unit_price) }}</span>
              </div>

              <div class="price-row-ops">
                <template v-if="editing === p.id">
                  <button type="button" class="price-btn price-btn-primary" :disabled="saving" @click="saveEdit(p)">保存</button>
                  <button type="button" class="price-btn" @click="editing = 0">取消</button>
                </template>
                <template v-else>
                  <button type="button" class="price-btn" @click="startEdit(p)">改价</button>
                  <button type="button" class="price-btn price-btn-danger" :disabled="saving" @click="del(p)">删除</button>
                </template>
              </div>
            </li>
          </ul>
        </section>
        <p v-if="!sheets.length" class="settings-desc">这个模态下还没有价格行，切「全部」看看，或点上方按钮添加。</p>

        <div v-if="filteredPrices.length" class="price-pager">
          <span class="price-pager-sum">
            第 {{ (page - 1) * pageSize + 1 }}-{{ Math.min(page * pageSize, filteredPrices.length) }} 条
            <em>·</em> 共 {{ filteredPrices.length }} 条
          </span>
          <span class="price-pager-size">
            每页
            <button
              v-for="s in PAGE_SIZES" :key="s" type="button"
              :class="['price-size', { active: pageSize === s }]" @click="setPageSize(s)"
            >{{ s }}</button>
          </span>
          <span class="price-pager-btns">
            <button type="button" class="price-btn" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
            <span class="price-page-no">{{ page }} / {{ pages }}</span>
            <button type="button" class="price-btn" :disabled="page >= pages" @click="goPage(page + 1)">下一页</button>
          </span>
        </div>
      </template>
    </section>

    <SettingsPricesImportDialog v-if="importOpen" @close="importOpen = false" />

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
import { useUserPrices, BILLING_LABELS, MODALITIES, fmtMoney } from '~/composables/settings/useUserPrices'
import BaseSelect from '~/components/BaseSelect.vue'
import SettingsPricesImportDialog from '~/components/settings/SettingsPricesImportDialog.vue'

const { myPrices, loadMyPrices, createPrice, updatePrice, removePrice } = useUserPrices()

const billingFilter = ref('')
const billingFilters = computed(() => [
  { value: '', label: '全部', count: myPrices.value.length },
  ...MODALITIES.map(m => ({
    value: m.key,
    label: m.short,
    count: myPrices.value.filter(p => p.billing_type === m.key).length,
  })),
])

/* 分页：列表由模块级 myPrices 全量缓存（AI 配置编辑器要按模型名反查价目），
   所以分页在前端切片，后端 GET /model-prices 仍一次返回全量。 */
const PAGE_SIZES = [20, 50]
const pageSize = ref(20)
const page = ref(1)

const filteredPrices = computed(() => myPrices.value.filter(p => !billingFilter.value || p.billing_type === billingFilter.value))
const pages = computed(() => Math.max(1, Math.ceil(filteredPrices.value.length / pageSize.value)))
const pagedPrices = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredPrices.value.slice(start, start + pageSize.value)
})

/* 价目节：模态即章节，节头带计价单位；total 恒为该模态全量，不随翻页跳动 */
const sheets = computed(() =>
  MODALITIES
    .map(m => ({
      ...m,
      rows: pagedPrices.value.filter(p => p.billing_type === m.key),
      total: myPrices.value.filter(p => p.billing_type === m.key).length,
    }))
    .filter(s => s.rows.length))

function goPage(p) { page.value = Math.min(Math.max(1, p), pages.value) }
function setPageSize(s) { pageSize.value = s; page.value = 1 }
watch(billingFilter, () => { page.value = 1 })
// 删除后当前页可能越界（例如末页只剩一条），回退到最后一页而不是显示空页
watch(pages, (n) => { if (page.value > n) page.value = n })

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

/* 自定义新增 */
const addOpen = ref(false)
const billingOptions = Object.entries(BILLING_LABELS).map(([value, label]) => ({ value, label }))
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
<style scoped src="~/assets/styles/settings.prices.css"></style>
