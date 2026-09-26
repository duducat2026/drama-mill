<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
              <div v-if="selectedSb" class="video-task-side">
              <aside class="video-task-player">
                <div class="video-player-head">
                  <div class="video-player-head-info">
                    <div class="video-player-title">分镜 {{ String(selectedVideoTaskNumber).padStart(2, '0') }}</div>
                    <span :class="['video-task-status', 'is-' + videoTaskState(selectedSb)]">
                      <span :class="['dot', videoTaskState(selectedSb) === 'done' && 'ok', videoTaskState(selectedSb) === 'pending' && 'pending']" />
                      {{ videoTaskStatusLabel(selectedSb) }}
                    </span>
                    <span v-if="selectedSb.duration" class="video-player-sub">{{ selectedSb.duration }}s</span>
                  </div>
                  <button
                    v-if="previewVideoUrl"
                    class="btn btn-sm btn-primary"
                    @click="setAsMainVideo"
                  >
                    设为主视频
                  </button>
                  <a
                    v-if="previewVideoUrl || hasVid(selectedSb)"
                    :href="'/' + (previewVideoUrl || getVideoUrl(selectedSb))"
                    :download="shotFileName(previewVideoUrl || getVideoUrl(selectedSb))"
                    class="btn btn-sm"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    下载
                  </a>
                </div>
                <div class="video-player-stage">
                  <video
                    v-if="previewVideoUrl || hasVid(selectedSb)"
                    :key="previewVideoUrl || getVideoUrl(selectedSb)"
                    :src="'/' + (previewVideoUrl || getVideoUrl(selectedSb))"
                    :poster="posterOf('/' + (previewVideoUrl || getVideoUrl(selectedSb))) || undefined"
                    controls
                    preload="metadata"
                    playsinline
                    class="video-player-video"
                  />
                  <div v-else class="video-player-empty">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                    <div class="video-player-empty-title">{{ videoTaskState(selectedSb) === 'pending' ? '视频生成中…' : '尚未生成视频' }}</div>
                    <div class="video-player-empty-desc">{{ videoTaskState(selectedSb) === 'pending' ? '生成完成后可在此播放预览' : '点击下方按钮为当前分镜生成视频' }}</div>
                    <button
                      v-if="videoTaskState(selectedSb) !== 'pending'"
                      class="btn btn-primary btn-sm"
                      style="margin-top:4px"
                      @click="genVid(selectedSb)"
                    >
                      生成视频
                    </button>
                  </div>
                </div>
              </aside>

              <div v-if="sbVideoHistory.length" class="video-player-history">
                <div class="video-player-history-head">
                  <span>历史视频</span>
                  <span class="video-player-history-count">{{ sbVideoHistory.length }}</span>
                </div>
                <div class="video-player-history-list">
                  <div
                    v-for="t in sbVideoHistory"
                    :key="t.id"
                    :class="['video-history-item', { current: isCurrentVideo(t), viewing: !!previewVideoUrl && previewVideoUrl === taskVideoPath(t) }]"
                    role="button"
                    tabindex="0"
                    @click="previewHistoryVideo(t)"
                    @keydown.enter.prevent="previewHistoryVideo(t)"
                  >
                    <video :src="'/' + taskVideoPath(t)" :poster="posterOf('/' + taskVideoPath(t)) || undefined" preload="none" muted playsinline tabindex="-1" />
                    <span class="video-history-time">{{ formatHistoryTime(taskCreatedAt(t)) }}<template v-if="t.video_size || t.videoSize"> · {{ formatSize(t.video_size || t.videoSize) }}</template></span>
                    <span v-if="isCurrentVideo(t)" class="video-history-badge">当前</span>
                    <button v-else type="button" class="video-history-del" title="删除该记录" @click.stop="removeHistoryVideo(t)">×</button>
                  </div>
                </div>
              </div>

              <aside class="video-task-inspector">
                <div class="video-inspector-body">
                  <section class="video-inspector-section">
                    <div class="video-inspector-prompt-head">
                      <span class="video-inspector-label video-inspector-label-hero">视频提示词</span>
                      <button
                        type="button"
                        class="btn btn-sm"
                        :disabled="videoPromptGeneratingIds.includes(selectedSb?.id) || videoPromptBatch.running"
                        @click="genVideoPrompt(selectedSb)"
                      >
                        <Loader2 v-if="videoPromptGeneratingIds.includes(selectedSb?.id)" :size="11" class="animate-spin" />
                        {{ (selectedSb.video_prompt || selectedSb.videoPrompt) ? '重新生成' : 'AI 生成' }}
                      </button>
                    </div>
                    <MentionTextarea
                      :model-value="selectedSb.video_prompt || selectedSb.videoPrompt || ''"
                      :options="mentionOptions"
                      :rows="9"
                      input-class="textarea video-inspector-prompt"
                      placeholder="用 @角色名 / @场景名 / @道具名 引用参考素材，生成时自动映射为参考图片；再按时间段描述画面运动与镜头…"
                      @commit="v => updateField(selectedSb, 'video_prompt', v)"
                    />
                  </section>

                  <section class="video-inspector-section">
                    <span class="video-inspector-label">参考素材</span>
                    <div class="video-inspector-assets">
                      <button
                        v-for="asset in getShotReferenceAssets(selectedSb)"
                        :key="asset.key"
                        type="button"
                        class="video-inspector-asset"
                        :disabled="!asset.ready"
                        @click="asset.ready && openImageViewer(assetImageSrc({ imageUrl: asset.imageUrl }), `${asset.name} ${asset.type}`)"
                      >
                        <img v-if="asset.ready" :src="thumbOf(assetImageSrc({ imageUrl: asset.imageUrl }))" :alt="asset.name" loading="lazy" @error="thumbFallback($event, assetImageSrc({ imageUrl: asset.imageUrl }))" />
                        <span v-else>{{ asset.type }}</span>
                        <small>{{ asset.name }}</small>
                      </button>
                      <div v-if="!getShotReferenceAssets(selectedSb).length" class="video-inspector-empty">当前分镜未绑定参考素材</div>
                    </div>
                  </section>

                  <section class="video-inspector-section">
                    <span class="video-inspector-label">参考图片 / 视频 / 音频</span>
                    <div v-if="videoRefImageUrls.length || videoRefVideoUrls.length || videoRefAudioUrls.length" class="video-ref-media-list">
                      <span v-for="(url, i) in videoRefImageUrls" :key="'ref-i-' + i" class="video-ref-media-chip">
                        图片 {{ i + 1 }}
                        <button type="button" class="video-ref-media-remove" @click="removeRefMedia('image', i)">×</button>
                      </span>
                      <span v-for="(url, i) in videoRefVideoUrls" :key="'ref-v-' + i" class="video-ref-media-chip">
                        视频 {{ i + 1 }}
                        <button type="button" class="video-ref-media-remove" @click="removeRefMedia('video', i)">×</button>
                      </span>
                      <span v-for="(url, i) in videoRefAudioUrls" :key="'ref-a-' + i" class="video-ref-media-chip">
                        音频 {{ i + 1 }}
                        <button type="button" class="video-ref-media-remove" @click="removeRefMedia('audio', i)">×</button>
                      </span>
                    </div>
                    <div class="video-ref-media-actions">
                      <button type="button" class="btn btn-sm" :disabled="uploadingRefMedia || refImageFull" @click="uploadRefMedia('image')">
                        上传参考图片 ({{ refImageUsedCount }}/9)
                      </button>
                      <button type="button" class="btn btn-sm" :disabled="uploadingRefMedia || videoRefVideoUrls.length >= 3" @click="uploadRefMedia('video')">
                        上传参考视频 ({{ videoRefVideoUrls.length }}/3)
                      </button>
                      <button type="button" class="btn btn-sm" :disabled="uploadingRefMedia || videoRefAudioUrls.length >= 3" @click="uploadRefMedia('audio')">
                        上传参考音频 ({{ videoRefAudioUrls.length }}/3)
                      </button>
                    </div>
                    <div
                      v-if="videoRefAudioUrls.length && !getShotReferenceImages(selectedSb).length && !videoRefVideoUrls.length"
                      class="video-ref-media-hint"
                    >参考音频需至少 1 个参考图片或视频</div>
                  </section>

                  <section class="video-inspector-section">
                    <span class="video-inspector-label">生成参数</span>
                    <div class="video-param-row">
                      <span class="video-param-name">生成时长</span>
                      <span class="video-param-control">
                        <input v-model.number="videoDuration" type="number" min="4" max="15" class="input video-duration-input" />
                        <span class="video-param-unit">s（4-15）</span>
                      </span>
                    </div>
                  </section>

                  <button
                    class="btn btn-primary video-inspector-action"
                    :disabled="videoTaskState(selectedSb) === 'pending'"
                    @click="genVid(selectedSb)"
                  >
                    {{ videoTaskActionLabel(selectedSb) }}
                  </button>
                </div>
              </aside>
              </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import { Loader2 } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  selectedSb, selectedVideoTaskNumber, videoTaskState, videoTaskStatusLabel,
  previewVideoUrl, setAsMainVideo, hasVid, getVideoUrl, shotFileName, genVid,
  sbVideoHistory, isCurrentVideo, taskVideoPath, previewHistoryVideo,
  formatHistoryTime, taskCreatedAt, formatSize, removeHistoryVideo,
  videoPromptGeneratingIds, videoPromptBatch, genVideoPrompt, mentionOptions,
  updateField, getShotReferenceAssets, openImageViewer, assetImageSrc,
  videoRefImageUrls, videoRefVideoUrls, videoRefAudioUrls, removeRefMedia,
  uploadingRefMedia, refImageFull, uploadRefMedia, refImageUsedCount,
  getShotReferenceImages, videoDuration, videoTaskActionLabel,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/videos.css"></style>
