<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
              <section class="video-task-list">
                <div class="video-task-head">
                <div>
                  <div class="video-task-title">视频任务列表</div>
                  <div class="video-task-meta">按镜头顺序 · {{ videoTaskRows.length }} 个任务</div>
                </div>
                <div class="video-task-metrics">
                  <span class="video-task-metric is-pending">{{ pendingVideoIds.length }} 生成中</span>
                  <span class="video-task-metric is-done">{{ videoTaskDoneCount }} 完成</span>
                  <span class="video-task-metric is-failed">{{ videoTaskFailedCount }} 失败</span>
                </div>
                </div>
                <div class="video-task-table">
                <div
                  v-for="task in videoTaskRows"
                  :key="task.id"
                  :class="['video-task-row', 'is-' + videoTaskState(task.storyboard), { active: selectedSb?.id === task.storyboard.id }]"
                  role="button"
                  tabindex="0"
                  @click="selectedSb = task.storyboard"
                  @keydown.enter.prevent="selectedSb = task.storyboard"
                  @keydown.space.prevent="selectedSb = task.storyboard"
                >
                  <div class="video-task-preview">
                    <video
                      v-if="hasVid(task.storyboard)"
                      :src="'/' + getVideoUrl(task.storyboard)"
                      :poster="posterOf('/' + getVideoUrl(task.storyboard)) || undefined"
                      preload="none"
                      playsinline
                      muted
                      tabindex="-1"
                    />
                    <div v-else class="video-task-empty">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                    </div>
                    <span class="video-task-index">#{{ String(task.index + 1).padStart(2, '0') }}</span>
                  </div>
                  <div class="video-task-main">
                    <div class="video-task-line">
                      <strong class="video-task-name truncate">{{ task.title }}</strong>
                    </div>
                    <div class="video-task-meta-line">
                      <span v-if="task.meta" class="video-task-loc truncate">{{ task.meta }}</span>
                      <span class="video-task-sep">·</span>
                      <span>{{ task.duration }}s</span>
                      <span class="video-task-sep">·</span>
                      <span>参考 {{ task.referenceCount }}</span>
                      <template v-if="hasVid(task.storyboard) && task.storyboard.video_size">
                        <span class="video-task-sep">·</span>
                        <span>{{ formatSize(task.storyboard.video_size) }}</span>
                      </template>
                      <template v-if="hasVid(task.storyboard) && task.storyboard.video_model">
                        <span class="video-task-sep">·</span>
                        <span class="video-task-model">{{ task.storyboard.video_model }}</span>
                      </template>
                      <template v-if="hasVid(task.storyboard) && task.storyboard.video_attempt_count > 1">
                        <span class="video-task-sep">·</span>
                        <span class="video-task-attempts">×{{ task.storyboard.video_attempt_count }}</span>
                      </template>
                    </div>
                    <div v-if="task.error" class="video-task-error">{{ task.error }}</div>
                  </div>
                  <span :class="['video-task-status', 'is-' + videoTaskState(task.storyboard)]">
                    <span :class="['dot', videoTaskState(task.storyboard) === 'done' && 'ok', videoTaskState(task.storyboard) === 'pending' && 'pending']" />
                    {{ videoTaskStatusLabel(task.storyboard) }}
                  </span>
                  <button
                    class="btn btn-sm video-task-action"
                    :disabled="videoTaskState(task.storyboard) === 'pending'"
                    @click.stop="genVid(task.storyboard)"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                    {{ videoTaskActionLabel(task.storyboard) }}
                  </button>
                </div>
                </div>
              </section>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'

const wb = inject(EPISODE_WB)
const {
  videoTaskRows, pendingVideoIds, videoTaskDoneCount, videoTaskFailedCount,
  videoTaskState, selectedSb, hasVid, getVideoUrl, formatSize,
  videoTaskStatusLabel, genVid, videoTaskActionLabel,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/videos.css"></style>
