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
    <div class="admin-page-title">平台分镜</div>
    <div class="admin-page-desc">全平台分镜查看，按用户/项目名检索</div>

    <div class="admin-toolbar">
      <select v-model="filters.user_id" class="input" @change="load(1)">
        <option value="">全部用户</option>
        <option v-for="u in userOptions" :key="u.id" :value="u.id">{{ u.username }}</option>
      </select>
      <input v-model="filters.keyword" class="input" placeholder="搜索项目名/分镜标题/视频提示词" @keyup.enter="load(1)" />
      <button class="btn btn-sm" @click="load(1)">查询</button>
    </div>

    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>项目</th><th>剧集</th><th>序号</th><th>分镜标题</th><th>视频提示词</th><th>用户</th><th>创建时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in rows" :key="s.id">
            <td>{{ s.id }}</td>
            <td><div class="admin-cell-text">{{ s.drama_title || '-' }}</div></td>
            <td>
              <div class="admin-cell-text">{{ s.episode_title || '-' }}</div>
              <div v-if="s.episode_number" class="admin-cells-sub">第 {{ s.episode_number }} 集</div>
            </td>
            <td>{{ s.storyboard_number ?? '-' }}</td>
            <td><div class="admin-cell-text">{{ s.title || '-' }}</div></td>
            <td><div class="admin-cell-text" :title="s.video_prompt">{{ s.video_prompt || '-' }}</div></td>
            <td>{{ s.username || '-' }}</td>
            <td>{{ fmt(s.created_at) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="admin-empty">暂无分镜</div>
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

const filters = reactive({ user_id: '', keyword: '' })
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
  const data = await adminAPI.storyboards({ user_id: filters.user_id, keyword: filters.keyword, page: p, page_size: pageSize.value })
  rows.value = data.items
  total.value = data.total
}

onMounted(async () => {
  const users = await adminAPI.users({ page: 1, page_size: 200 })
  userOptions.value = users.items
  load(1)
})
</script>
