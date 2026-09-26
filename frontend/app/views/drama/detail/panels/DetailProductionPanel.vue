<template>
  <!-- 自动化生产进度（非 idle 时显示，5s 轮询；idle 但存在未完成集时作为兜底启动入口） -->
  <div v-if="production && (production.status !== 'idle' || idleProd)" class="card prod-card">
    <div class="prod-head">
      <span class="prod-title">
        <Loader2 v-if="production.status === 'running'" :size="14" class="animate-spin" />
        自动化生产
      </span>
      <span :class="['tag', `prod-status-${production.status}`]">{{ prodStatusLabel }}</span>
      <span v-if="production.current_episode_number && production.status === 'running'" class="prod-current">
        第 {{ production.current_episode_number }} 集 · {{ prodStepLabel(production.current_step) }}
      </span>
      <div class="prod-actions">
        <button v-if="production.status === 'idle'" class="btn btn-sm btn-primary" @click="doStartProduction">{{ idleProd?.interrupted ? '续跑生产' : '开始生产' }}</button>
        <button v-if="production.status === 'running'" class="btn btn-sm" @click="doPauseProduction">暂停</button>
        <button v-if="production.status === 'paused'" class="btn btn-sm btn-primary" @click="doResumeProduction">继续</button>
        <button v-if="production.status === 'error' || production.status === 'done'" class="btn btn-sm btn-primary" @click="doStartProduction">{{ production.status === 'error' ? '重试' : '重新启动' }}</button>
      </div>
    </div>
    <div v-if="production.error" class="prod-error">{{ production.error }}</div>
    <div v-if="production.episodes?.length" class="prod-board">
      <!-- 阶段图例：各集卡片内分段进度条按此顺序着色 -->
      <div class="prod-legend">
        <span v-for="(s, i) in PROD_MATRIX_KEYS" :key="s" class="prod-legend-item">
          <span class="prod-legend-idx">{{ i + 1 }}</span>{{ prodStepLabel(s) }}
        </span>
      </div>
      <!-- 一行 4 集：每集一张卡片（集号 + 六段进度条 + 当前阶段摘要） -->
      <div class="prod-eps">
        <div
          v-for="ep in production.episodes"
          :key="ep.episode_id"
          :class="['prod-ep-cell', { current: ep.episode_id === production.current_episode_id }]"
        >
          <div class="prod-ep-head">
            <button
              type="button"
              class="prod-ep-num"
              :title="`进入第 ${ep.episode_number} 集工作台`"
              @click="goEpisodeWorkbench(ep.episode_number)"
            >
              EP{{ String(ep.episode_number).padStart(2, '0') }}
            </button>
            <span v-if="ep.videos_generating" class="prod-ep-vgen" :title="`${ep.videos_generating} 个视频正在生成`">
              <Loader2 :size="10" class="animate-spin" /> {{ ep.videos_generating }}
            </span>
          </div>
          <div class="prod-ep-bar" :aria-label="`第 ${ep.episode_number} 集生产进度`">
            <span
              v-for="s in PROD_MATRIX_KEYS"
              :key="s"
              :class="['prod-seg', `prod-seg-${epStepStatus(ep.steps, s)}`, { live: ep.episode_id === production.current_episode_id && epStepStatus(ep.steps, s) === 'partial' }]"
              :title="`${prodStepLabel(s)}${stepCountText(ep.steps, s) ? ' · ' + stepCountText(ep.steps, s) : ''}`"
            ></span>
          </div>
          <div class="prod-ep-summary">{{ epStepSummary(ep) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Loader2 } from 'lucide-vue-next'

// vm = useDetailProduction(dramaId) 的返回；解构为同名局部量以保模板绑定与拆分前逐字一致
const props = defineProps({ vm: { type: Object, required: true } })
const {
  production, PROD_MATRIX_KEYS, idleProd, prodStatusLabel, prodStepLabel,
  epStepStatus, stepCountText, epStepSummary, goEpisodeWorkbench,
  doPauseProduction, doResumeProduction, doStartProduction,
} = props.vm
</script>

<style scoped src="~/assets/styles/drama.detail.css"></style>
