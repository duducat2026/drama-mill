<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
          <div v-if="prodTab === 'storyboard'" class="prod-content">
            <div class="prod-section-bar">
              <span class="dim" style="font-size:12px">分镜拆分</span>
              <span class="tag mono">{{ sbs.length }} 段落 · {{ totalDuration }}s</span>
              <span class="tag">{{ lockedVideoConfigLabel }}</span>
              <div class="ml-auto flex gap-1">
                <button class="btn btn-sm" :class="{ 'btn-danger': sbSplit.error }" :disabled="sbSplit.running" :title="sbSplit.error || ''" @click="sbSplit.error ? doRetryBreakdown() : doBreakdown()">
                  <Loader2 v-if="sbSplit.running" :size="11" class="animate-spin" />
                  <svg v-else-if="sbSplit.error" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  {{ sbSplit.running ? (sbSplit.saved ? `拆分中 ${sbSplit.saved} 段` : '拆分中…') : (sbSplit.error ? '重试拆分' : (sbs.length ? '重新拆分' : '开始拆分')) }}
                </button>
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
                <button v-if="vpHasItems" class="btn btn-sm" @click="vpTaskListOpen = !vpTaskListOpen">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  {{ vpTaskListOpen ? '收起任务' : '任务列表' }}
                </button>
              </div>
            </div>

            <!-- 批量提示词任务列表面板：展示每个分镜的生成状态与失败原因 -->
            <div v-if="vpHasItems && vpTaskListOpen" class="vp-task-panel">
              <div class="vp-task-panel-head">
                <div class="vp-task-summary">
                  <span class="vp-stat vp-stat-total">共 {{ videoPromptBatch.total || videoPromptBatch.items.length }} 个</span>
                  <span class="vp-stat vp-stat-done">成功 {{ videoPromptBatch.items.filter(i => i.status === 'done').length }}</span>
                  <span class="vp-stat vp-stat-failed">失败 {{ videoPromptBatch.items.filter(i => i.status === 'failed').length }}</span>
                  <span v-if="videoPromptBatch.running" class="vp-stat vp-stat-running">进行中 {{ videoPromptBatch.items.filter(i => i.status === 'running' || i.status === 'pending').length }}</span>
                </div>
                <button v-if="vpFailedItems.length" class="btn btn-sm btn-primary" :disabled="videoPromptBatch.running" @click="retryFailedVideoPrompts">
                  <Loader2 v-if="videoPromptBatch.running" :size="11" class="animate-spin" />
                  <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  重试失败({{ vpFailedItems.length }})
                </button>
              </div>
              <div class="vp-task-list">
                <div v-for="item in videoPromptBatch.items" :key="item.storyboard_id" class="vp-task-item" :class="`vp-task-item--${item.status}`">
                  <div class="vp-task-item-head">
                    <span class="vp-shot-num">#{{ String(item.storyboard_number).padStart(2, '0') }}</span>
                    <span class="vp-shot-title text-ellipsis">{{ item.title || '未命名分镜' }}</span>
                    <span class="vp-status-badge" :class="`vp-badge--${item.status}`">
                      <Loader2 v-if="item.status === 'running'" :size="9" class="animate-spin" />
                      <svg v-else-if="item.status === 'done'" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      <svg v-else-if="item.status === 'failed'" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      <svg v-else width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/></svg>
                      {{ item.status === 'done' ? '成功' : item.status === 'failed' ? '失败' : item.status === 'running' ? '生成中' : '待生成' }}
                    </span>
                    <span v-if="item.attempt > 1" class="vp-attempt-chip">第 {{ item.attempt }} 次</span>
                  </div>
                  <div v-if="item.status === 'failed' && item.error" class="vp-task-error">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span>{{ item.error }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="sbs.length" class="storyboard-workbench">
          <StoryboardShotList />

<StoryboardEditor />

<StoryboardRefPanel />
            </div>

            <div v-else-if="sbSplit.running" class="step-loading">
              <Loader2 :size="24" class="animate-spin" style="color:var(--accent)" />
              <div class="loading-text">正在后台拆分分镜{{ sbSplit.saved ? `，已保存 ${sbSplit.saved} 段` : '' }}…可刷新页面，拆分不会中断</div>
            </div>

            <div v-else class="step-empty video-task-empty-state">
              <div class="empty-visual">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="2" y="2" width="20" height="20" rx="2.5"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="13" y1="8" x2="13" y2="16"/></svg>
              </div>
              <div class="empty-title">开始拆分分镜</div>
              <div class="empty-desc">根据剧本、角色和场景拆分镜头，生成分镜描述和绑定信息。</div>
              <button class="btn btn-primary" :class="{ 'btn-danger': sbSplit.error }" :disabled="sbSplit.running" :title="sbSplit.error || ''" @click="sbSplit.error ? doRetryBreakdown() : doBreakdown()">
                <Loader2 v-if="sbSplit.running" :size="13" class="animate-spin" />
                <svg v-else-if="sbSplit.error" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                {{ sbSplit.running ? '拆分中…' : (sbSplit.error ? '重试拆分' : '开始拆分') }}
              </button>
            </div>
          </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import StoryboardEditor from './StoryboardEditor.vue'
import StoryboardRefPanel from './StoryboardRefPanel.vue'
import StoryboardShotList from './StoryboardShotList.vue'
import { Loader2 } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  prodTab, sbs, totalDuration, lockedVideoConfigLabel, sbSplit,
  doRetryBreakdown, doBreakdown, videoPromptBatch, batchVideoPrompts,
  selectedSbIds, vpFailedItems, retryFailedVideoPrompts, vpHasItems,
  vpTaskListOpen, panel,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/storyboard.css"></style>
