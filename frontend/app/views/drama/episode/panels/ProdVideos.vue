<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
          <div v-if="prodTab === 'videos'" class="prod-content">
            <div class="prod-section-bar">
              <span class="dim" style="font-size:12px">{{ sbs.length }} 个镜头</span>
              <span class="tag mono">{{ shotVidCount }}/{{ sbs.length }} 已生成</span>
              <div class="ml-auto flex gap-1">
                <button class="btn btn-sm" :disabled="videoPromptBatch.running || !sbs.length" @click="batchVideoPrompts">
                  <Loader2 v-if="videoPromptBatch.running" :size="11" class="animate-spin" />
                  <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  {{ videoPromptBatch.running ? `提示词 ${videoPromptBatch.completed}/${videoPromptBatch.total}` : (selectedSbIds.length ? `生成所选提示词(${selectedSbIds.length})` : '批量视频提示词') }}
                </button>
                <button v-if="vpFailedItems.length" class="btn btn-sm btn-primary" :disabled="videoPromptBatch.running" @click="retryFailedVideoPrompts">
                  <Loader2 v-if="videoPromptBatch.running" :size="11" class="animate-spin" />
                  <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  重试失败({{ vpFailedItems.length }})
                </button>
                <button class="btn btn-sm" :disabled="!sbs.length" @click="batchVideos">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                  批量视频
                </button>
                <button v-if="videoTaskFailedCount > 0" class="btn btn-sm btn-primary" @click="retryFailedVideos">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  重试失败({{ videoTaskFailedCount }})
                </button>
              </div>
            </div>
            <div v-if="!sbs.length" class="step-empty video-task-empty-state">
              <div class="empty-visual">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              </div>
              <div class="empty-title">先生成分镜</div>
              <div class="empty-desc">视频任务来自分镜拆分结果。先生成分镜描述和视频提示词，再批量生成视频。</div>
              <div class="locked-config-banner">当前集视频模型：{{ lockedVideoConfigLabel }}</div>
              <button class="btn btn-primary" :disabled="sbSplit.running" @click="prodTab = 'storyboard'; doBreakdown()">
                <Loader2 v-if="sbSplit.running" :size="13" class="animate-spin" />
                <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                AI 生成分镜
              </button>
            </div>
            <div v-else class="video-task-workbench has-player">
          <VideoTaskListPanel />

<VideoSide />
            </div>
          </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import VideoSide from './VideoSide.vue'
import VideoTaskListPanel from './VideoTaskListPanel.vue'
import { Loader2 } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  prodTab, sbs, shotVidCount, videoPromptBatch, batchVideoPrompts,
  selectedSbIds, vpFailedItems, retryFailedVideoPrompts, batchVideos,
  videoTaskFailedCount, retryFailedVideos, lockedVideoConfigLabel, sbSplit,
  doBreakdown,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/videos.css"></style>
