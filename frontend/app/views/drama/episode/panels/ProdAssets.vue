<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
          <div v-if="prodTab === 'assets'" class="prod-content">
            <div class="prod-section-bar">
              <span class="dim" style="font-size:12px">资产</span>
              <span class="tag mono">{{ assetReadyCount }}/{{ assetTotalCount }} 已就绪</span>
              <span class="tag">{{ lockedImageConfigLabel }}</span>
              <div class="ml-auto flex gap-1 asset-bar-actions">
                <button
                  v-for="t in EXTRACT_TARGETS"
                  :key="t.key"
                  class="btn btn-sm asset-btn-extract"
                  :class="{ 'btn-danger': isExtractFailed(t.key) }"
                  :disabled="isExtracting(t.key)"
                  :title="isExtractFailed(t.key) ? extractErrors[t.key] || '' : ''"
                  @click="isExtractFailed(t.key) ? doRetryExtract(t.key) : doExtract(t.key)"
                >
                  <Loader2 v-if="isExtracting(t.key)" :size="11" class="animate-spin" />
                  <svg v-else-if="isExtractFailed(t.key)" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  {{ isExtractFailed(t.key) ? `重试${t.label}` : ((t.key === 'characters' ? chars.length : t.key === 'scenes' ? scenes.length : propItems.length) ? `重提${t.label}` : `提取${t.label}`) }}
                </button>
                <span class="asset-bar-divider" />
                <template v-if="assetSelectMode">
                  <span class="tag mono">已选 {{ assetSelectTotal }}</span>
                  <button class="btn btn-sm" @click="selectAllAssets">{{ assetSelectTotal === (visualChars.length + scenes.length + propItems.length) ? '取消全选' : '全选' }}</button>
                  <button class="btn btn-sm btn-primary" :disabled="!assetSelectTotal" @click="redrawSelectedAssets">重绘所选({{ assetSelectTotal }})</button>
                  <button class="btn btn-sm" @click="exitAssetSelectMode">退出选择</button>
                </template>
                <template v-else>
                <button class="btn btn-sm asset-btn-batch" @click="batchCharImages">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  批量角色
                </button>
                <button class="btn btn-sm asset-btn-batch" @click="batchSceneImages">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  批量场景
                </button>
                <button class="btn btn-sm asset-btn-batch" @click="batchPropImages">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  批量道具
                </button>
                <button class="btn btn-sm asset-btn-batch" title="勾选需要重绘的资产后批量重绘" @click="assetSelectMode = true">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                  选择重绘
                </button>
                </template>
                <button v-if="aiFailedItems.length" class="btn btn-sm btn-primary" @click="retryAllFailedImages">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  重试失败({{ aiFailedItems.length }})
                </button>
                <button v-if="aiAllItems.length" class="btn btn-sm" @click="aiTaskListOpen = !aiTaskListOpen">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  {{ aiTaskListOpen ? '收起任务' : '任务列表' }}
                </button>
              </div>
            </div>

            <!-- 资产图片任务列表面板：展示每个资产的生成状态与失败原因 -->
            <div v-if="aiAllItems.length && aiTaskListOpen" class="vp-task-panel">
              <div class="vp-task-panel-head">
                <div class="vp-task-summary">
                  <span class="vp-stat vp-stat-total">共 {{ aiAllItems.length }} 个</span>
                  <span class="vp-stat vp-stat-done">成功 {{ aiDoneCount }}</span>
                  <span class="vp-stat vp-stat-failed">失败 {{ aiFailedItems.length }}</span>
                  <span v-if="aiPendingCount" class="vp-stat vp-stat-running">进行中 {{ aiPendingCount }}</span>
                </div>
                <button v-if="aiFailedItems.length" class="btn btn-sm btn-primary" @click="retryAllFailedImages">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  重试失败({{ aiFailedItems.length }})
                </button>
              </div>
              <div class="vp-task-list">
                <div v-for="item in aiAllItems" :key="`${item.type}-${item.id}`" class="vp-task-item" :class="`vp-task-item--${item.status}`">
                  <div class="vp-task-item-head">
                    <span class="vp-shot-num">{{ item.type }}</span>
                    <span class="vp-shot-title text-ellipsis">{{ item.name }}</span>
                    <span class="vp-status-badge" :class="`vp-badge--${item.status}`">
                      <Loader2 v-if="item.status === 'running'" :size="9" class="animate-spin" />
                      <svg v-else-if="item.status === 'done'" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      <svg v-else-if="item.status === 'failed'" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      <svg v-else width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/></svg>
                      {{ item.status === 'done' ? '成功' : item.status === 'failed' ? '失败' : item.status === 'running' ? '生成中' : '待生成' }}
                    </span>
                  </div>
                  <div v-if="item.status === 'failed' && item.error" class="vp-task-error">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span>{{ item.error }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="extractingTargets.length && !chars.length && !scenes.length && !propItems.length" class="step-loading">
              <Loader2 :size="24" class="animate-spin" style="color:var(--accent)" />
              <div class="loading-text">正在提取{{ extractingLabels }}...</div>
            </div>
            <div v-else-if="!chars.length && !scenes.length && !propItems.length" class="step-empty asset-empty-state">
              <div class="empty-visual">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </div>
              <div class="empty-title">开始提取资产</div>
              <div class="empty-desc">角色、场景和道具会在提取后显示在这里，可分别单独提取，也可一键并行提取全部。</div>
              <button class="btn btn-primary" :disabled="!!extractingTargets.length" @click="doExtractAll">
                <Loader2 v-if="extractingTargets.length" :size="13" class="animate-spin" />
                <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                {{ extractingTargets.length ? `正在提取${extractingLabels}…` : '开始提取' }}
              </button>
            </div>
            <template v-else>
            <div class="asset-section-title">
              角色
              <button class="asset-add-btn" @click="openAssetCreate('character')"><Plus :size="11" /> 新增</button>
            </div>
          <AssetCharacterGrid />

            <div class="asset-section-title">
              场景
              <button class="asset-add-btn" @click="openAssetCreate('scene')"><Plus :size="11" /> 新增</button>
            </div>
<AssetSceneGrid />

            <div class="asset-section-title">
              道具
              <button class="asset-add-btn" @click="openAssetCreate('prop')"><Plus :size="11" /> 新增</button>
            </div>
<AssetPropGrid />
            </template>
          </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import AssetCharacterGrid from './AssetCharacterGrid.vue'
import AssetPropGrid from './AssetPropGrid.vue'
import AssetSceneGrid from './AssetSceneGrid.vue'
import { Loader2, Plus } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  prodTab, assetReadyCount, assetTotalCount, lockedImageConfigLabel,
  EXTRACT_TARGETS, isExtractFailed, isExtracting, extractErrors,
  doRetryExtract, doExtract, chars, scenes, propItems, assetSelectMode,
  assetSelectTotal, selectAllAssets, visualChars, redrawSelectedAssets,
  exitAssetSelectMode, batchCharImages, batchSceneImages, batchPropImages,
  aiFailedItems, retryAllFailedImages, aiAllItems, aiTaskListOpen, panel,
  aiDoneCount, aiPendingCount, extractingTargets, extractingLabels,
  doExtractAll, openAssetCreate,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/assets.css"></style>
