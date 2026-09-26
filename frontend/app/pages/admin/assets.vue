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
    <div class="admin-page-title">资产管理</div>
    <div class="admin-page-desc">全用户资产（角色/场景/道具/分镜图片与视频）检索与预览</div>

    <div class="admin-toolbar">
      <select v-model="filters.user_id" class="input" @change="load(1)">
        <option value="">全部用户</option>
        <option v-for="u in userOptions" :key="u.id" :value="u.id">{{ u.username }}</option>
      </select>
      <select v-model="filters.type" class="input" @change="load(1)">
        <option value="">全部类型</option>
        <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ t }}</option>
      </select>
      <input v-model="filters.drama_keyword" class="input" placeholder="搜索项目名称" @keyup.enter="load(1)" />
      <input v-model="filters.keyword" class="input" placeholder="搜索名称/描述" @keyup.enter="load(1)" />
      <button class="btn btn-sm" @click="load(1)">查询</button>
    </div>

    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>预览</th><th>名称</th><th>类型</th><th>分类</th><th>用户</th><th>项目</th><th>创建时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in rows" :key="`${a.type}-${a.id}`">
            <td>{{ a.id }}</td>
            <td>
              <img v-if="isImage(a)" class="admin-preview" :src="thumbOf(mediaUrl(a.url))" loading="lazy" @error="thumbFallback($event, mediaUrl(a.url))" @click="preview = a" style="cursor:zoom-in" />
              <video v-else-if="isVideo(a)" class="admin-preview" :src="mediaUrl(a.url)" :poster="posterOf(mediaUrl(a.url))" muted preload="metadata" @click="preview = a" style="cursor:zoom-in" />
              <span v-else class="admin-cell-text">-</span>
            </td>
            <td><div class="admin-cell-text">{{ a.name || '-' }}</div></td>
            <td><span class="admin-tag">{{ a.type || '-' }}</span></td>
            <td>{{ a.category || '-' }}</td>
            <td>{{ a.username || '-' }}</td>
            <td>{{ a.drama_title || a.drama_id || '-' }}</td>
            <td>{{ fmt(a.created_at) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="admin-empty">暂无资产</div>
    </div>

    <div class="admin-pager">
      <span>共 {{ total }} 条 · 第 {{ page }} 页</span>
      <button class="btn btn-sm" :disabled="page <= 1" @click="load(page - 1)">上一页</button>
      <button class="btn btn-sm" :disabled="rows.length < pageSize" @click="load(page + 1)">下一页</button>
    </div>

    <!-- 预览弹窗 -->
    <div v-if="preview" class="admin-modal-mask" @click.self="preview = null">
      <div class="asset-preview-box">
        <img v-if="isImage(preview)" :src="mediaUrl(preview.url)" />
        <video v-else :src="mediaUrl(preview.url)" :poster="posterOf(mediaUrl(preview.url))" controls autoplay />
        <div class="asset-preview-name">{{ preview.name || `资产 #${preview.id}` }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
import { thumbOf, thumbFallback, posterOf } from '~/composables/useMedia'
definePageMeta({ layout: 'admin' })

const TYPE_OPTIONS = ['character', 'scene', 'prop', 'storyboard', 'image', 'video']

const filters = reactive({ user_id: '', type: '', keyword: '', drama_keyword: '' })
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const preview = ref<any>(null)
const userOptions = ref<any[]>([])

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}
function isImage(a: any) {
  return /image/i.test(a.mime_type || '') || /\.(png|jpe?g|webp|gif)$/i.test(a.url || '')
}
function isVideo(a: any) {
  return /video/i.test(a.mime_type || '') || /\.(mp4|webm|mov)$/i.test(a.url || '')
}
/** 媒体地址归一：库中存的是相对路径（static/...），/admin 路由下需补前导斜杠，与其他 admin 页一致 */
function mediaUrl(p?: string | null) {
  if (!p) return ''
  return p.startsWith('/') || p.startsWith('http') ? p : `/${p}`
}

async function load(p = 1) {
  page.value = p
  const data = await adminAPI.assets({ user_id: filters.user_id, type: filters.type, keyword: filters.keyword, drama_keyword: filters.drama_keyword, page: p, page_size: pageSize.value })
  rows.value = data.items
  total.value = data.total
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
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.asset-preview-box { display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 80vw; max-height: 85vh; }
.asset-preview-box img, .asset-preview-box video { max-width: 80vw; max-height: 78vh; border-radius: 10px; background: #000; }
.asset-preview-name { color: #fff; font-size: 12.5px; opacity: 0.85; }
</style>
