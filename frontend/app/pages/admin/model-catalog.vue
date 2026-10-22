<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <https://www.gnu.org/licenses/>.
-->

<template>
  <div>
    <div class="admin-page-title">模型目录价</div>
    <div class="admin-page-desc">模型清单与价格列表读取主库目录表（model_catalog_*，随仓库快照 docker/model-catalog-data.sql 初始化），供平台侧查阅厂商目录价（不参与业务计费）</div>

    <!-- 目录未初始化告警（迁移脚本还没跑 / 目录表为空时给出可操作提示） -->
    <div v-if="catalogError" class="mc-error">
      ⚠ {{ catalogError }}
      <button class="btn btn-sm" @click="init">重试</button>
    </div>

    <template v-else>
      <!-- 页头概览 -->
      <div class="admin-stat-grid">
        <div class="admin-stat"><div class="admin-stat-label">模型总数</div><div class="admin-stat-value">{{ stats.model_total ?? '-' }}</div></div>
        <div class="admin-stat"><div class="admin-stat-label">价格条目</div><div class="admin-stat-value">{{ stats.price_total ?? '-' }}</div></div>
        <div class="admin-stat"><div class="admin-stat-label">厂商数</div><div class="admin-stat-value">{{ (stats.providers || []).length }}</div></div>
        <div class="admin-stat"><div class="admin-stat-label">数据来源</div><div class="admin-stat-value">{{ (stats.sources || []).length }}</div></div>
      </div>

      <!-- Tab 切换 -->
      <div class="mc-tabs">
        <button class="mc-tab" :class="{ active: tab === 'models' }" @click="switchTab('models')">模型清单</button>
        <button class="mc-tab" :class="{ active: tab === 'prices' }" @click="switchTab('prices')">模型价格列表</button>
      </div>

      <!-- 工具栏 -->
      <div class="admin-toolbar">
        <input v-model="filters.keyword" class="input" :placeholder="tab === 'models' ? '搜索模型名称 / 模型ID / 厂商' : '搜索模型名称 / 模型ID / 厂商 / 价格项'" @keyup.enter="query" />
        <select v-model="filters.provider" class="input" @change="query">
          <option value="">全部厂商</option>
          <option v-for="p in stats.providers" :key="p.provider" :value="p.provider">{{ p.provider }}（{{ p.count }}）</option>
        </select>
        <select v-model="filters.source" class="input" @change="query">
          <option value="">全部来源</option>
          <option v-for="s in stats.sources" :key="s.source" :value="s.source">{{ s.source }}（{{ s.count }}）</option>
        </select>
        <select v-model="filters.offline" class="input" @change="query">
          <option value="">全部状态</option>
          <option value="0">在售</option>
          <option value="1">已下线</option>
        </select>
        <button class="btn btn-sm" @click="query">查询</button>
        <button class="btn btn-sm btn-ghost" @click="resetFilters">重置</button>
        <span v-if="tab === 'prices' && filters.model_id" class="mc-model-chip">
          模型：{{ filters.model_id }}
          <button class="mc-chip-x" @click="filters.model_id = ''; query()">✕</button>
        </span>
        <button class="btn btn-sm mc-import-btn" @click="openImport">导入到平台刊例价</button>
      </div>

      <!-- 模型清单 -->
      <div v-if="tab === 'models'" class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr><th>模型名称</th><th>模型ID</th><th>厂商</th><th>来源</th><th>上下文</th><th>最大输出</th><th>模态</th><th>状态</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td><div class="admin-cell-text"><strong>{{ r.name || '-' }}</strong></div></td>
              <td><div class="admin-cell-text" style="font-family:monospace;font-size:11.5px">{{ r.model_id }}</div></td>
              <td>{{ r.provider || '-' }}</td>
              <td><span class="admin-tag admin-tag-gray">{{ r.source || '-' }}</span></td>
              <td>{{ fmtNum(r.context_window) }}</td>
              <td>{{ fmtNum(r.max_output_tokens) }}</td>
              <td><div class="admin-cell-text" style="max-width:160px">{{ modality(r) }}</div></td>
              <td><span class="admin-tag" :class="r.is_offline ? 'admin-tag-red' : 'admin-tag-green'">{{ r.is_offline ? '已下线' : '在售' }}</span></td>
              <td><button class="btn btn-sm btn-ghost" @click="viewPrices(r)">查看价格</button></td>
            </tr>
          </tbody>
        </table>
        <div v-if="!rows.length" class="admin-empty">未匹配到模型</div>
      </div>

      <!-- 模型价格列表 -->
      <div v-else class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr><th>模型名称</th><th>模型ID</th><th>价格项</th><th>价格</th><th>单位</th><th>区间/规格</th><th>厂商</th><th>来源</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td><div class="admin-cell-text"><strong>{{ r.model_name || '-' }}</strong></div></td>
              <td><div class="admin-cell-text" style="font-family:monospace;font-size:11.5px">{{ r.model_id }}</div></td>
              <td>{{ r.price_name || r.price_type || '-' }}</td>
              <td style="font-weight:600">{{ r.price ?? '-' }}</td>
              <td>{{ r.price_unit || '-' }}</td>
              <td><div class="admin-cell-text" style="max-width:180px">{{ r.range_name || r.spec || '-' }}</div></td>
              <td>{{ r.provider || '-' }}</td>
              <td><span class="admin-tag admin-tag-gray">{{ r.source || '-' }}</span></td>
              <td><span class="admin-tag" :class="r.is_offline ? 'admin-tag-red' : 'admin-tag-green'">{{ r.is_offline ? '已下线' : '在售' }}</span></td>
            </tr>
          </tbody>
        </table>
        <div v-if="!rows.length" class="admin-empty">未匹配到价格条目</div>
      </div>

      <div class="admin-pager">
        <span>共 {{ total }} 条 · 第 {{ page }} / {{ totalPages }} 页</span>
        <button class="btn btn-sm" :disabled="page <= 1" @click="load(page - 1)">上一页</button>
        <button class="btn btn-sm" :disabled="page >= totalPages" @click="load(page + 1)">下一页</button>
      </div>
    </template>

    <!-- 导入到平台刊例价：预览→确认（逻辑已抽离为 ModelCatalogImportModal 组件） -->
    <ModelCatalogImportModal :open="importOpen" @close="importOpen = false" @imported="refreshStats" />
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
definePageMeta({ layout: 'admin' })

type Tab = 'models' | 'prices'
const tab = ref<Tab>('models')
const stats = ref<any>({})
const catalogError = ref('')

const filters = reactive({ keyword: '', provider: '', source: '', offline: '', model_id: '' })
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

function fmtNum(v?: number | null) {
  if (v === null || v === undefined) return '-'
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k`
  return String(v)
}

function modality(r: any) {
  const req = r.request_modality || ''
  const resp = r.response_modality || ''
  return [req, resp].filter(Boolean).join(' → ') || '-'
}

async function load(p = 1) {
  page.value = p
  const params = {
    keyword: filters.keyword,
    provider: filters.provider,
    source: filters.source,
    offline: filters.offline,
    page: p,
    page_size: pageSize.value,
  }
  try {
    const data = tab.value === 'models'
      ? await adminAPI.modelCatalogModels(params)
      : await adminAPI.modelCatalogPrices({ ...params, model_id: filters.model_id })
    rows.value = data.items || []
    total.value = data.total || 0
  } catch (e: any) {
    catalogError.value = e?.message || '模型目录价加载失败'
  }
}

function query() { load(1) }

function switchTab(t: Tab) {
  if (tab.value === t) return
  tab.value = t
  rows.value = []
  load(1)
}

function resetFilters() {
  filters.keyword = ''
  filters.provider = ''
  filters.source = ''
  filters.offline = ''
  filters.model_id = ''
  load(1)
}

// 从模型清单跳转到该模型的价格列表
function viewPrices(r: any) {
  filters.model_id = r.model_id || r.name
  filters.keyword = ''
  tab.value = 'prices'
  load(1)
}

async function init() {
  catalogError.value = ''
  try {
    stats.value = await adminAPI.modelCatalogStats()
    await load(1)
  } catch (e: any) {
    catalogError.value = e?.message || '模型目录加载失败（请导入 docker/model-catalog-data.sql 快照）'
  }
}

// ─── 导入到平台刊例价：弹窗逻辑已抽离为 ModelCatalogImportModal ───
const importOpen = ref(false)
function openImport() { importOpen.value = true }
// 导入成功后刷新页头概览（价格条目总数变化）
async function refreshStats() {
  try { stats.value = await adminAPI.modelCatalogStats() } catch { /* 概览刷新失败忽略 */ }
}

onMounted(init)
</script>

<style scoped>
.mc-tabs { display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid var(--border); }
.mc-tab {
  padding: 7px 14px; border: none; background: transparent; cursor: pointer;
  font-size: 13px; font-weight: 500; color: var(--text-2);
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.mc-tab:hover { color: var(--text-0); }
.mc-tab.active { color: var(--accent-text); font-weight: 600; border-bottom-color: var(--accent-text); }

.mc-error {
  display: flex; align-items: center; gap: 12px;
  background: rgba(255,59,48,0.08); border: 1px solid rgba(255,59,48,0.25);
  color: var(--action-danger); border-radius: 12px;
  padding: 12px 14px; margin-bottom: 16px; font-size: 12.5px;
}

.mc-model-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 6px 3px 10px; border-radius: var(--radius-pill);
  background: var(--accent-bg); color: var(--accent-text); font-size: 12px; font-weight: 600;
}
.mc-chip-x { border: none; background: transparent; color: inherit; cursor: pointer; font-size: 12px; padding: 0 2px; }

.mc-import-btn { margin-left: auto; }
</style>
