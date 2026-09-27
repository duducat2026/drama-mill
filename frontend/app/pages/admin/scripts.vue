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
    <div class="admin-page-title">平台剧本</div>
    <div class="admin-page-desc">全平台剧集：原始内容与 AI 改写内容查看，按用户/项目名/创作日期区间检索</div>

    <div class="admin-toolbar">
      <select v-model="filters.user_id" class="input" @change="load(1)">
        <option value="">全部用户</option>
        <option v-for="u in userOptions" :key="u.id" :value="u.id">{{ u.username }}</option>
      </select>
      <input v-model="filters.keyword" class="input" placeholder="搜索项目名/简介" @keyup.enter="load(1)" />
      <input v-model="filters.from" class="input" type="date" @change="load(1)" />
      <span style="color:var(--text-3);font-size:12px">至</span>
      <input v-model="filters.to" class="input" type="date" @change="load(1)" />
      <button class="btn btn-sm" @click="load(1)">查询</button>
    </div>

    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>项目名</th><th>用户</th><th>集数</th><th>创建时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="d in rows" :key="d.id">
            <td>{{ d.id }}</td>
            <td>
              <div class="admin-cell-text" style="font-weight:600">{{ d.title }}</div>
              <div v-if="d.description" class="admin-cells-sub admin-cell-text">{{ d.description }}</div>
            </td>
            <td>{{ d.username || '-' }}</td>
            <td>{{ d.episode_count }}</td>
            <td>{{ fmt(d.created_at) }}</td>
            <td><button class="btn btn-sm" @click="openDrama(d)">查看剧集</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="admin-empty">暂无剧集</div>
    </div>

    <div class="admin-pager">
      <span>共 {{ total }} 条 · 第 {{ page }} 页</span>
      <button class="btn btn-sm" :disabled="page <= 1" @click="load(page - 1)">上一页</button>
      <button class="btn btn-sm" :disabled="rows.length < pageSize" @click="load(page + 1)">下一页</button>
    </div>

    <!-- 剧集明细弹窗：原始内容 + AI 改写内容 -->
    <div v-if="drama" class="admin-modal-mask" @click.self="drama = null">
      <div class="script-modal">
        <div class="admin-page-title">{{ drama.title }} · 剧集明细</div>
        <div class="script-ep-list">
          <div v-for="e in episodes" :key="e.id" class="script-ep">
            <div class="script-ep-head" @click="toggleEp(e.id)">
              <span>第 {{ e.episode_number }} 集 · {{ e.title || `第${e.episode_number}集` }}</span>
              <span class="admin-tag" :class="expanded === e.id ? 'admin-tag-blue' : ''">{{ expanded === e.id ? '收起' : '展开' }}</span>
            </div>
            <div v-if="expanded === e.id" class="script-ep-body">
              <div class="script-col">
                <div class="script-col-title">原始内容</div>
                <pre class="script-text">{{ e.content || '（空）' }}</pre>
              </div>
              <div class="script-col">
                <div class="script-col-title">AI 改写内容</div>
                <pre class="script-text">{{ e.script_content || '（空）' }}</pre>
              </div>
            </div>
          </div>
          <div v-if="!episodes.length" class="admin-empty">暂无剧集</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
definePageMeta({ layout: 'admin' })

const filters = reactive({ user_id: '', keyword: '', from: '', to: '' })
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const userOptions = ref<any[]>([])

const drama = ref<any>(null)
const episodes = ref<any[]>([])
const expanded = ref<number | null>(null)

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}
function toggleEp(id: number) {
  expanded.value = expanded.value === id ? null : id
}

async function load(p = 1) {
  page.value = p
  const data = await adminAPI.dramas({ user_id: filters.user_id, keyword: filters.keyword, from: filters.from, to: filters.to, page: p, page_size: pageSize.value })
  rows.value = data.items
  total.value = data.total
}

async function openDrama(d: any) {
  drama.value = d
  expanded.value = null
  episodes.value = await adminAPI.dramaEpisodes(d.id)
}

onMounted(async () => {
  const users = await adminAPI.users({ page: 1, page_size: 200 })
  userOptions.value = users.items
  load(1)
})
</script>

<style scoped>
.admin-modal-mask {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
}
.script-modal {
  width: min(1080px, 92vw); max-height: 86vh;
  background: #fff; border-radius: 14px; padding: 22px;
  display: flex; flex-direction: column;
  box-shadow: 0 16px 48px rgba(0,0,0,0.18);
}
.script-ep-list { overflow-y: auto; margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.script-ep { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.script-ep-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; font-size: 13px; font-weight: 600; color: var(--text-1);
  cursor: pointer; background: rgba(0,0,0,0.02);
}
.script-ep-body { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border-top: 1px solid var(--border); }
.script-col { padding: 12px 14px; min-width: 0; }
.script-col + .script-col { border-left: 1px solid var(--border); }
.script-col-title { font-size: 11.5px; font-weight: 600; color: var(--text-3); margin-bottom: 8px; }
.script-text {
  font-size: 12px; line-height: 1.7; color: var(--text-1);
  max-height: 46vh; overflow-y: auto;
  white-space: pre-wrap; word-break: break-all;
  margin: 0; font-family: inherit;
}
</style>
