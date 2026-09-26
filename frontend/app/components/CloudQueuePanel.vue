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
    <div v-if="data?.cloud?.error" class="cq-alert cq-alert-error">云端查询失败：{{ data.cloud.error }}</div>
    <div v-if="data?.cloud?.truncated" class="cq-alert cq-alert-warn">
      云端任务过多，仅拉取前部分记录用于比对（排队 {{ data.cloud.pending_total }} / 在途 {{ data.cloud.running_total }}）
    </div>

    <!-- 概览指标卡 -->
    <div class="cq-stat-grid">
      <div class="cq-stat">
        <div class="cq-stat-label">云端排队（PENDING）</div>
        <div class="cq-stat-value" :style="{ color: data.cloud.pending_total ? '#b45309' : '' }">{{ data.cloud.pending_total }}</div>
        <div class="cq-stat-sub">{{ poolBreakdown.length > 1 ? `全部 ${poolBreakdown.length} 个模型池合计` : '上游排队等待执行的任务总数' }}</div>
      </div>
      <div class="cq-stat">
        <div class="cq-stat-label">云端在途（RUNNING）</div>
        <div class="cq-stat-value" style="color:var(--accent-text)">{{ data.cloud.running_total }}</div>
        <div class="cq-stat-sub">{{ poolBreakdown.length > 1 ? `全部 ${poolBreakdown.length} 个模型池合计` : '上游正在生成的任务数（单池并发上限内）' }}</div>
      </div>
      <div class="cq-stat">
        <div class="cq-stat-label">本地在途</div>
        <div class="cq-stat-value">{{ data.local.in_flight }}</div>
        <div class="cq-stat-sub">已提交上游 {{ data.local.submitted }} · 本地排队 {{ data.local.not_submitted }}</div>
      </div>
      <div class="cq-stat">
        <div class="cq-stat-label">本地↔云端匹配</div>
        <div class="cq-stat-value" style="color:#1a7f37">{{ data.local.matched }}</div>
        <div class="cq-stat-sub">本地任务在云端找到对应记录</div>
      </div>
      <div class="cq-stat">
        <div class="cq-stat-label">本地有/云端无</div>
        <div class="cq-stat-value" :style="{ color: data.local.local_only ? 'var(--action-danger)' : '' }">{{ data.local.local_only }}</div>
        <div class="cq-stat-sub">可能已完成被清理或跨账号</div>
      </div>
      <div class="cq-stat">
        <div class="cq-stat-label">云端有/本地无</div>
        <div class="cq-stat-value" :style="{ color: data.cloud_only_total ? '#b45309' : '' }">{{ data.cloud_only_total }}</div>
        <div class="cq-stat-sub">{{ showCloudOnly ? '同账号其他 Key/进程提交的任务' : '其他任务占队，仅展示数量' }}</div>
      </div>
    </div>

    <!-- 多池明细：各模型限流池相互独立（各 5 并发），分流后负载摊到多池，逐池展示才看得全 -->
    <div v-if="poolBreakdown.length > 1" class="cq-section">
      <div class="cq-section-title">模型池明细 · {{ poolBreakdown.length }} 个池</div>
      <div class="cq-hint">每个模型池并发额度独立（百炼每模型 5 并发），上方指标为全部池合计。</div>
      <div class="cq-table-wrap">
        <table class="cq-table">
          <thead>
            <tr><th>模型池</th><th>排队 PENDING</th><th>在途 RUNNING</th><th>在途合计</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in poolBreakdown" :key="p.model">
              <td>{{ p.model }}</td>
              <td :style="{ color: p.pending_total ? '#b45309' : '' }">{{ p.pending_total }}</td>
              <td style="color:var(--accent-text)">{{ p.running_total }}</td>
              <td>{{ p.pending_total + p.running_total }}</td>
              <td>
                <span v-if="p.error" class="cq-tag cq-tag-red" :title="p.error">查询失败</span>
                <span v-else class="cq-tag cq-tag-green">正常</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 匹配任务：本地任务在云端的状态 -->
    <div class="cq-section">
      <div class="cq-section-title">匹配任务 · {{ data.matched.length }}</div>
      <div class="cq-table-wrap">
        <table class="cq-table">
          <thead>
            <tr>
              <th>本地 ID</th><th>上游 task_id</th><th>云端状态</th><th>模型</th>
              <th>项目</th><th>云端提交时间</th><th>云端开始时间</th><th>本地更新</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!data.matched.length"><td colspan="8" class="cq-empty">无匹配任务</td></tr>
            <tr v-for="t in data.matched" :key="t.local_id">
              <td>#{{ t.local_id }}</td>
              <td class="cq-mono">{{ t.task_id }}</td>
              <td><span class="cq-tag" :class="statusClass(t.cloud_status)">{{ t.cloud_status }}</span></td>
              <td>{{ t.model || '-' }}</td>
              <td>{{ t.drama_id ? `项目 ${t.drama_id}` : '-' }}</td>
              <td>{{ fmtTime(t.cloud_created_at) }}</td>
              <td>{{ fmtTime(t.cloud_started_at) }}</td>
              <td>{{ fmtTime(t.updated_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 本地有 / 云端无：本地记录了上游 task_id，但云端近 24h 列表查不到 -->
    <div v-if="data.local_only.length" class="cq-section">
      <div class="cq-section-title">本地有 / 云端无 · {{ data.local_only.length }}</div>
      <div class="cq-hint">本地已提交上游但云端列表未收录：任务可能刚完成被清理、超过 24 小时窗口，或属于其他主账号。</div>
      <div class="cq-table-wrap">
        <table class="cq-table">
          <thead>
            <tr><th>本地 ID</th><th>上游 task_id</th><th>模型</th><th>项目</th><th>本地更新</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in data.local_only" :key="t.local_id">
              <td>#{{ t.local_id }}</td>
              <td class="cq-mono">{{ t.task_id }}</td>
              <td>{{ t.model || '-' }}</td>
              <td>{{ t.drama_id ? `项目 ${t.drama_id}` : '-' }}</td>
              <td>{{ fmtTime(t.updated_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 云端有 / 本地无：上游在途但本地没有跟踪记录（仅管理侧展示明细） -->
    <div v-if="showCloudOnly && data.cloud_only?.length" class="cq-section">
      <div class="cq-section-title">云端有 / 本地无 · {{ data.cloud_only.length }}（展示前 {{ CLOUD_ONLY_SHOW }} 条）</div>
      <div class="cq-hint">云端列表覆盖主账号下所有 API Key 提交的任务；这些在途任务不在本地库中，可能来自其他 Key/进程，属于正常占队。</div>
      <div class="cq-table-wrap">
        <table class="cq-table">
          <thead>
            <tr><th>上游 task_id</th><th>云端状态</th><th>模型</th><th>API Key</th><th>云端提交时间</th><th>云端开始时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in cloudOnlyShown" :key="t.task_id">
              <td class="cq-mono">{{ t.task_id }}</td>
              <td><span class="cq-tag" :class="statusClass(t.cloud_status)">{{ t.cloud_status }}</span></td>
              <td>{{ t.model }}</td>
              <td>{{ t.api_key_id || '-' }}</td>
              <td>{{ fmtTime(t.cloud_created_at) }}</td>
              <td>{{ fmtTime(t.cloud_started_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  data: any
  showCloudOnly?: boolean
}>(), {
  showCloudOnly: false,
})

const CLOUD_ONLY_SHOW = 50
const cloudOnlyShown = computed(() => (props.data?.cloud_only || []).slice(0, CLOUD_ONLY_SHOW))
// 多模型分流的逐池在途明细（仅配置内多模型时后端返回多项）
const poolBreakdown = computed(() => props.data?.cloud?.by_model || [])

function statusClass(status?: string | null) {
  if (status === 'RUNNING') return 'cq-tag-blue'
  if (status === 'PENDING') return 'cq-tag-gray'
  if (status === 'SUCCEEDED') return 'cq-tag-green'
  if (status === 'FAILED' || status === 'CANCELED') return 'cq-tag-red'
  return ''
}

function fmtTime(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}
</script>

<style scoped>
.cq-alert {
  padding: 10px 14px; border-radius: 10px; font-size: 12.5px;
  margin-bottom: 12px;
}
.cq-alert-error { background: rgba(255,59,48,0.08); color: var(--action-danger); }
.cq-alert-warn { background: rgba(255,159,10,0.1); color: #b45309; }

.cq-stat-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px; margin-bottom: 6px;
}
.cq-stat {
  background: var(--bg-card, #fff); border: 1px solid rgba(0,0,0,0.08);
  border-radius: 12px; padding: 12px 14px;
}
.cq-stat-label { font-size: 12px; color: var(--text-2); margin-bottom: 4px; }
.cq-stat-value { font-size: 22px; font-weight: 700; color: var(--text-1); line-height: 1.2; }
.cq-stat-sub { font-size: 11px; color: var(--text-3); margin-top: 4px; }

.cq-section { margin-top: 18px; }
.cq-section-title { font-size: 13px; font-weight: 700; color: var(--text-1); margin-bottom: 8px; }
.cq-hint { font-size: 11.5px; color: var(--text-3); margin-bottom: 8px; }
.cq-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: var(--text-2); }

.cq-table-wrap {
  background: var(--bg-card, #fff); border: 1px solid rgba(0,0,0,0.08);
  border-radius: 12px; overflow-x: auto;
}
.cq-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.cq-table th {
  text-align: left; font-size: 11.5px; color: var(--text-3); font-weight: 600;
  padding: 9px 12px; border-bottom: 1px solid rgba(0,0,0,0.06); white-space: nowrap;
}
.cq-table td {
  padding: 8px 12px; border-bottom: 1px solid rgba(0,0,0,0.05); color: var(--text-1);
  white-space: nowrap;
}
.cq-table tr:last-child td { border-bottom: none; }
.cq-table tr:hover td { background: rgba(0,0,0,0.015); }
.cq-empty { padding: 40px 0; text-align: center; color: var(--text-3); font-size: 12.5px; }

.cq-tag {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.cq-tag-blue { background: rgba(0,122,255,0.1); color: #0055cc; }
.cq-tag-gray { background: rgba(0,0,0,0.06); color: var(--text-2); }
.cq-tag-green { background: rgba(52,199,89,0.12); color: #1a7f37; }
.cq-tag-red { background: rgba(255,59,48,0.1); color: var(--action-danger); }
</style>
