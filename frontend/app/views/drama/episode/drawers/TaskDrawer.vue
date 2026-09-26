<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
      <div v-if="taskDrawer" class="task-drawer-overlay" @click.self="closeTaskDrawer">
        <aside class="task-drawer" role="dialog" aria-modal="true" aria-label="生成任务列表">
          <header class="task-drawer-head">
            <div>
              <div class="video-task-title">生成任务列表</div>
              <div class="video-task-meta">按创建时间倒序 · {{ genTaskRows.length }} 个任务</div>
            </div>
            <div class="task-drawer-head-actions">
              <button class="btn btn-sm" @click="loadGenTasks">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                刷新
              </button>
              <button class="btn btn-ghost btn-icon" @click="closeTaskDrawer"><X :size="14" /></button>
            </div>
          </header>
          <div class="video-task-metrics task-drawer-metrics">
            <span class="video-task-metric is-pending">{{ genTaskActiveCount }} 生成中</span>
            <span v-if="genTaskQueue.queued > 0" class="video-task-metric is-queued">{{ genTaskQueue.queued }} 排队中 · 并发上限 {{ genTaskQueue.max }}</span>
            <span class="video-task-metric is-done">{{ genTaskDoneCount }} 完成</span>
            <span class="video-task-metric is-failed">{{ genTaskFailedCount }} 失败</span>
          </div>
          <div v-if="!genTaskRows.length" class="step-empty task-drawer-empty">
            <div class="empty-visual">
              <ListTodo :size="32" />
            </div>
            <div class="empty-title">暂无生成任务</div>
            <div class="empty-desc">在资产、分镜或视频步骤中触发图片 / 视频生成后,任务会自动出现在这里。</div>
          </div>
          <div v-else class="video-task-table task-drawer-body">
            <div
              v-for="row in genTaskRows"
              :key="row.key"
              :class="['video-task-row', 'gen-task-row', 'is-' + genTaskStateClass(row.status)]"
            >
              <div class="video-task-preview">
                <video
                  v-if="row.previewUrl && (row.kind === 'video' || row.kind === 'merge')"
                  :src="genTaskPreviewSrc(row.previewUrl)"
                  :poster="posterOf(genTaskPreviewSrc(row.previewUrl)) || undefined"
                  controls
                  preload="none"
                  playsinline
                />
                <img
                  v-else-if="row.previewUrl"
                  :src="thumbOf(genTaskPreviewSrc(row.previewUrl))"
                  :alt="row.targetLabel"
                  loading="lazy"
                  @error="thumbFallback($event, genTaskPreviewSrc(row.previewUrl))"
                  @click="openImageViewer(genTaskPreviewSrc(row.previewUrl), row.targetLabel)"
                />
                <div v-else class="video-task-empty">
                  <Loader2 v-if="genTaskStateClass(row.status) === 'pending'" :size="18" class="animate-spin" />
                  <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                </div>
                <span class="video-task-index">{{ genTaskKindLabel(row.kind) }}</span>
              </div>
              <div class="video-task-main">
                <div class="video-task-line">
                  <strong class="video-task-name truncate">{{ row.targetLabel }}</strong>
                </div>
                <div class="video-task-meta-line">
                  <span class="video-task-loc truncate">{{ row.provider }}{{ row.model ? ' · ' + row.model : '' }}</span>
                  <template v-if="genTaskDuration(row)">
                    <span class="video-task-sep">·</span>
                    <span>耗时 {{ genTaskDuration(row) }}</span>
                  </template>
                  <span class="video-task-sep">·</span>
                  <span>#{{ row.id }}</span>
                </div>
                <div v-if="row.errorMsg" class="video-task-error">{{ row.errorMsg }}</div>
              </div>
              <span :class="['video-task-status', 'is-' + genTaskStateClass(row.status)]">
                <span :class="['dot', genTaskStateClass(row.status) === 'done' && 'ok', genTaskStateClass(row.status) === 'pending' && 'pending']" />
                {{ genTaskStatusLabel(row.status) }}
              </span>
              <button
                v-if="row.status === 'failed' && (row.kind === 'image' || row.kind === 'video')"
                class="btn btn-sm gen-task-retry-btn"
                title="重新提交该任务（复用原参数）"
                :disabled="retryingTaskIds.includes(row.id)"
                @click.stop="retryGenTask(row)"
              >
                <Loader2 v-if="retryingTaskIds.includes(row.id)" :size="11" class="animate-spin" />
                重试
              </button>
            </div>
          </div>
          <div v-if="genTaskPagination.total_pages > 1" class="gen-task-pager">
            <button class="btn btn-sm" :disabled="genTaskPage <= 1" @click="loadGenTasks(genTaskPage - 1)">上一页</button>
            <span class="gen-task-pager-info">第 {{ genTaskPage }} / {{ genTaskPagination.total_pages }} 页 · 共 {{ genTaskPagination.total }} 条</span>
            <button class="btn btn-sm" :disabled="genTaskPage >= genTaskPagination.total_pages" @click="loadGenTasks(genTaskPage + 1)">下一页</button>
          </div>
        </aside>
      </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import { Loader2, X, ListTodo } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  taskDrawer, closeTaskDrawer, genTaskRows, loadGenTasks, genTaskActiveCount,
  genTaskQueue, genTaskDoneCount, genTaskFailedCount, genTaskStateClass,
  genTaskPreviewSrc, openImageViewer, genTaskKindLabel, genTaskDuration,
  genTaskStatusLabel, retryingTaskIds, retryGenTask, genTaskPagination,
  genTaskPage,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/drawer.css"></style>
