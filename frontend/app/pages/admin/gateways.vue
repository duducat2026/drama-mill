<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/your-org/drama-mill)
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
    <div class="admin-page-title">AI 网关管理</div>
    <div class="admin-page-desc">全用户 AI 服务配置检索；api_key 一律掩码展示</div>

    <div class="admin-toolbar">
      <select v-model="filters.user_id" class="input" @change="load(1)">
        <option value="">全部用户</option>
        <option v-for="u in userOptions" :key="u.id" :value="u.id">{{ u.username }}</option>
      </select>
      <select v-model="filters.service_type" class="input" @change="load(1)">
        <option value="">全部服务</option>
        <option value="text">文本</option>
        <option value="image">图片</option>
        <option value="video">视频</option>
      </select>
      <input v-model="filters.keyword" class="input" placeholder="搜索名称/厂商/模型/网关地址" @keyup.enter="load(1)" />
      <button class="btn btn-sm" @click="load(1)">查询</button>
    </div>

    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>名称</th><th>服务</th><th>厂商</th><th>模型</th><th>网关地址</th><th>API Key</th><th>状态</th><th>用户</th><th>更新时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td>{{ r.id }}</td>
            <td><div class="admin-cell-text">{{ r.name || '-' }}</div></td>
            <td><span class="admin-tag admin-tag-blue">{{ SERVICE_LABEL[r.service_type] || r.service_type }}</span></td>
            <td>{{ r.provider }}</td>
            <td><div class="admin-cell-text">{{ r.model }}</div></td>
            <td><div class="admin-cell-text">{{ r.base_url }}</div></td>
            <td style="font-family:monospace;font-size:11.5px">{{ r.api_key }}</td>
            <td><span class="admin-tag" :class="r.is_active ? 'admin-tag-green' : 'admin-tag-red'">{{ r.is_active ? '启用' : '停用' }}</span></td>
            <td>{{ r.username || '-' }}</td>
            <td>{{ fmt(r.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="admin-empty">暂无网关配置</div>
    </div>

    <div class="admin-pager">
      <span>共 {{ total }} 条 · 第 {{ page }} 页</span>
      <button class="btn btn-sm" :disabled="page <= 1" @click="load(page - 1)">上一页</button>
      <button class="btn btn-sm" :disabled="rows.length < pageSize" @click="load(page + 1)">下一页</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
definePageMeta({ layout: 'admin' })

const SERVICE_LABEL: Record<string, string> = { text: '文本', image: '图片', video: '视频' }

const filters = reactive({ user_id: '', service_type: '', keyword: '' })
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const userOptions = ref<any[]>([])

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}

async function load(p = 1) {
  page.value = p
  const data = await adminAPI.aiConfigs({ user_id: filters.user_id, service_type: filters.service_type, keyword: filters.keyword, page: p, page_size: pageSize.value })
  rows.value = data.items
  total.value = data.total
}

onMounted(async () => {
  const users = await adminAPI.users({ page: 1, page_size: 200 })
  userOptions.value = users.items
  load(1)
})
</script>
