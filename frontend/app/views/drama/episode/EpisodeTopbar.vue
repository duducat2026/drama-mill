<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
    <header class="studio-topbar">
      <div class="studio-topbar-main">
        <button class="back-btn topbar-back" @click="navigateTo(`/drama/${dramaId}`)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          返回项目
        </button>
        <div class="studio-identity">
          <h1 class="studio-title">{{ drama.title }}</h1>
          <div class="studio-episode-nav">
            <button type="button" class="studio-epnav-btn" :disabled="!prevEpisode" :title="prevEpisode ? `上一集 · 第 ${epNumberOf(prevEpisode)} 集` : '已是第一集'" @click="goEpisodeWorkbench(prevEpisode)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="studio-episode-chip">第 {{ episodeNumber }} 集</span>
            <button type="button" class="studio-epnav-btn" :disabled="!nextEpisode" :title="nextEpisode ? `下一集 · 第 ${epNumberOf(nextEpisode)} 集` : '已是最后一集'" @click="goEpisodeWorkbench(nextEpisode)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div class="studio-meta-row">
            <span class="studio-meta-pill">{{ currentSubStageLabel }}</span>
            <span class="studio-meta-pill is-progress">{{ pipelineProgress }}/{{ pipelineTotal }}</span>
            <span class="studio-meta-inline">{{ chars.length }} 角色 · {{ sbs.length }} 段落</span>
            <button v-if="epTimings?.total_duration_ms" class="studio-meta-pill is-pill-btn" title="查看各阶段耗时" @click="showTimings = true">耗时 {{ fmtDuration(epTimings.total_duration_ms) }}</button>
            <button v-if="epCostData" class="studio-meta-pill is-pill-btn" title="查看成本明细" @click="showCost = true">成本 ¥{{ epCostData.episode_cost ?? '0' }}</button>
          </div>
        </div>
      </div>

      <div class="studio-topbar-side">
        <div class="studio-model-picks">
          <ModelSelect
            v-if="textModelOptions.length"
            v-model="chatModel"
            label="文本"
            :options="textModelOptions"
            :default-label="`默认 · ${textModelOptions[0].model}`"
            :show-config="textModelMultiCfg"
          />
          <ModelSelect
            v-if="imageModelOptions.length"
            v-model="imageModel"
            label="图片"
            :options="imageModelOptions"
            :default-label="`默认 · ${imageModelOptions[0].model}`"
            :show-config="imageModelMultiCfg"
          />
          <ModelSelect
            v-if="videoModelOptions.length"
            v-model="videoModel"
            label="视频"
            :options="videoModelOptions"
            :default-label="`默认 · ${videoModelOptions[0].model}`"
            :show-config="videoModelMultiCfg"
          />
          <button
            v-if="videoModelOptions.length"
            type="button"
            class="model-lock"
            :class="{ active: videoModelLock }"
            :title="videoModelLock
              ? '已锁定模型：视频任务只用当前选中模型，提交前不再切换到更低负载的模型'
              : '自动分流：提交前可能切换到同配置内负载更低的模型池'"
            @click="videoModelLock = !videoModelLock"
          >
            <Lock :size="11" />
            <span>{{ videoModelLock ? '已锁定' : '自动分流' }}</span>
          </button>
        </div>
        <div class="studio-actions">
          <button
            type="button"
            class="ai-call-chip"
            :class="{ 'is-off': !aiCallEnabled }"
            :disabled="aiCallSubmitting"
            :title="aiCallEnabled
              ? '模型调用开启中，点击关闭：新的文本/图片/视频生成提交会被服务端拒绝（关闭前会二次确认）'
              : AI_CALL_OFF_TIP"
            @click="onAiCallToggle()"
          >
            <Power :size="11" />
            <span>{{ aiCallEnabled ? '模型调用 开' : '模型调用 关' }}</span>
          </button>
          <button class="btn" @click="refresh">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            刷新
          </button>
          <button class="btn task-drawer-trigger" @click="openTaskDrawer">
            <ListTodo :size="12" />
            任务
            <span v-if="genTaskActiveCount" class="task-drawer-badge">{{ genTaskActiveCount }}</span>
          </button>
          <button class="btn btn-primary" @click="panel = mergeUrl ? 'export' : (sbs.length ? 'production' : 'script')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            {{ mergeUrl ? '查看成片' : (sbs.length ? '继续制作' : '开始制作') }}
          </button>
        </div>
        <!-- 工作台为独立全屏布局(不带全站顶栏)，账号区在此页同样常驻最右 -->
        <UserMenu size="sm" />
      </div>
    </header>

    <!-- 模型调用已关闭：所有生成提交会被服务端拒绝，此处给出原因与一键恢复 -->
    <div v-if="!aiCallEnabled" class="ai-call-off-bar">
      <TriangleAlert :size="13" />
      <span>{{ AI_CALL_OFF_TIP }}</span>
      <button type="button" class="ai-call-off-action" :disabled="aiCallSubmitting" @click="onAiCallToggle(true)">立即打开</button>
      <NuxtLink to="/settings" class="ai-call-off-link">前往设置</NuxtLink>
    </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import { ListTodo, Lock, Power, TriangleAlert } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  drama, dramaId, episode, prevEpisode, epNumberOf, goEpisodeWorkbench,
  episodeNumber, nextEpisode, currentSubStageLabel, pipelineProgress,
  pipelineTotal, chars, sbs, epTimings, showTimings, fmtDuration, epCostData,
  showCost, textModelOptions, chatModel, textModelMultiCfg,
  imageModelOptions, imageModel, imageModelMultiCfg, videoModelOptions,
  videoModel, videoModelMultiCfg, videoModelLock, aiCallEnabled,
  aiCallSubmitting, onAiCallToggle, refresh, openTaskDrawer,
  genTaskActiveCount, panel, mergeUrl,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/topbar.css"></style>
