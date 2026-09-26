<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
            <div v-if="scenes.length" class="asset-grid">
              <div
                v-for="s in scenes"
                :key="s.id"
                :class="['card', 'asset-card', 'asset-click-card', assetSelectMode && isAssetSelected('scene', s.id) && 'is-asset-selected']"
                tabindex="0"
                role="button"
                @click="onAssetCardClick('scene', s)"
                @keydown.enter.prevent="onAssetCardClick('scene', s)"
                @keydown.space.prevent="onAssetCardClick('scene', s)"
              >
                <span v-if="assetSelectMode" class="asset-select-check" :class="{ 'is-on': isAssetSelected('scene', s.id) }">
                  <svg v-if="isAssetSelected('scene', s.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <button v-else class="asset-del-btn" title="删除场景" @click.stop="askDeleteAsset('scene', s)"><X :size="11" /></button>
                <div class="asset-cover wide">
                  <img
                    v-if="s.image_url || s.imageUrl"
                    :src="thumbOf(assetImageSrc(s))"
                    class="previewable-image"
                    loading="lazy"
                    @error="thumbFallback($event, assetImageSrc(s))"
                    @click.stop="openImageViewer(assetImageSrc(s), `${s.location} 场景图`)"
                  />
                  <div v-else class="asset-cover-empty">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  </div>
                  <span class="asset-cover-badge" :class="(s.image_url || s.imageUrl) ? 'is-ready' : (isPendingSceneImage(s.id) ? 'is-pending' : (isFailedSceneImage(s.id) ? 'is-failed' : ''))" :title="failedSceneImages[s.id] || ''">{{ (s.image_url || s.imageUrl) ? '已生成' : (isPendingSceneImage(s.id) ? '生成中' : (isFailedSceneImage(s.id) ? '生成失败' : '待生成')) }}</span>
                </div>
                <div class="asset-body">
                  <div class="asset-name" :title="s.location">{{ s.location }}</div>
                  <div class="asset-meta asset-desc dim" :title="sceneDescriptionValue(s)">{{ sceneDescriptionValue(s) }}</div>
                  <div v-if="sceneLightingValue(s)" class="asset-meta asset-light dim" :title="sceneLightingValue(s)">光照 · {{ sceneLightingValue(s) }}</div>
                  <div class="asset-meta asset-final" :class="{ dim: !(s.final_prompt || s.finalPrompt) }" :title="s.final_prompt || s.finalPrompt || ''">
                    <span class="afp-label">最终提示词 · 固定视角</span>
                    {{ s.final_prompt || s.finalPrompt || '首次生成图片时由提示词 Agent 自动生成（前景/中景/后景）' }}
                  </div>
                </div>
                <div class="asset-foot">
                  <span :class="['dot', (s.image_url || s.imageUrl) && 'ok', isPendingSceneImage(s.id) && 'pending']" />
                  <button class="btn btn-sm ml-auto" title="上传场景图" :disabled="isUploadingAsset('scene', s.id)" @click.stop="uploadAssetImage('scene', s.id)">
                    <Loader2 v-if="isUploadingAsset('scene', s.id)" :size="11" class="animate-spin" />
                    <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    上传
                  </button>
                  <button class="btn btn-sm" :disabled="isPendingSceneImage(s.id)" @click.stop="genSceneImg(s.id)">
                    <Loader2 v-if="isPendingSceneImage(s.id)" :size="11" class="animate-spin" />
                    {{ (s.image_url || s.imageUrl) ? '重绘' : (isPendingSceneImage(s.id) ? '生成中' : (isFailedSceneImage(s.id) ? '重试' : '生成')) }}
                  </button>
                </div>
              </div>
            </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import { Loader2, X } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  scenes, assetSelectMode, isAssetSelected, onAssetCardClick, askDeleteAsset,
  assetImageSrc, openImageViewer, isPendingSceneImage, isFailedSceneImage,
  failedSceneImages, sceneDescriptionValue, sceneLightingValue,
  isUploadingAsset, uploadAssetImage, genSceneImg,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/assets.css"></style>
