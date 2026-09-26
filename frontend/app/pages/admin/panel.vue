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
    <div class="admin-page-title">生产面板</div>
    <div class="admin-page-desc">队列状态、任务聚合、各网关自适应限流统计与最近 429（每 5 秒自动刷新）</div>

    <!-- 队列与任务聚合 -->
    <div class="admin-stat-grid">
      <div class="admin-stat">
        <div class="admin-stat-label">上游生成中（轮询）</div>
        <div class="admin-stat-value">{{ panel?.queue?.polling ?? '-' }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">提交中任务</div>
        <div class="admin-stat-value">{{ panel?.queue?.running ?? '-' }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">排队中任务</div>
        <div class="admin-stat-value">{{ panel?.queue?.queued ?? '-' }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">提交并发上限</div>
        <div class="admin-stat-value">{{ panel?.queue?.max ?? '-' }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">最近 24h 任务</div>
        <div class="admin-stat-value">{{ panel?.recent_24h?.total ?? '-' }}</div>
      </div>
      <div v-for="(count, status) in (panel?.tasks_by_status || {})" :key="status" class="admin-stat">
        <div class="admin-stat-label">任务状态 · {{ status }}</div>
        <div class="admin-stat-value">{{ count }}</div>
      </div>
    </div>

    <!-- 网关自适应限流统计 -->
    <div class="admin-page-title" style="font-size:14px">网关自适应限流</div>
    <div class="admin-page-desc">初始间隔来自配置 QPM；命中 429 翻倍（上限 120s），连续成功 10 次减半恢复</div>
    <div class="admin-table-wrap" style="margin-bottom:18px">
      <table class="admin-table">
        <thead>
          <tr><th>网关</th><th>厂商</th><th>初始间隔</th><th>当前间隔</th><th>提交数</th><th>429 次数</th><th>连续成功</th><th>最近提交</th></tr>
        </thead>
        <tbody>
          <tr v-for="g in (panel?.gateways || [])" :key="g.gateway">
            <td><div class="admin-cell-text" style="font-family:monospace;font-size:11.5px">{{ g.gateway }}</div></td>
            <td>{{ g.provider }}</td>
            <td>{{ fmtMs(g.base_interval_ms) }}</td>
            <td>
              <span class="admin-tag" :class="g.interval_ms > g.base_interval_ms ? 'admin-tag-red' : 'admin-tag-green'">{{ fmtMs(g.interval_ms) }}</span>
            </td>
            <td>{{ g.submits }}</td>
            <td>{{ g.rate_limited }}</td>
            <td>{{ g.success_streak }}</td>
            <td>{{ fmt(g.last_submit_at) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!panel?.gateways?.length" class="admin-empty">暂无网关活动（提交生成任务后出现）</div>
    </div>

    <!-- 最近 429 -->
    <div class="admin-page-title" style="font-size:14px">最近限流命中（429）</div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>任务ID</th><th>类型</th><th>厂商</th><th>模型</th><th>错误信息</th><th>时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in (panel?.recent_429 || [])" :key="t.id">
            <td>{{ t.id }}</td>
            <td><span class="admin-tag">{{ t.type }}</span></td>
            <td>{{ t.provider }}</td>
            <td><div class="admin-cell-text">{{ t.model || '-' }}</div></td>
            <td><div class="admin-cell-text" :title="t.error_msg">{{ t.error_msg }}</div></td>
            <td>{{ fmt(t.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!panel?.recent_429?.length" class="admin-empty">暂无限流命中记录</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
definePageMeta({ layout: 'admin' })

const panel = ref<any>(null)
let timer: ReturnType<typeof setTimeout> | undefined

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}
function fmtMs(ms?: number | null) {
  if (ms == null) return '-'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

async function refresh() {
  try {
    panel.value = await adminAPI.panel()
  } catch { /* 轮询静默失败 */ }
}

// 活跃任务感知频率：有运行/排队任务 5s，空闲 30s；请求完成后再排程，页面隐藏停轮、回前台立即补一次
const ACTIVE_INTERVAL = 5000
const IDLE_INTERVAL = 30000
function hasActiveWork(): boolean {
  const q = panel.value?.queue || {}
  const byStatus = panel.value?.tasks_by_status || {}
  return Number(q.running || 0) + Number(q.queued || 0) + Number(q.polling || 0)
    + Number(byStatus.processing || 0) + Number(byStatus.pending || 0) > 0
}
function schedule() {
  clearTimeout(timer)
  if (typeof document !== 'undefined' && document.hidden) return
  timer = setTimeout(tick, hasActiveWork() ? ACTIVE_INTERVAL : IDLE_INTERVAL)
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
