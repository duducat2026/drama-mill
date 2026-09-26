<!--
  Drama Mill — episode 工作台子组件（自 views/drama/episode.vue 机械拆分，模板与逻辑逐字保留）
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
      <div v-if="assetDetail.open && assetDetail.item" class="overlay asset-detail-overlay" @click.self="closeAssetDetail">
        <section
          class="dialog asset-detail-dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="(assetDetail.type === 'character' ? '角色' : assetDetail.type === 'scene' ? '场景' : '道具') + '详情'"
        >
          <header class="dialog-head asset-detail-head">
            <div class="asset-detail-title-block">
              <span class="asset-detail-kicker">{{ assetTypeLabel(assetDetail.type) }}</span>
              <h2 class="asset-detail-title">{{ assetDetailTitle(assetDetail) }}</h2>
            </div>
            <div class="asset-detail-head-actions">
              <span class="tag" v-if="assetDetail.type === 'character'">{{ assetDetail.item.role || '角色' }}</span>
              <span class="tag" v-else-if="assetDetail.type === 'prop'">{{ assetDetail.item.type || '道具' }}</span>
              <span class="tag" v-else>{{ assetDetail.item.time || '未设时间' }}</span>
              <button class="btn btn-ghost btn-icon" @click="closeAssetDetail">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </header>

          <div class="dialog-body asset-detail-body">
            <div class="asset-detail-shell">
              <aside class="asset-detail-preview-panel">
                <div class="asset-detail-section-title">
                  <span>视觉预览</span>
                  <span :class="['asset-detail-state', assetImageSrc(assetDetail.item) ? 'is-ready' : '']">
                    {{ assetImageSrc(assetDetail.item) ? '已生成' : '待生成' }}
                  </span>
                </div>

                <button
                  type="button"
                  class="asset-detail-media-frame"
                  :disabled="!assetImageSrc(assetDetail.item)"
                  @click.stop="openImageViewer(assetImageSrc(assetDetail.item), `${assetDetailTitle(assetDetail)} ${assetDetail.type === 'character' ? '角色形象' : assetDetail.type === 'scene' ? '场景图' : '道具图'}`)"
                >
                  <img
                    v-if="assetImageSrc(assetDetail.item)"
                    :src="thumbOf(assetImageSrc(assetDetail.item))"
                    class="previewable-image"
                    @error="thumbFallback($event, assetImageSrc(assetDetail.item))"
                  />
                  <span v-else class="asset-detail-media-empty">
                    <svg v-if="assetDetail.type === 'character'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    <svg v-else-if="assetDetail.type === 'prop'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                    <svg v-else width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  </span>
                </button>

                <div class="asset-detail-meta-row">
                  <div class="asset-detail-meta-item">
                    <span>类型</span>
                    <strong>{{ assetDetail.type === 'character' ? '角色形象' : assetDetail.type === 'prop' ? '道具' : '场景图片' }}</strong>
                  </div>
                  <div class="asset-detail-meta-item">
                    <span>{{ assetDetail.type === 'character' ? '定位' : assetDetail.type === 'prop' ? '道具类型' : '时间' }}</span>
                    <strong>{{ assetDetail.type === 'character' ? (assetDetail.item.role || '角色') : assetDetail.type === 'prop' ? (assetDetail.item.type || '道具') : (assetDetail.item.time || '未设时间') }}</strong>
                  </div>
                </div>
              </aside>

              <section class="asset-detail-editor-panel">
                <div class="asset-detail-section-title">
                  <span>编辑信息</span>
                  <span class="dim">{{ assetDetail.type === 'character' ? '样貌与妆造会影响角色形象' : assetDetail.type === 'prop' ? '物品外貌会影响道具图' : '空间与光影会影响场景图' }}</span>
                </div>

                <div v-if="assetDetail.type === 'prop'" class="asset-detail-edit-grid asset-detail-edit-grid--prop">
                  <label class="asset-detail-edit-field">
                    <span>物品外貌</span>
                    <textarea
                      v-model="assetDetailDraft.description"
                      class="textarea asset-detail-textarea"
                      rows="6"
                      placeholder="材质、颜色、形状、大小、新旧程度、磨损痕迹等"
                    />
                  </label>
                </div>

                <div v-else :class="['asset-detail-edit-grid', `asset-detail-edit-grid--${assetDetail.type}`]">
                  <label v-if="assetDetail.type === 'character'" class="asset-detail-edit-field">
                    <span>样貌</span>
                    <textarea
                      v-model="assetDetailDraft.appearance"
                      class="textarea asset-detail-textarea"
                      rows="6"
                      placeholder="年龄感、五官、体态、气质等"
                    />
                  </label>
                  <label v-if="assetDetail.type === 'character'" class="asset-detail-edit-field">
                    <span>妆造</span>
                    <textarea
                      v-model="assetDetailDraft.styling"
                      class="textarea asset-detail-textarea"
                      rows="6"
                      placeholder="发型、服装、妆面、配饰等"
                    />
                  </label>
                  <label v-if="assetDetail.type === 'scene'" class="asset-detail-edit-field">
                    <span>场景描述</span>
                    <textarea
                      v-model="assetDetailDraft.prompt"
                      class="textarea asset-detail-textarea"
                      rows="5"
                      placeholder="空间、陈设、年代质感、关键视觉元素等"
                    />
                  </label>
                  <label v-if="assetDetail.type === 'scene'" class="asset-detail-edit-field">
                    <span>场景光影</span>
                    <textarea
                      v-model="assetDetailDraft.lighting"
                      class="textarea asset-detail-textarea"
                      rows="5"
                      placeholder="光源、色调、明暗、氛围等"
                    />
                  </label>
                </div>

              </section>
            </div>

            <section class="asset-detail-prompt-panel">
              <div class="asset-detail-section-title">
                <span>{{ assetDetail.type === 'character' ? '最终提示词 · 三视图' : assetDetail.type === 'scene' ? '最终提示词 · 固定视角' : '最终提示词 · 白底单品' }}</span>
                <div class="asset-detail-prompt-head-actions">
                  <button
                    class="btn btn-sm"
                    :disabled="isGeneratingPrompt(assetDetail.type, assetDetail.item.id) || isAssetImagePending(assetDetail.type, assetDetail.item.id)"
                    @click="genAssetFinalPrompt"
                  >
                    <Loader2 v-if="isGeneratingPrompt(assetDetail.type, assetDetail.item.id)" :size="11" class="animate-spin" />
                    {{ isGeneratingPrompt(assetDetail.type, assetDetail.item.id) ? '生成中' : (assetFinalPrompt ? '重新生成' : '生成提示词') }}
                  </button>
                  <span :class="['asset-detail-state', assetFinalPrompt && 'is-ready']">
                    {{ assetFinalPrompt ? '已生成' : '待生成' }}
                  </span>
                  <button
                    v-if="assetPromptDraft"
                    class="btn btn-ghost btn-sm asset-detail-copy-btn"
                    @click="copyAssetFinalPrompt"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    复制
                  </button>
                </div>
              </div>
              <textarea
                :value="assetPromptDraft"
                @input="onAssetPromptInput"
                class="textarea asset-detail-prompt-textarea"
                rows="5"
                :placeholder="assetDetail.type === 'character'
                  ? '可手动编写三视图最终提示词，或点击「生成提示词」由 Agent 生成'
                  : assetDetail.type === 'scene'
                    ? '可手动编写固定视角最终提示词，或点击「生成提示词」由 Agent 生成'
                    : '可手动编写白底单品最终提示词，或点击「生成提示词」由 Agent 生成'"
              />
              <p class="asset-detail-prompt-hint">
                {{ assetDetail.type === 'character'
                  ? '提示词可直接编辑，保存后生效；修改样貌或妆造并保存后，最终提示词将被清空，下次生成形象时由提示词 Agent 重新生成。'
                  : assetDetail.type === 'scene'
                    ? '提示词可直接编辑，保存后生效；修改场景描述或光影并保存后，最终提示词将被清空，下次生成场景图时由提示词 Agent 重新生成。'
                    : '提示词可直接编辑，保存后生效；修改物品外貌并保存后，最终提示词将被清空，下次生成道具图时由提示词 Agent 重新生成。' }}
              </p>
            </section>
          </div>

          <footer class="dialog-foot asset-detail-foot">
            <div class="asset-detail-secondary-actions">
              <button class="btn btn-danger" @click="askDeleteAsset(assetDetail.type, assetDetail.item)">删除</button>
              <button class="btn" @click="closeAssetDetail">关闭</button>
            </div>
            <div class="asset-detail-primary-actions">
              <button
                class="btn"
                :disabled="isUploadingAsset(assetDetail.type, assetDetail.item.id)"
                @click="uploadAssetImage(assetDetail.type, assetDetail.item.id)"
              >
                <Loader2 v-if="isUploadingAsset(assetDetail.type, assetDetail.item.id)" :size="11" class="animate-spin" />
                <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                上传图片
              </button>
              <button
                v-if="assetDetail.type === 'character'"
                class="btn"
                :disabled="isPendingCharImage(assetDetail.item.id)"
                @click="genCharImg(assetDetail.item.id)"
              >
                {{ assetImageSrc(assetDetail.item) ? '重绘形象' : (isPendingCharImage(assetDetail.item.id) ? '生成中' : '生成形象') }}
              </button>
              <button
                v-else-if="assetDetail.type === 'scene'"
                class="btn"
                :disabled="isPendingSceneImage(assetDetail.item.id)"
                @click="genSceneImg(assetDetail.item.id)"
              >
                {{ assetImageSrc(assetDetail.item) ? '重绘场景' : (isPendingSceneImage(assetDetail.item.id) ? '生成中' : '生成场景') }}
              </button>
              <button
                v-else-if="assetDetail.type === 'prop'"
                class="btn"
                :disabled="isPendingPropImage(assetDetail.item.id)"
                @click="genPropImg(assetDetail.item.id)"
              >
                {{ assetImageSrc(assetDetail.item) ? '重绘道具图' : (isPendingPropImage(assetDetail.item.id) ? '生成中' : '生成道具图') }}
              </button>
              <button class="btn btn-primary" :disabled="savingAssetDetail" @click="saveAssetDetail">
                <Loader2 v-if="savingAssetDetail" :size="12" class="animate-spin" />
                保存修改
              </button>
            </div>
          </footer>
        </section>
      </div>
</template>

<script setup>
import { EPISODE_WB } from '~/composables/episode/workbench-context'
import { Loader2 } from 'lucide-vue-next'

const wb = inject(EPISODE_WB)
const {
  assetDetail, closeAssetDetail, assetTypeLabel, assetDetailTitle, panel,
  assetImageSrc, openImageViewer, assetDetailDraft, isGeneratingPrompt,
  isAssetImagePending, genAssetFinalPrompt, assetFinalPrompt,
  assetPromptDraft, copyAssetFinalPrompt, onAssetPromptInput, askDeleteAsset,
  isUploadingAsset, uploadAssetImage, isPendingCharImage, genCharImg,
  isPendingSceneImage, genSceneImg, isPendingPropImage, genPropImg,
  savingAssetDetail, saveAssetDetail,
} = wb
</script>

<style scoped src="~/assets/styles/episode/episode.base.css"></style>
<style scoped src="~/assets/styles/episode/dialogs.css"></style>
