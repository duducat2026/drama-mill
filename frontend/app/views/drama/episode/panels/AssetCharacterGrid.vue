<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
            <div v-if="visualChars.length" class="character-asset-grid">
              <article
                v-for="c in visualChars"
                :key="c.id"
                :class="['card', 'character-asset-card', assetSelectMode && isAssetSelected('character', c.id) && 'is-asset-selected']"
                tabindex="0"
                role="button"
                @click="onAssetCardClick('character', c)"
                @keydown.enter.prevent="onAssetCardClick('character', c)"
                @keydown.space.prevent="onAssetCardClick('character', c)"
              >
                <span v-if="assetSelectMode" class="asset-select-check" :class="{ 'is-on': isAssetSelected('character', c.id) }">
                  <svg v-if="isAssetSelected('character', c.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <button v-else class="asset-del-btn" title="删除角色" @click.stop="askDeleteAsset('character', c)"><X :size="11" /></button>
                <div class="character-asset-main">
                  <div class="character-asset-overview"><div class="character-portrait">
                      <img
                        v-if="c.image_url || c.imageUrl"
                        :src="thumbOf(assetImageSrc(c))"
                        class="previewable-image"
                        loading="lazy"
                        @error="thumbFallback($event, assetImageSrc(c))"
                        @click.stop="openImageViewer(assetImageSrc(c), `${c.name} 角色形象`)"
                      />
                      <div v-else class="character-portrait-empty">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      </div>
                      <span class="asset-cover-badge" :class="(c.image_url || c.imageUrl) ? 'is-ready' : (isPendingCharImage(c.id) ? 'is-pending' : (isFailedCharImage(c.id) ? 'is-failed' : ''))" :title="failedCharImages[c.id] || ''">
                        {{ (c.image_url || c.imageUrl) ? '形象已生成' : (isPendingCharImage(c.id) ? '形象生成中' : (isFailedCharImage(c.id) ? '形象生成失败' : '形象待生成')) }}
                      </span>
                    </div>

                    <div class="character-asset-head">
                      <div class="character-title-block">
                        <div class="character-name-row">
                          <strong class="character-name">{{ c.name }}</strong>
                          <span class="tag">{{ c.role || '角色' }}</span>
                        </div>
                        <div class="character-visual-summary" :title="characterVisualSummary(c)">
                          <span>样貌：{{ characterAppearanceValue(c) }}</span>
                          <span>妆造：{{ characterStylingValue(c) }}</span>
                        </div>
                      </div>
                      <button class="btn btn-sm character-gen-btn" :disabled="isPendingCharImage(c.id)" @click.stop="genCharImg(c.id)">
                        <Loader2 v-if="isPendingCharImage(c.id)" :size="11" class="animate-spin" />
                        {{ (c.image_url || c.imageUrl) ? '重绘' : (isPendingCharImage(c.id) ? '生成中' : (isFailedCharImage(c.id) ? '重试' : '生成')) }}
                      </button>
                      <button class="btn btn-sm" title="上传角色形象图" :disabled="isUploadingAsset('character', c.id)" @click.stop="uploadAssetImage('character', c.id)">
                        <Loader2 v-if="isUploadingAsset('character', c.id)" :size="11" class="animate-spin" />
                        <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        上传
                      </button>
                    </div>
                  </div>
                  <div class="asset-final-prompt" :title="c.final_prompt || c.finalPrompt || ''">
                    <span class="afp-label">最终提示词 · 三视图</span>
                    <span :class="['afp-text', !(c.final_prompt || c.finalPrompt) && 'dim']">{{ c.final_prompt || c.finalPrompt || '首次生成形象时由提示词 Agent 自动生成' }}</span>
                  </div>
                </div>
              </article>
            </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import { Loader2, X } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  visualChars, assetSelectMode, isAssetSelected, onAssetCardClick,
  askDeleteAsset, assetImageSrc, openImageViewer, isPendingCharImage,
  isFailedCharImage, failedCharImages, characterVisualSummary,
  characterAppearanceValue, characterStylingValue, genCharImg,
  isUploadingAsset, uploadAssetImage,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/assets.css"></style>
