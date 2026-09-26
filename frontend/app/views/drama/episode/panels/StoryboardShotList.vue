<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
              <aside class="storyboard-shot-list">
                <div class="shot-list-head">
                  <div class="shot-list-head-main">
                    <div class="shot-list-head-copy">
                      <div class="shot-list-title">分镜列表</div>
                      <div class="shot-list-sub">检查拆分描述和绑定的角色场景</div>
                    </div>
                    <span class="tag mono">{{ totalDuration }}s</span>
                    <button v-if="!sbSelectMode && sbs.length" class="shot-quick-btn" @click="sbSelectMode = true">选择</button>
                  </div>
                  <div v-if="sbSelectMode" class="shot-quick-actions">
                    <button class="shot-quick-btn" @click="toggleSelectAllSbs">全选</button>
                    <button class="shot-quick-btn" @click="selectMissingSbs">仅缺失</button>
                    <button class="shot-quick-btn" @click="selectedSbIds = []">清空</button>
                  </div>
                </div>
                <div class="shot-list-body">
                  <button
                    v-for="(sb, i) in sbs"
                    :key="sb.id"
                    type="button"
                    class="storyboard-shot-card"
                    :class="{ active: !sbSelectMode && selectedSb?.id === sb.id, 'is-selected': sbSelectMode && isSbSelected(sb.id) }"
                    @click="onShotCardClick(sb)"
                  >
                    <div class="storyboard-shot-head">
                      <span
                        v-if="sbSelectMode"
                        class="shot-check"
                        :class="{ on: isSbSelected(sb.id) }"
                      >
                        <svg v-if="isSbSelected(sb.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </span>
                      <div class="shot-num">#{{ String(i + 1).padStart(2, '0') }}</div>
                      <span class="storyboard-shot-chip">{{ sb.duration || 10 }}s</span>
                      <span v-if="getSceneName(sb)" class="shot-location"><MapPin :size="9" />{{ getSceneName(sb) }}</span>
                      <span v-if="hasVid(sb)" class="shot-chip-video" :title="[sb.video_size ? `文件大小 ${formatSize(sb.video_size)}` : '', sb.video_model ? `模型 ${sb.video_model}` : '', sb.video_attempt_count > 1 ? `生成 ${sb.video_attempt_count} 次` : ''].filter(Boolean).join(' · ') || '已生成视频'"><Play :size="8" />已出片{{ sb.video_size ? ` · ${formatSize(sb.video_size)}` : '' }}{{ sb.video_model ? ` · ${sb.video_model}` : '' }}{{ sb.video_attempt_count > 1 ? ` · ×${sb.video_attempt_count}` : '' }}</span>
                    </div>
                    <div class="shot-body">
                      <div class="shot-desc" :class="{ 'is-empty': !sb.description }">{{ sb.description || '暂无画面描述' }}</div>
                    </div>
                    <div class="shot-meta">
                      <div class="shot-avatars">
                        <template v-if="getStoryboardCharacters(sb).length">
                          <span
                            v-for="c in getStoryboardCharacters(sb).slice(0, 3)"
                            :key="c.id"
                            class="shot-avatar"
                            :title="c.name"
                          >
                            <img v-if="assetImageSrc(c)" :src="thumbOf(assetImageSrc(c))" :alt="c.name" loading="lazy" @error="thumbFallback($event, assetImageSrc(c))" />
                            <template v-else>{{ (c.name || '?').slice(0, 1) }}</template>
                          </span>
                          <span v-if="getStoryboardCharacters(sb).length > 3" class="shot-avatar shot-avatar-more">+{{ getStoryboardCharacters(sb).length - 3 }}</span>
                        </template>
                        <span v-else class="shot-avatars-empty">0 角色</span>
                      </div>
                      <div class="shot-flags">
                        <span v-if="vpStatusBadge(sb) === 'running'" class="shot-flag flag-vp-running" title="提示词生成中"><Loader2 :size="8" class="animate-spin" />词</span>
                        <span v-else-if="vpStatusBadge(sb) === 'done'" class="shot-flag flag-vp-done" title="提示词已生成"><i class="dot"></i>词</span>
                        <span v-else-if="vpStatusBadge(sb) === 'failed'" class="shot-flag flag-vp-failed" :title="`提示词生成失败：${vpItemBySbId(sb.id)?.error || ''}`"><i class="dot"></i>词</span>
                        <span v-else-if="vpStatusBadge(sb) === 'pending'" class="shot-flag flag-vp-pending" title="提示词待生成"><i class="dot"></i>词</span>
                        <span class="shot-flag flag-video" :class="{ on: hasVid(sb) }" :title="hasVid(sb) ? '已生成视频' : '未生成视频'"><i class="dot"></i>视</span>
                      </div>
                    </div>
                  </button>
                </div>
                <div v-if="sbSelectMode" class="shot-select-bar">
                  <div class="shot-select-info">
                    <span class="shot-select-count">已选 {{ selectedSbIds.length }} 个</span>
                    <button class="btn btn-sm" @click="exitSbSelectMode">取消</button>
                  </div>
                  <button class="btn btn-sm btn-primary shot-select-go" :disabled="!selectedSbIds.length || videoPromptBatch.running" @click="generateSelectedVideoPrompts">
                    <Loader2 v-if="videoPromptBatch.running" :size="11" class="animate-spin" />
                    {{ videoPromptBatch.running ? `生成中 ${videoPromptBatch.completed}/${videoPromptBatch.total}` : `生成视频提示词(${selectedSbIds.length})` }}
                  </button>
                </div>
              </aside>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import { Loader2, MapPin, Play } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  totalDuration, sbSelectMode, sbs, toggleSelectAllSbs, selectMissingSbs,
  selectedSbIds, selectedSb, isSbSelected, onShotCardClick, getSceneName,
  hasVid, formatSize, getStoryboardCharacters, assetImageSrc, vpStatusBadge,
  vpItemBySbId, exitSbSelectMode, videoPromptBatch,
  generateSelectedVideoPrompts,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/storyboard.css"></style>
