<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
      <!-- 耗时明细弹窗 -->
      <div v-if="showTimings" class="ep-stat-mask" @click.self="showTimings = false">
        <div class="ep-stat-modal">
          <div class="ep-stat-title">本集各阶段耗时 <button class="ep-stat-close" @click="showTimings = false">✕</button></div>
          <table class="ep-stat-table">
            <thead><tr><th>阶段</th><th>最近一次耗时</th><th>状态</th><th>最近执行</th></tr></thead>
            <tbody>
              <tr v-for="s in (epTimings?.stages || [])" :key="s.stage">
                <td>{{ s.label }}</td>
                <td>{{ s.duration_ms != null ? fmtDuration(s.duration_ms) : '-' }}</td>
                <td>{{ s.status || '-' }}</td>
                <td>{{ s.last_run_at ? new Date(s.last_run_at).toLocaleString('zh-CN', { hour12: false }) : '-' }}</td>
              </tr>
            </tbody>
          </table>
          <div class="ep-stat-foot">
            <span>各阶段累计 {{ fmtDuration(epTimings?.sum_stage_duration_ms) }}</span>
            <span class="ep-stat-total">单集总耗时 {{ fmtDuration(epTimings?.total_duration_ms) }}</span>
          </div>
        </div>
      </div>

      <!-- 成本明细弹窗 -->
      <div v-if="showCost" class="ep-stat-mask" @click.self="showCost = false">
        <div class="ep-stat-modal">
          <div class="ep-stat-title">AI 成本 <button class="ep-stat-close" @click="showCost = false">✕</button></div>
          <div class="ep-stat-cards">
            <div class="ep-stat-card"><div class="ep-stat-card-label">项目合计</div><div class="ep-stat-card-value">¥ {{ epCostData?.total_cost ?? '-' }}</div></div>
            <div class="ep-stat-card"><div class="ep-stat-card-label">本集成本</div><div class="ep-stat-card-value">¥ {{ epCostData?.episode_cost ?? '-' }}</div></div>
            <div class="ep-stat-card"><div class="ep-stat-card-label">调用次数</div><div class="ep-stat-card-value">{{ epCostData?.total_calls ?? '-' }}</div></div>
          </div>
          <table class="ep-stat-table">
            <thead><tr><th>时间</th><th>服务</th><th>模型</th><th>用量</th><th>成本</th></tr></thead>
            <tbody>
              <tr v-for="r in epCostDetails" :key="r.id">
                <td style="white-space:nowrap">{{ new Date(r.created_at).toLocaleString('zh-CN', { hour12: false }) }}</td>
                <td>{{ r.service_type }}</td>
                <td :title="r.model" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ r.model }}</td>
                <td>{{ costUsageLabel(r) }}</td>
                <td>{{ r.price_missing ? '缺价' : `¥ ${r.cost}` }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="!epCostDetails.length" class="ep-stat-empty">暂无调用记录</div>
        </div>
      </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'

const wb = inject(EPISODE_WB)
const {
  showTimings, epTimings, fmtDuration, showCost, epCostData, epCostDetails,
  costUsageLabel,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/stats.css"></style>
