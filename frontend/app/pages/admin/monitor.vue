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
    <div class="admin-page-title">运行监控</div>
    <div class="admin-page-desc">生成任务趋势、状态分布、失败画像与网关健康（每 30 秒自动刷新）</div>

    <div class="admin-toolbar">
      <button class="btn btn-sm" :disabled="loading" @click="refresh">
        {{ loading ? '统计中…' : '刷新' }}
      </button>
      <span v-if="data?.generated_at" class="monitor-updated">更新于 {{ fmtTime(data.generated_at) }}</span>
      <span v-if="data?.system" class="monitor-updated">
        运行 {{ fmtUptime(data.system.uptime_sec) }} · Node {{ data.system.node_version }}
      </span>
    </div>

    <!-- 概览指标卡 -->
    <div class="admin-stat-grid">
      <div class="admin-stat">
        <div class="admin-stat-label">磁盘使用率</div>
        <div class="admin-stat-value">
          <span :class="['admin-tag', diskTagClass]">{{ data?.disk?.used_percent != null ? `${data.disk.used_percent}%` : '-' }}</span>
        </div>
        <div v-if="data?.disk" class="monitor-bar monitor-bar-sm">
          <div class="monitor-bar-fill" :class="diskBarClass" :style="{ width: `${Math.min(100, data.disk.used_percent)}%` }"></div>
        </div>
        <div class="admin-cells-sub">{{ fmtSize(data?.disk?.free_bytes) }} 可用 / 共 {{ fmtSize(data?.disk?.total_bytes) }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">内存占用（RSS）</div>
        <div class="admin-stat-value">{{ data?.system?.memory_rss_mb != null ? `${data.system.memory_rss_mb} MB` : '-' }}</div>
        <div class="admin-cells-sub">堆内存 {{ data?.system?.heap_used_mb ?? '-' }} MB</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">在途任务</div>
        <div class="admin-stat-value">{{ statusCount('processing') }}</div>
        <div class="admin-cells-sub">执行中 {{ data?.queue?.running ?? 0 }} · 轮询中 {{ data?.queue?.polling ?? 0 }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">排队任务</div>
        <div class="admin-stat-value">{{ data?.queue?.queued ?? 0 }}</div>
        <div class="admin-cells-sub">并发上限 {{ data?.queue?.max ?? '-' }}</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">24h 新提交</div>
        <div class="admin-stat-value">{{ sum24h('created') }}</div>
        <div class="admin-cells-sub">按提交时间统计</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">24h 完成</div>
        <div class="admin-stat-value" style="color:#1a7f37">{{ sum24h('completed') }}</div>
        <div class="admin-cells-sub">按完成时间统计</div>
      </div>
      <div class="admin-stat">
        <div class="admin-stat-label">24h 失败</div>
        <div class="admin-stat-value" :style="{ color: sum24h('failed') ? 'var(--action-danger)' : '' }">{{ sum24h('failed') }}</div>
        <div class="admin-cells-sub">按失败时间统计</div>
      </div>
    </div>

    <!-- 存储配额超额告警：用户用量超过生效配额时在此醒目展示 -->
    <div v-if="data?.over_quota_users?.length" class="monitor-quota-alert" role="alert">
      <div class="monitor-quota-alert-head">存储配额超额告警 · {{ data.over_quota_users.length }} 位用户</div>
      <div class="monitor-quota-alert-list">
        <div v-for="u in data.over_quota_users" :key="u.user_id" class="monitor-quota-alert-item">
          <span class="monitor-quota-alert-name">{{ u.username }}</span>
          <span class="monitor-quota-alert-detail">
            已用 {{ fmtSize(u.used_bytes) }} / 配额 {{ fmtSize(u.quota_bytes) }}
            （{{ quotaPercent(u) }}%）
          </span>
        </div>
      </div>
    </div>

    <!-- 趋势 + 状态分布（拆分为子组件，样式复用父页全局 monitor-* 类） -->
    <AdminMonitorCharts :data="data" />

    <!-- 失败画像 + 网关健康 -->
    <div class="monitor-charts">
      <div class="monitor-card">
        <div class="monitor-card-head"><span class="monitor-card-title">失败原因画像（全量失败任务）</span></div>
        <div v-if="data?.error_classes?.length" class="monitor-errs">
          <div v-for="e in data.error_classes" :key="e.label" class="monitor-err-row">
            <span class="monitor-err-label" :title="e.label">{{ e.label }}</span>
            <div class="monitor-bar">
              <div class="monitor-bar-fill monitor-bar-red" :style="{ width: `${errPercent(e.count)}%` }"></div>
            </div>
            <span class="monitor-err-count">{{ e.count }}</span>
          </div>
        </div>
        <div v-else class="admin-empty">暂无失败任务</div>
      </div>

      <div class="monitor-card">
        <div class="monitor-card-head"><span class="monitor-card-title">网关健康</span></div>
        <div class="admin-table-wrap" style="border:none;border-radius:0">
          <table class="admin-table">
            <thead>
              <tr><th>网关</th><th>提交间隔</th><th>提交数</th><th>限流次数</th><th>最近提交</th></tr>
            </thead>
            <tbody>
              <tr v-for="g in (data?.gateways || [])" :key="g.gateway">
                <td>
                  <div>{{ g.gateway }}</div>
                  <div class="admin-cells-sub">{{ g.provider }}</div>
                </td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px">
                    <div class="monitor-bar monitor-bar-sm" style="width:64px">
                      <div class="monitor-bar-fill" :class="gatewayBarClass(g)" :style="{ width: `${gatewayPressure(g)}%` }"></div>
                    </div>
                    <span :title="`基准 ${g.base_interval_ms}ms`">{{ g.interval_ms }}ms</span>
                  </div>
                </td>
                <td>{{ g.submits }}</td>
                <td><span :class="['admin-tag', g.rate_limited ? 'admin-tag-red' : 'admin-tag-green']">{{ g.rate_limited }}</span></td>
                <td class="admin-cells-sub">{{ g.last_submit_at ? fmtTime(g.last_submit_at) : '-' }}</td>
              </tr>
              <tr v-if="!data?.gateways?.length"><td colspan="5" class="admin-empty">暂无网关活动</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 批次生产状态 -->
    <div class="monitor-card" style="margin-top:14px">
      <div class="monitor-card-head"><span class="monitor-card-title">批次生产状态</span></div>
      <div class="monitor-batches">
        <div class="monitor-batch-group">
          <span class="monitor-batch-cap">批次</span>
          <span v-for="b in batchChips('by_status')" :key="b.label" :class="['admin-tag', b.cls]">{{ b.label }} {{ b.count }}</span>
          <span v-if="!batchChips('by_status').length" class="admin-cells-sub">暂无批次</span>
        </div>
        <div class="monitor-batch-group">
          <span class="monitor-batch-cap">剧目</span>
          <span v-for="b in batchChips('items_by_status')" :key="b.label" :class="['admin-tag', b.cls]">{{ b.label }} {{ b.count }}</span>
          <span v-if="!batchChips('items_by_status').length" class="admin-cells-sub">暂无条目</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
definePageMeta({ layout: 'admin' })

const data = ref<any>(null)
const loading = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function refresh() {
  if (loading.value) return
  loading.value = true
  try {
    data.value = await adminAPI.monitorStats()
  } catch { /* 静默失败，保留旧数据 */ } finally {
    loading.value = false
  }
}

// 30s 刷新：请求完成后再排程（慢查询时不叠加）；页面隐藏停轮、回前台补一次
const REFRESH_INTERVAL = 30000
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

// ─── 格式化 ───
function quotaPercent(u: any) {
  return u.quota_bytes ? +(u.used_bytes / u.quota_bytes * 100).toFixed(1) : 0
}

function fmtTime(ts?: string | null) {
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
function fmtUptime(sec?: number | null) {
  if (sec == null) return '-'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d ? `${d}天${h}时${m}分` : h ? `${h}时${m}分` : `${m}分`
}

// ─── 概览指标 ───
function statusCount(key: string): number {
  return data.value?.tasks_by_status?.[key] ?? 0
}
function sum24h(key: 'created' | 'completed' | 'failed'): number {
  return (data.value?.hourly || []).reduce((s: number, h: any) => s + (h[key] || 0), 0)
}
const diskTagClass = computed(() => {
  const p = data.value?.disk?.used_percent ?? 0
  return p >= 90 ? 'admin-tag-red' : p >= 75 ? '' : 'admin-tag-green'
})
const diskBarClass = computed(() => {
  const p = data.value?.disk?.used_percent ?? 0
  return p >= 90 ? 'monitor-bar-red' : p >= 75 ? 'monitor-bar-warn' : 'monitor-bar-green'
})

// ─── 失败画像 ───
const errMax = computed(() => Math.max(1, ...(data.value?.error_classes || []).map((e: any) => e.count || 0)))
function errPercent(count: number): number {
  return Math.max(2, (count / errMax.value) * 100)
}

// ─── 网关健康 ───
/** 提交间隔相对基准的压力：>100% 表示已因限流自动降速 */
function gatewayPressure(g: any): number {
  const base = Number(g.base_interval_ms) || 1
  return Math.min(100, (Number(g.interval_ms) / base / 3) * 100)
}
function gatewayBarClass(g: any): string {
  const base = Number(g.base_interval_ms) || 1
  const ratio = Number(g.interval_ms) / base
  return ratio > 1.5 ? 'monitor-bar-red' : ratio > 1.05 ? 'monitor-bar-warn' : 'monitor-bar-green'
}

// ─── 批次状态 ───
const BATCH_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '等待', cls: '' },
  running: { label: '运行中', cls: 'admin-tag-blue' },
  paused: { label: '已暂停', cls: '' },
  completed: { label: '已完成', cls: 'admin-tag-green' },
  failed: { label: '失败', cls: 'admin-tag-red' },
}
function batchChips(key: 'by_status' | 'items_by_status') {
  const by = data.value?.batches?.[key] || {}
  return Object.entries(by)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => {
      const meta = BATCH_STATUS_META[k] || { label: k, cls: '' }
      return { label: meta.label, cls: meta.cls, count: Number(v) }
    })
    .sort((a, b) => b.count - a.count)
}
</script>

<style src="~/assets/styles/admin-monitor.css"></style>
