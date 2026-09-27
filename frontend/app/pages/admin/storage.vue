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
    <div class="admin-page-title">存储监控</div>
    <div class="admin-page-desc">本地磁盘空间与生成素材/视频占用统计（df/du 探测，每 60 秒自动刷新）</div>

    <div class="admin-toolbar">
      <button class="btn btn-sm" :disabled="loading" @click="refresh">
        {{ loading ? '统计中…' : '刷新' }}
      </button>
      <span v-if="data?.generated_at" class="storage-updated">更新于 {{ fmt(data.generated_at) }}</span>
    </div>

    <!-- 磁盘空间 -->
    <div class="admin-page-title" style="font-size:14px">磁盘空间</div>
    <div class="admin-stat-grid">
      <div class="admin-stat">
        <div class="admin-stat-label">挂载点</div>
        <div class="admin-stat-value" style="font-size:14px;word-break:break-all">{{ data?.disk?.mount || '-' }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">总容量</div>
        <div class="admin-stat-value">{{ fmtSize(data?.disk?.total_bytes) }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">已用</div>
        <div class="admin-stat-value">{{ fmtSize(data?.disk?.used_bytes) }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">可用</div>
        <div class="admin-stat-value">{{ fmtSize(data?.disk?.free_bytes) }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">使用率</div>
        <div class="admin-stat-value">
          <span class="admin-tag" :class="usageTagClass">{{ data?.disk?.used_percent != null ? `${data.disk.used_percent}%` : '-' }}</span>
        </div>
      </div>
    </div>
    <div v-if="data?.disk" class="storage-bar">
      <div class="storage-bar-fill" :class="usageBarClass" :style="{ width: `${Math.min(100, data.disk.used_percent)}%` }"></div>
    </div>

    <!-- 分类目录占用 -->
    <div class="admin-page-title" style="font-size:14px;margin-top:20px">生成素材/视频占用</div>
    <div class="admin-page-desc">存储根：{{ data?.storage_root || '-' }} · 合计 {{ fmtSize(data?.storage_total_bytes) }}</div>
    <div class="admin-table-wrap" style="margin-bottom:18px">
      <table class="admin-table">
        <thead>
          <tr><th>分类</th><th>目录</th><th>文件数</th><th>大小</th><th style="width:26%">占比</th></tr>
        </thead>
        <tbody>
          <tr v-for="cat in (data?.categories || [])" :key="cat.key">
            <td><div>{{ cat.label }}</div><div class="admin-cells-sub">{{ cat.key }}</div></td>
            <td><div class="admin-cell-text" style="font-family:monospace;font-size:11.5px" :title="cat.path">{{ cat.path }}</div></td>
            <td>{{ cat.files }}</td>
            <td style="font-weight:600">{{ fmtSize(cat.bytes) }}</td>
            <td>
              <div class="storage-bar storage-bar-sm">
                <div class="storage-bar-fill storage-bar-blue" :style="{ width: `${Math.min(100, cat.percent)}%` }"></div>
              </div>
              <div class="admin-cells-sub">{{ cat.percent }}%</div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!data?.categories?.length && !loading" class="admin-empty">暂无统计数据</div>
    </div>

    <!-- 用户空间占用 -->
    <div class="admin-page-title" style="font-size:14px">用户空间占用</div>
    <div class="admin-page-desc">多租户存储布局下按用户目录（{分类}/{user_id}/）聚合，按占用降序 · 历史遗留未归属文件不计入 · 全局默认配额 {{ fmtSize(data?.default_quota_bytes) }}，可在用户管理中按用户覆盖</div>
    <div class="admin-table-wrap" style="margin-bottom:18px">
      <table class="admin-table">
        <thead>
          <tr><th>用户</th><th>图片</th><th>视频</th><th>成片</th><th>上传</th><th>合计</th><th>配额</th><th style="width:18%">配额占用</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in (data?.users || [])" :key="u.user_id">
            <td>
              <div>{{ u.username }}</div>
              <div class="admin-cells-sub">ID {{ u.user_id }}</div>
            </td>
            <td>{{ fmtSize(userCatBytes(u, 'images')) }}</td>
            <td>{{ fmtSize(userCatBytes(u, 'videos')) }}</td>
            <td>{{ fmtSize(userCatBytes(u, 'merged')) }}</td>
            <td>{{ fmtSize(userCatBytes(u, 'uploads')) }}</td>
            <td style="font-weight:600">{{ fmtSize(u.total_bytes) }}</td>
            <td>
              <template v-if="u.quota_bytes">{{ fmtSize(u.quota_bytes) }}</template>
              <span v-else class="admin-cells-sub">-</span>
            </td>
            <td>
              <template v-if="u.quota_bytes">
                <div class="storage-bar storage-bar-sm">
                  <div class="storage-bar-fill" :class="u.exceeded ? 'storage-bar-red' : 'storage-bar-blue'" :style="{ width: `${Math.min(100, userQuotaPercent(u))}%` }"></div>
                </div>
                <div class="admin-cells-sub" :style="u.exceeded ? { color: 'var(--action-danger, #d70015)', fontWeight: 600 } : {}">
                  {{ userQuotaPercent(u) }}%{{ u.exceeded ? ' · 超额' : '' }}
                </div>
              </template>
              <span v-else class="admin-cells-sub">不计配额</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!data?.users?.length && !loading" class="admin-empty">暂无用户空间数据</div>
    </div>

    <!-- 最大文件 -->
    <div class="admin-page-title" style="font-size:14px">最大文件 TOP {{ data?.top_files?.length || 10 }}</div>
    <div class="admin-page-desc">视频片段与拼接成片目录中占用最大的文件</div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>文件名</th><th>分类</th><th>大小</th><th>路径</th></tr>
        </thead>
        <tbody>
          <tr v-for="f in (data?.top_files || [])" :key="f.path">
            <td><div class="admin-cell-text">{{ f.name }}</div></td>
            <td><span class="admin-tag" :class="f.category === 'merged' ? 'admin-tag-blue' : ''">{{ f.category }}</span></td>
            <td style="font-weight:600">{{ fmtSize(f.bytes) }}</td>
            <td><div class="admin-cell-text" style="font-family:monospace;font-size:11px" :title="f.path">{{ f.path }}</div></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!data?.top_files?.length && !loading" class="admin-empty">暂无视频/成片文件</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
definePageMeta({ layout: 'admin' })

const data = ref<any>(null)
const loading = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}
function fmtSize(bytes?: number | null) {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

/** 用户空间内指定分类的字节数（后端契约为 {分类: 字节 } 对象映射；兼容数组形态，缺失分类返回 0） */
function userCatBytes(u: any, key: string): number {
  const pc = u?.per_category
  if (!pc) return 0
  if (Array.isArray(pc)) return pc.find((c: any) => c?.key === key)?.bytes || 0
  return pc[key] || 0
}

// 用户配额占用百分比（超额时可 >100，进度条内自行截断）
function userQuotaPercent(u: any): number {
  return u?.quota_bytes ? +(u.total_bytes / u.quota_bytes * 100).toFixed(1) : 0
}

const usageTagClass = computed(() => {
  const p = data.value?.disk?.used_percent ?? 0
  return p >= 90 ? 'admin-tag-red' : p >= 75 ? '' : 'admin-tag-green'
})
const usageBarClass = computed(() => {
  const p = data.value?.disk?.used_percent ?? 0
  return p >= 90 ? 'storage-bar-red' : p >= 75 ? 'storage-bar-warn' : 'storage-bar-green'
})

async function refresh() {
  if (loading.value) return
  loading.value = true
  try {
    data.value = await adminAPI.storageStats()
  } catch { /* 静默失败，保留旧数据 */ } finally {
    loading.value = false
  }
}

// 60s 低频刷新：请求完成后再排程（后端已有 60s 缓存，前端不再叠加）；页面隐藏停轮、回前台补一次
const REFRESH_INTERVAL = 60000
function schedule() {
  clearTimeout(timer)
  if (typeof document !== 'undefined' && document.hidden) return
  timer = setTimeout(tick, REFRESH_INTERVAL)
}
async function tick() {
  await refresh()
  schedule()
}
function onVisibility() {
  if (typeof document !== 'undefined' && !document.hidden) tick()
}

onMounted(() => {
  tick()
  document.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => {
  if (timer !== undefined) clearTimeout(timer)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<style scoped>
.storage-updated { font-size: 11.5px; color: var(--text-3); }

.storage-bar {
  height: 8px; border-radius: var(--radius-pill);
  background: rgba(0,0,0,0.06);
  overflow: hidden;
  margin-bottom: 4px;
}
.storage-bar-sm { height: 5px; margin-bottom: 3px; }
.storage-bar-fill { height: 100%; border-radius: var(--radius-pill); transition: width 0.3s var(--ease-out); }
.storage-bar-green { background: rgba(52,199,89,0.8); }
.storage-bar-warn { background: rgba(255,149,0,0.85); }
.storage-bar-red { background: rgba(255,59,48,0.85); }
.storage-bar-blue { background: var(--accent-text); }
</style>
