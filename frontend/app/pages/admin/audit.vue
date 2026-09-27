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
    <div class="admin-page-title">操作审计</div>
    <div class="admin-page-desc">写操作审计日志（POST/PUT/DELETE），按用户/动作/路径/日期检索；敏感字段已脱敏</div>

    <div class="admin-toolbar">
      <input v-model="filters.username" class="input" placeholder="用户名" @keyup.enter="load(1)" />
      <input v-model="filters.action" class="input" placeholder="动作（如 create）" @keyup.enter="load(1)" />
      <input v-model="filters.path" class="input" placeholder="路径关键词" @keyup.enter="load(1)" />
      <input v-model="filters.from" class="input" type="date" @change="load(1)" />
      <span style="color:var(--text-3);font-size:12px">至</span>
      <input v-model="filters.to" class="input" type="date" @change="load(1)" />
      <button class="btn btn-sm" @click="load(1)">查询</button>
    </div>

    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>时间</th><th>用户</th><th>方法</th><th>路径</th><th>动作</th><th>状态</th><th>IP</th><th>详情</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td>{{ r.id }}</td>
            <td style="white-space:nowrap">{{ fmt(r.created_at) }}</td>
            <td>
              <div>{{ r.username || '-' }}</div>
              <div v-if="r.role" class="admin-cells-sub">{{ r.role === 'admin' ? '管理员' : '用户' }}</div>
            </td>
            <td><span class="admin-tag" :class="methodClass(r.method)">{{ r.method }}</span></td>
            <td><div class="admin-cell-text" style="font-family:monospace;font-size:11.5px">{{ r.path }}</div></td>
            <td>{{ r.action || '-' }}</td>
            <td><span class="admin-tag" :class="Number(r.status) < 400 ? 'admin-tag-green' : 'admin-tag-red'">{{ r.status }}</span></td>
            <td style="font-size:11.5px">{{ r.ip || '-' }}</td>
            <td><div class="admin-cell-text" :title="r.detail">{{ r.detail || '-' }}</div></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="admin-empty">暂无审计记录</div>
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

const filters = reactive({ username: '', action: '', path: '', from: '', to: '' })
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}
function methodClass(method: string) {
  if (method === 'DELETE') return 'admin-tag-red'
  if (method === 'POST') return 'admin-tag-blue'
  return ''
}

async function load(p = 1) {
  page.value = p
  const data = await adminAPI.audit({ ...filters, page: p, page_size: pageSize.value })
  rows.value = data.items
  total.value = data.total
}

onMounted(() => load(1))
</script>
