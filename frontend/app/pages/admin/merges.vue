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
    <div class="admin-page-title">拼接成片</div>
    <div class="admin-page-desc">全平台剧集拼接成片查看，按用户/项目名/创作日期检索</div>

    <div class="admin-toolbar">
      <select v-model="filters.user_id" class="input" @change="load(1)">
        <option value="">全部用户</option>
        <option v-for="u in userOptions" :key="u.id" :value="u.id">{{ u.username }}</option>
      </select>
      <input v-model="filters.keyword" class="input" placeholder="搜索标题/项目名" @keyup.enter="load(1)" />
      <input v-model="filters.from" class="input" type="date" @change="load(1)" />
      <span style="color:var(--text-3);font-size:12px">至</span>
      <input v-model="filters.to" class="input" type="date" @change="load(1)" />
      <button class="btn btn-sm" @click="load(1)">查询</button>
    </div>

    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>预览</th><th>标题</th><th>项目</th><th>时长(秒)</th><th>状态</th><th>用户</th><th>创建时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="m in rows" :key="m.id">
            <td>{{ m.id }}</td>
            <td>
              <video v-if="m.merged_url" class="admin-preview" :src="mediaUrl(m.merged_url)" :poster="posterOf(mediaUrl(m.merged_url))" muted preload="metadata" @click="preview = m" style="cursor:zoom-in" />
              <span v-else>-</span>
            </td>
            <td><div class="admin-cell-text">{{ m.title || '-' }}</div></td>
            <td><div class="admin-cell-text">{{ m.drama_title || '-' }}</div></td>
            <td>{{ m.duration ?? '-' }}</td>
            <td><span class="admin-tag" :class="m.status === 'completed' ? 'admin-tag-green' : m.status === 'failed' ? 'admin-tag-red' : 'admin-tag-blue'">{{ m.status }}</span></td>
            <td>{{ m.username || '-' }}</td>
            <td>{{ fmt(m.created_at) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="admin-empty">暂无拼接成片</div>
    </div>

    <div class="admin-pager">
      <span>共 {{ total }} 条 · 第 {{ page }} 页</span>
      <button class="btn btn-sm" :disabled="page <= 1" @click="load(page - 1)">上一页</button>
      <button class="btn btn-sm" :disabled="rows.length < pageSize" @click="load(page + 1)">下一页</button>
    </div>

    <!-- 预览弹窗 -->
    <div v-if="preview" class="admin-modal-mask" @click.self="preview = null">
      <div class="merge-preview-box">
        <video :src="mediaUrl(preview.merged_url)" :poster="posterOf(mediaUrl(preview.merged_url))" controls autoplay />
        <div class="merge-preview-name">{{ preview.title || `成片 #${preview.id}` }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
import { posterOf } from '~/composables/useMedia'
definePageMeta({ layout: 'admin' })

const filters = reactive({ user_id: '', keyword: '', from: '', to: '' })
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const preview = ref<any>(null)
const userOptions = ref<any[]>([])

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}
function mediaUrl(p?: string | null) {
  if (!p) return ''
  return p.startsWith('/') || p.startsWith('http') ? p : `/${p}`
}

async function load(p = 1) {
  page.value = p
  const data = await adminAPI.merges({ user_id: filters.user_id, keyword: filters.keyword, from: filters.from, to: filters.to, page: p, page_size: pageSize.value })
  rows.value = data.items
  total.value = data.total
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
.admin-modal-mask {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.merge-preview-box { display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 80vw; max-height: 85vh; }
.merge-preview-box video { max-width: 80vw; max-height: 78vh; border-radius: 10px; background: #000; }
.merge-preview-name { color: #fff; font-size: 12.5px; opacity: 0.85; }
</style>
