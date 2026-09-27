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
    <div class="admin-page-title">AI 成本</div>
    <div class="admin-page-desc">全平台成本聚合（按用户/项目检索下钻明细）与模型刊例价维护</div>

    <!-- 检索 -->
    <div class="admin-toolbar">
      <select v-model="filters.user_id" class="input" @change="load(1)">
        <option value="">全部用户</option>
        <option v-for="u in userOptions" :key="u.id" :value="u.id">{{ u.username }}</option>
      </select>
      <input v-model="filters.drama_id" class="input" placeholder="项目ID" style="width:100px" @keyup.enter="load(1)" />
      <input v-model="filters.drama_keyword" class="input" placeholder="项目名称" style="width:140px" @keyup.enter="load(1)" />
      <input v-model="filters.episode_id" class="input" placeholder="剧集ID" style="width:100px" @keyup.enter="load(1)" />
      <button class="btn btn-sm" @click="load(1)">查询</button>
    </div>

    <!-- 汇总 -->
    <div class="admin-stat-grid">
      <div class="admin-stat">
        <div class="admin-stat-label">总成本（元）</div>
        <div class="admin-stat-value">¥ {{ data?.total_cost ?? '-' }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">总调用次数</div>
        <div class="admin-stat-value">{{ data?.total_calls ?? '-' }}</div>
      </div>
      <div v-for="(v, k) in (data?.by_service_type || {})" :key="k" class="admin-stat">
        <div class="admin-stat-label">{{ SERVICE_LABEL[k] || k }} 成本</div>
        <div class="admin-stat-value">¥ {{ v }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">缺价调用</div>
        <div class="admin-stat-value">{{ data?.price_missing_calls ?? '-' }}</div>
      </div>
    </div>

    <!-- 项目/剧集汇总 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>项目ID</th><th>项目名称</th><th>成本</th><th>调用</th><th>剧集数</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="d in (data?.by_drama || [])" :key="d.drama_id">
              <td>{{ d.drama_id }}</td>
              <td>{{ d.drama_title || '-' }}</td>
              <td>¥ {{ d.cost }}</td>
              <td>{{ d.calls }}</td>
              <td>{{ d.episode_count }}</td>
              <td><button class="btn btn-sm" @click="filters.drama_id = String(d.drama_id); filters.drama_keyword = ''; load(1)">下钻</button></td>
            </tr>
          </tbody>
        </table>
        <div v-if="!data?.by_drama?.length" class="admin-empty">暂无项目成本</div>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>剧集ID</th><th>项目ID</th><th>成本</th><th>调用</th></tr></thead>
          <tbody>
            <tr v-for="e in (data?.by_episode || []).slice(0, 20)" :key="e.episode_id">
              <td>{{ e.episode_id }}</td>
              <td>{{ e.drama_id ?? '-' }}</td>
              <td>¥ {{ e.cost }}</td>
              <td>{{ e.calls }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!data?.by_episode?.length" class="admin-empty">暂无剧集成本</div>
      </div>
    </div>

    <!-- 调用明细 -->
    <div class="admin-page-title" style="font-size:14px">调用明细</div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>时间</th><th>用户</th><th>服务</th><th>厂商/模型</th><th>用量</th><th>成本</th><th>项目/剧集</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in (data?.details || [])" :key="r.id">
            <td>{{ r.id }}</td>
            <td style="white-space:nowrap">{{ fmt(r.created_at) }}</td>
            <td>{{ r.username || '-' }}</td>
            <td><span class="admin-tag admin-tag-blue">{{ SERVICE_LABEL[r.service_type] || r.service_type }}</span></td>
            <td><div class="admin-cell-text">{{ r.provider }} / {{ r.model }}</div></td>
            <td style="font-size:11.5px">{{ usageLabel(r) }}</td>
            <td>
              <span :class="r.price_missing ? 'admin-tag admin-tag-red' : ''">{{ r.price_missing ? '缺价' : `¥ ${r.cost}` }}</span>
            </td>
            <td style="font-size:11.5px">
              <div>{{ r.drama_title || r.drama_id || '-' }}</div>
              <div v-if="r.drama_id" style="color:var(--text-3);font-size:10.5px">ID {{ r.drama_id }} / 剧集 {{ r.episode_id || '-' }}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!data?.details?.length" class="admin-empty">暂无调用明细</div>
    </div>

    <div class="admin-pager">
      <span>共 {{ data?.details_total ?? 0 }} 条 · 第 {{ page }} 页</span>
      <button class="btn btn-sm" :disabled="page <= 1" @click="load(page - 1)">上一页</button>
      <button class="btn btn-sm" :disabled="(data?.details || []).length < pageSize" @click="load(page + 1)">下一页</button>
    </div>

    <!-- 刊例价维护 -->
    <div class="admin-page-title" style="font-size:14px;margin-top:24px">模型刊例价</div>
    <div class="admin-page-desc">来源：阿里云百炼官网刊例报价；未知模型按 0 计价并标记缺价，可手动修正</div>
    <div class="admin-toolbar">
      <input v-model="priceKeyword" class="input" placeholder="搜索 provider/模型" @keyup.enter="loadPrices" />
      <button class="btn btn-sm" @click="loadPrices">查询</button>
      <div style="flex:1"></div>
      <button class="btn btn-sm btn-primary" @click="openPriceForm()">新增价格</button>
    </div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>厂商</th><th>模型</th><th>计费方式</th><th>输入价</th><th>输出价</th><th>单价</th><th>来源</th><th>更新时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in prices" :key="p.id">
            <td>{{ p.id }}</td>
            <td>{{ p.provider }}</td>
            <td><div class="admin-cell-text" style="font-family:monospace;font-size:11.5px">{{ p.model }}</div></td>
            <td><span class="admin-tag">{{ BILLING_LABEL[p.billing_type] || p.billing_type }}</span></td>
            <td>{{ p.billing_type === 'token' ? p.input_price : '-' }}</td>
            <td>{{ p.billing_type === 'token' ? p.output_price : '-' }}</td>
            <td>{{ p.billing_type === 'token' ? '-' : p.unit_price }}</td>
            <td><div class="admin-cell-text" style="font-size:11px">{{ p.source || '-' }}</div></td>
            <td>{{ fmt(p.updated_at) }}</td>
            <td><button class="btn btn-sm" @click="openPriceForm(p)">编辑</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!prices.length" class="admin-empty">暂无价格记录</div>
    </div>

    <!-- 价格编辑弹窗 -->
    <div v-if="showPriceForm" class="admin-modal-mask" @click.self="showPriceForm = false">
      <div class="admin-modal">
        <div class="admin-page-title">{{ priceForm.id ? '编辑价格' : '新增价格' }}</div>
        <template v-if="!priceForm.id">
          <label class="admin-label">厂商（provider）</label>
          <input v-model="priceForm.provider" class="input" placeholder="如 aliyun-bailian" />
          <label class="admin-label">模型（model）</label>
          <input v-model="priceForm.model" class="input" placeholder="如 qwen-plus" />
          <label class="admin-label">计费方式</label>
          <select v-model="priceForm.billing_type" class="input">
            <option value="token">按 token</option>
            <option value="image">按张</option>
            <option value="video_second">按秒</option>
          </select>
        </template>
        <template v-else>
          <label class="admin-label">模型</label>
          <div class="input" style="opacity:0.6">{{ priceForm.provider }} / {{ priceForm.model }}</div>
        </template>
        <template v-if="priceForm.billing_type === 'token'">
          <label class="admin-label">输入价（元/千 tokens）</label>
          <input v-model.number="priceForm.input_price" class="input" type="number" step="0.0001" />
          <label class="admin-label">输出价（元/千 tokens）</label>
          <input v-model.number="priceForm.output_price" class="input" type="number" step="0.0001" />
        </template>
        <template v-else>
          <label class="admin-label">单价（元/{{ priceForm.billing_type === 'image' ? '张' : '秒' }}）</label>
          <input v-model.number="priceForm.unit_price" class="input" type="number" step="0.0001" />
        </template>
        <div class="admin-modal-actions">
          <button class="btn btn-sm" @click="showPriceForm = false">取消</button>
          <button class="btn btn-sm btn-primary" :disabled="savingPrice" @click="savePrice">{{ savingPrice ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { adminAPI } from '~/composables/useApi'
definePageMeta({ layout: 'admin' })

const SERVICE_LABEL: Record<string, string> = { text: '文本', image: '图片', video: '视频' }
const BILLING_LABEL: Record<string, string> = { token: '按 token', image: '按张', video_second: '按秒' }

const filters = reactive({ user_id: '', drama_id: '', drama_keyword: '', episode_id: '' })
const data = ref<any>(null)
const page = ref(1)
const pageSize = ref(20)
const userOptions = ref<any[]>([])

const prices = ref<any[]>([])
const priceKeyword = ref('')
const showPriceForm = ref(false)
const savingPrice = ref(false)
const priceForm = reactive<any>({ id: null, provider: '', model: '', billing_type: 'token', input_price: 0, output_price: 0, unit_price: 0 })

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}
function usageLabel(r: any) {
  if (r.service_type === 'text') return `${r.input_tokens ?? 0}+${r.output_tokens ?? 0} tok`
  if (r.service_type === 'image') return `${r.image_count ?? 1} 张`
  if (r.service_type === 'video') return `${r.video_seconds ?? 0} 秒`
  return '-'
}

async function load(p = 1) {
  page.value = p
  data.value = await adminAPI.costs({ user_id: filters.user_id, drama_id: filters.drama_id, drama_keyword: filters.drama_keyword, episode_id: filters.episode_id, page: p, page_size: pageSize.value })
}

async function loadPrices() {
  prices.value = await adminAPI.modelPrices({ keyword: priceKeyword.value })
}

function openPriceForm(p?: any) {
  if (p) {
    Object.assign(priceForm, { id: p.id, provider: p.provider, model: p.model, billing_type: p.billing_type, input_price: p.input_price, output_price: p.output_price, unit_price: p.unit_price })
  } else {
    Object.assign(priceForm, { id: null, provider: '', model: '', billing_type: 'token', input_price: 0, output_price: 0, unit_price: 0 })
  }
  showPriceForm.value = true
}

async function savePrice() {
  savingPrice.value = true
  try {
    if (priceForm.id) {
      await adminAPI.updateModelPrice(priceForm.id, {
        input_price: priceForm.input_price, output_price: priceForm.output_price,
        unit_price: priceForm.unit_price, billing_type: priceForm.billing_type,
      })
    } else {
      await adminAPI.createModelPrice({ ...priceForm })
    }
    toast.success('已保存')
    showPriceForm.value = false
    loadPrices()
  } catch (e: any) { toast.error(e.message) } finally { savingPrice.value = false }
}

onMounted(async () => {
  const users = await adminAPI.users({ page: 1, page_size: 200 })
  userOptions.value = users.items
  load(1)
  loadPrices()
})
</script>

<style scoped>
.admin-modal-mask {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
}
.admin-modal {
  width: 380px; max-height: 86vh; overflow-y: auto;
  background: #fff; border-radius: 14px; padding: 22px;
  display: flex; flex-direction: column;
  box-shadow: 0 16px 48px rgba(0,0,0,0.18);
}
.admin-label { font-size: 12px; font-weight: 600; color: var(--text-1); margin: 12px 0 6px; }
.admin-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
