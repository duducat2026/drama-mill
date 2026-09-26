<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
            <div v-if="propItems.length" class="asset-grid">
              <div
                v-for="p in propItems"
                :key="p.id"
                :class="['card', 'asset-card', 'asset-click-card', 'prop-card', assetSelectMode && isAssetSelected('prop', p.id) && 'is-asset-selected']"
                tabindex="0"
                role="button"
                @click="onAssetCardClick('prop', p)"
                @keydown.enter.prevent="onAssetCardClick('prop', p)"
                @keydown.space.prevent="onAssetCardClick('prop', p)"
              >
                <span v-if="assetSelectMode" class="asset-select-check" :class="{ 'is-on': isAssetSelected('prop', p.id) }">
                  <svg v-if="isAssetSelected('prop', p.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <button v-else class="asset-del-btn" title="删除道具" @click.stop="askDeleteAsset('prop', p)"><X :size="11" /></button>
                <div class="asset-cover wide">
                  <img
                    v-if="p.image_url || p.imageUrl"
                    :src="thumbOf(assetImageSrc(p))"
                    class="previewable-image"
                    loading="lazy"
                    @error="thumbFallback($event, assetImageSrc(p))"
                    @click.stop="openImageViewer(assetImageSrc(p), `${p.name} 道具图`)"
                  />
                  <div v-else class="asset-cover-empty">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                  </div>
                  <span class="asset-cover-badge" :class="(p.image_url || p.imageUrl) ? 'is-ready' : (isPendingPropImage(p.id) ? 'is-pending' : (isFailedPropImage(p.id) ? 'is-failed' : ''))" :title="failedPropImages[p.id] || ''">{{ (p.image_url || p.imageUrl) ? '已生成' : (isPendingPropImage(p.id) ? '生成中' : (isFailedPropImage(p.id) ? '生成失败' : '待生成')) }}</span>
                </div>
                <div class="asset-body">
                  <div class="prop-name-row">
                    <span class="asset-name" :title="p.name">{{ p.name }}</span>
                    <span class="tag">{{ p.type || '道具' }}</span>
                  </div>
                  <div class="asset-meta asset-desc dim" :title="p.description || ''">{{ p.description || '暂无描述' }}</div>
                  <div class="asset-meta asset-final" :class="{ dim: !(p.final_prompt || p.finalPrompt) }" :title="p.final_prompt || p.finalPrompt || ''">
                    <span class="afp-label">最终提示词 · 白底单品</span>
                    {{ p.final_prompt || p.finalPrompt || '首次生成图片时由提示词 Agent 自动生成（白底单品）' }}
                  </div>
                </div>
                <div class="asset-foot">
                  <span :class="['dot', (p.image_url || p.imageUrl) && 'ok', isPendingPropImage(p.id) && 'pending']" />
                  <button class="btn btn-sm ml-auto" title="上传道具图" :disabled="isUploadingAsset('prop', p.id)" @click.stop="uploadAssetImage('prop', p.id)">
                    <Loader2 v-if="isUploadingAsset('prop', p.id)" :size="11" class="animate-spin" />
                    <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    上传
                  </button>
                  <button class="btn btn-sm" :disabled="isPendingPropImage(p.id)" @click.stop="genPropImg(p.id)">
                    <Loader2 v-if="isPendingPropImage(p.id)" :size="11" class="animate-spin" />
                    {{ (p.image_url || p.imageUrl) ? '重绘' : (isPendingPropImage(p.id) ? '生成中' : (isFailedPropImage(p.id) ? '重试' : '生成')) }}
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="asset-props-empty">本集暂无涉及事态发展的关键道具</div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import { Loader2, X } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  propItems, assetSelectMode, isAssetSelected, onAssetCardClick,
  askDeleteAsset, assetImageSrc, openImageViewer, isPendingPropImage,
  isFailedPropImage, failedPropImages, isUploadingAsset, uploadAssetImage,
  genPropImg,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/assets.css"></style>
