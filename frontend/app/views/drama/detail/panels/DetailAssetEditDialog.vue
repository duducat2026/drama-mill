<template>
  <!-- 素材详情 / 编辑对话框（与工作台资产卡片同款布局） -->
  <div v-if="editDialog && editTarget" class="overlay mat-detail-overlay" @click.self="closeEdit">
    <section class="dialog mat-detail-dialog" aria-label="素材详情">
      <header class="dialog-head mat-detail-head">
        <div class="mat-detail-title-block">
          <span class="mat-detail-kicker">{{ editTarget.kind === '角色' ? '角色资产' : editTarget.kind === '场景' ? '场景资产' : '道具资产' }}</span>
          <h2 class="mat-detail-title">{{ editTarget.name || '未命名' }}</h2>
        </div>
        <div class="mat-detail-head-actions">
          <span v-if="editTarget.kindKey === 'character'" class="tag">{{ editTarget.role || '角色' }}</span>
          <span v-else-if="editTarget.kindKey === 'prop'" class="tag">{{ editTarget.type || '道具' }}</span>
          <span v-else class="tag">{{ editTarget.time || '未设时间' }}</span>
          <button class="btn btn-ghost btn-icon" @click="closeEdit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </header>

      <div class="dialog-body mat-detail-body">
        <div class="mat-detail-shell">
          <!-- 左侧：视觉预览 -->
          <aside class="mat-detail-preview-panel">
            <div class="mat-detail-section-title">
              <span>视觉预览</span>
              <span :class="['mat-detail-state', matHasImage(editTarget) ? 'is-ready' : '']">
                {{ matHasImage(editTarget) ? '已生成' : '待生成' }}
              </span>
            </div>

            <button
              type="button"
              class="mat-detail-media-frame"
              :disabled="!matHasImage(editTarget)"
              @click.stop="openAssetViewer(editTarget)"
            >
              <img v-if="matHasImage(editTarget)" :src="thumbOf(assetSrc(editTarget))" @error="thumbFallback($event, assetSrc(editTarget))" />
              <span v-else class="mat-detail-media-empty">
                <svg v-if="editTarget.kindKey === 'character'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <svg v-else-if="editTarget.kindKey === 'prop'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                <svg v-else width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              </span>
            </button>

            <div class="mat-detail-meta-row">
              <div class="mat-detail-meta-item">
                <span>类型</span>
                <strong>{{ editTarget.kind === '角色' ? '角色形象' : editTarget.kind === '道具' ? '道具' : '场景图片' }}</strong>
              </div>
              <div class="mat-detail-meta-item">
                <span>{{ editTarget.kindKey === 'character' ? '定位' : editTarget.kindKey === 'prop' ? '道具类型' : '时间' }}</span>
                <strong>{{ editTarget.kindKey === 'character' ? (editTarget.role || '角色') : editTarget.kindKey === 'prop' ? (editTarget.type || '道具') : (editTarget.time || '未设时间') }}</strong>
              </div>
            </div>
          </aside>

          <!-- 右侧：编辑信息 -->
          <section class="mat-detail-editor-panel">
            <div class="mat-detail-section-title">
              <span>编辑信息</span>
              <span class="dim">{{ editTarget.kindKey === 'character' ? '样貌与妆造会影响角色形象' : editTarget.kindKey === 'prop' ? '物品外貌会影响道具图' : '空间与光影会影响场景图' }}</span>
            </div>

            <!-- 道具：单列物品外貌 -->
            <div v-if="editTarget.kindKey === 'prop'" class="mat-detail-edit-grid mat-detail-edit-grid--prop">
              <label class="mat-detail-edit-field">
                <span>名称</span>
                <input v-model="editDraft.name" class="input" placeholder="道具名称" />
              </label>
              <label class="mat-detail-edit-field">
                <span>类型</span>
                <input v-model="editDraft.type" class="input" placeholder="如：武器 / 信物" />
              </label>
              <label class="mat-detail-edit-field">
                <span>物品外貌</span>
                <textarea v-model="editDraft.description" class="textarea mat-detail-textarea" rows="6" placeholder="材质、颜色、形状、大小、新旧程度、磨损痕迹等" />
              </label>
            </div>

            <!-- 角色：样貌 + 妆造 -->
            <div v-else-if="editTarget.kindKey === 'character'" class="mat-detail-edit-grid mat-detail-edit-grid--character">
              <label class="mat-detail-edit-field">
                <span>名称</span>
                <input v-model="editDraft.name" class="input" placeholder="角色名" />
              </label>
              <label class="mat-detail-edit-field">
                <span>定位</span>
                <input v-model="editDraft.role" class="input" placeholder="主角 / 反派 / 配角…" />
              </label>
              <label class="mat-detail-edit-field">
                <span>样貌</span>
                <textarea v-model="editDraft.appearance" class="textarea mat-detail-textarea" rows="5" placeholder="年龄感、五官、体态、气质等" />
              </label>
              <label class="mat-detail-edit-field">
                <span>妆造</span>
                <textarea v-model="editDraft.styling" class="textarea mat-detail-textarea" rows="5" placeholder="发型、服装、妆面、配饰等" />
              </label>
              <label class="mat-detail-edit-field">
                <span>人物设定</span>
                <textarea v-model="editDraft.description" class="textarea mat-detail-textarea" rows="4" placeholder="性格、背景、动机…" />
              </label>
            </div>

            <!-- 场景：描述 + 光影 -->
            <div v-else class="mat-detail-edit-grid mat-detail-edit-grid--scene">
              <label class="mat-detail-edit-field">
                <span>地点</span>
                <input v-model="editDraft.location" class="input" placeholder="如：故宫太和殿" />
              </label>
              <label class="mat-detail-edit-field">
                <span>时间</span>
                <input v-model="editDraft.time" class="input" placeholder="如：黄昏 / 深夜" />
              </label>
              <label class="mat-detail-edit-field">
                <span>场景描述</span>
                <textarea v-model="editDraft.prompt" class="textarea mat-detail-textarea" rows="5" placeholder="空间、陈设、年代质感、关键视觉元素等" />
              </label>
              <label class="mat-detail-edit-field">
                <span>场景光影</span>
                <textarea v-model="editDraft.lighting" class="textarea mat-detail-textarea" rows="5" placeholder="光源、色调、明暗、氛围等" />
              </label>
            </div>
          </section>
        </div>

        <!-- 最终提示词：可生成 / 重新生成 / 手动编辑 -->
        <section class="mat-detail-prompt-panel">
          <div class="mat-detail-section-title">
            <span>最终提示词</span>
            <span class="dim">由 AI 根据信息生成，可手动修改后保存</span>
            <button
              class="btn btn-sm mat-detail-prompt-gen"
              :disabled="finalPromptGen || !firstEpisodeId"
              :title="firstEpisodeId ? '由 AI 生成最终提示词' : '请先在「剧集列表」创建至少一集'"
              @click="generateFinalPrompt(editTarget)"
            >
              <svg v-if="!finalPromptGen" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3m0 12v3m9-9h-3M6 12H3m13.5-6.5L14 8m-4 8-2.5 2.5m11 0L16 16M8 8 5.5 5.5"/><circle cx="12" cy="12" r="3"/></svg>
              {{ finalPromptGen ? '生成中…' : (editDraft.finalPrompt ? '重新生成' : '生成提示词') }}
            </button>
          </div>
          <textarea
            v-model="editDraft.finalPrompt"
            class="textarea mat-detail-prompt-text"
            rows="5"
            placeholder="点击「生成提示词」由 AI 根据信息生成，或在此手动填写。手动修改并保存后，下次生成图片将使用此提示词。"
          ></textarea>
        </section>
      </div>

      <footer class="dialog-foot mat-detail-foot">
        <div class="mat-detail-secondary-actions">
          <button class="btn" @click="closeEdit">关闭</button>
        </div>
        <div class="mat-detail-primary-actions">
          <button
            class="btn"
            :disabled="isUploading(editTarget)"
            @click="uploadMaterial(editTarget)"
          >
            <span v-if="isUploading(editTarget)" class="ring-spinner sm"></span>
            <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            上传图片
          </button>
          <button
            class="btn"
            :disabled="isPending(editTarget)"
            @click="generateMaterial(editTarget)"
          >
            {{ matHasImage(editTarget) ? '重新生成' : (isPending(editTarget) ? '生成中…' : '生成图片') }}
          </button>
          <button class="btn btn-primary" :disabled="editSaving" @click="saveEdit">
            {{ editSaving ? '保存中…' : '保存修改' }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<script setup>
// vm = useDetailAssets(dramaId, drama, load) 的返回；解构为同名局部量以保模板绑定与拆分前逐字一致
const props = defineProps({ vm: { type: Object, required: true } })
const {
  editDialog, editSaving, editTarget, editDraft, openAssetViewer, closeEdit, saveEdit,
  matHasImage, assetSrc, isPending, isUploading, generateMaterial, uploadMaterial,
  finalPromptGen, firstEpisodeId, generateFinalPrompt,
} = props.vm
</script>

<style scoped src="~/assets/styles/drama.detail.css"></style>
