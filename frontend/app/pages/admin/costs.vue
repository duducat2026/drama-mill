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
    <div class="admin-page-desc">全平台成本聚合（按用户/项目检索下钻明细）；模型刊例价维护已整合到「模型目录价」页</div>

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
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
definePageMeta({ layout: 'admin' })

const SERVICE_LABEL: Record<string, string> = { text: '文本', image: '图片', video: '视频' }

const filters = reactive({ user_id: '', drama_id: '', drama_keyword: '', episode_id: '' })
const data = ref<any>(null)
const page = ref(1)
const pageSize = ref(20)
const userOptions = ref<any[]>([])

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

onMounted(() => {
  // 用户下拉与列表并行：串行 await 会给首屏多挡一个往返
  adminAPI.users({ page: 1, page_size: 200 })
    .then(users => { userOptions.value = users.items })
    .catch(() => { /* 用户列表失败不阻断列表加载 */ })
  load(1)
})
</script>

<style scoped>
</style>
