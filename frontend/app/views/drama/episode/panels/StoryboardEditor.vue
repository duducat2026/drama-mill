<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
              <section class="storyboard-editor-main" v-if="selectedSb">
                <div class="sb-header-top">
                  <div class="sb-nav-group">
                    <button
                      type="button"
                      class="btn btn-icon btn-sm sb-nav-btn"
                      :disabled="sbs.indexOf(selectedSb) <= 0"
                      @click="selectedSb = sbs[sbs.indexOf(selectedSb) - 1]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <div class="detail-head-copy">
                      <span class="detail-head-title">分镜 #{{ sbs.indexOf(selectedSb) + 1 }}</span>
                      <span class="dim sb-header-total">/ 共 {{ sbs.length }} 个</span>
                    </div>
                    <button
                      type="button"
                      class="btn btn-icon btn-sm sb-nav-btn"
                      :disabled="sbs.indexOf(selectedSb) >= sbs.length - 1"
                      @click="selectedSb = sbs[sbs.indexOf(selectedSb) + 1]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>
                </div>
                <div class="sb-header-fields">
                  <span class="sb-field-label">时长</span>
                  <span class="sb-duration-input">
                    <input :value="selectedSb.duration || 10" class="input" type="number" min="1" max="60" @blur="updateField(selectedSb, 'duration', Number($event.target.value))" />
                    <span class="sb-duration-unit">s</span>
                  </span>
                  <span v-if="selectedSb.video_model" class="sb-field-label" :title="`视频模型: ${selectedSb.video_model}${selectedSb.video_attempt_count > 1 ? `（生成 ${selectedSb.video_attempt_count} 次）` : ''}`">模型 {{ selectedSb.video_model }}{{ selectedSb.video_attempt_count > 1 ? ` · ×${selectedSb.video_attempt_count}` : '' }}</span>
                  <!-- 角色/场景/道具绑定已移至右侧参考素材面板 -->
                </div>

                <div class="storyboard-editor-scroll">
                  <div class="sb-split">
                    <div class="detail-section">
                      <div class="detail-section-head">
                        <span class="detail-section-title">分镜描述</span>
                      </div>
                      <label class="field">
                        <span class="field-label">画面描述 <span class="dim">(按【镜头1】【镜头2】…逐子镜头描述；台词写「角色名说：「台词」」，旁白写「旁白：内容」)</span></span>
                        <textarea :value="selectedSb.description || ''" class="textarea" rows="8" @blur="updateField(selectedSb, 'description', $event.target.value)" placeholder="分镜画面描述" />
                      </label>
                      <label class="field">
                        <span class="field-label">氛围</span>
                        <textarea :value="selectedSb.atmosphere || ''" class="textarea" rows="3" @blur="updateField(selectedSb, 'atmosphere', $event.target.value)" placeholder="光线、色调、空气感、环境氛围" />
                      </label>
                    </div>

                    <div class="detail-section">
                      <div class="detail-section-head">
                        <span class="detail-section-title">视频提示词</span>
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
                      <div class="detail-section-copy">根据当前分镜的画面描述（含台词/旁白）与氛围生成</div>
                      <MentionTextarea
                        :model-value="selectedSb.video_prompt || selectedSb.videoPrompt || ''"
                        :options="mentionOptions"
                        :rows="12"
                        input-class="textarea"
                        placeholder="用 @角色名 / @场景名 / @道具名 引用参考素材，按 3 秒一段换行描述画面运动与镜头；也可点 AI 生成由提示词 Agent 自动创作…"
                        @commit="v => updateField(selectedSb, 'video_prompt', v)"
                      />
                    </div>
                  </div>
                </div>
              </section>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import { Loader2 } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  selectedSb, sbs, updateField, videoPromptGeneratingIds, videoPromptBatch,
  genVideoPrompt, mentionOptions,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/storyboard.css"></style>
