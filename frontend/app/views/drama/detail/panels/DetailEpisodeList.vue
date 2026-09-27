<!--
  Drama Mill — AI 短剧生成平台
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<template>
  <div class="ep-grid">
    <div
      v-for="(ep, i) in drama.episodes"
      :key="ep.id"
      :class="['card', 'ep-card', `ep-card-${epStatus(ep)}`]"
      :style="{ animationDelay: `${i * 0.05}s` }"
      @click="navigateTo(`/drama/${drama.id}/episode/${ep.episode_number || ep.episodeNumber}`)"
    >
      <!-- 卡片顶部：编号 + 状态 + 操作 -->
      <div class="ep-header">
        <div :class="['ep-number', `ep-num-${epStatus(ep)}`]">
          <span class="ep-num-label">EP</span>
          <b>{{ String(ep.episode_number || ep.episodeNumber).padStart(2, '0') }}</b>
        </div>
        <div class="ep-badges" @click.stop>
          <button type="button" :class="['tag', 'ep-status-btn', `ep-status-${epStatus(ep)}`]" title="点击标记本集状态" @click="epStatusMenuId = epStatusMenuId === ep.id ? null : ep.id">
            <span :class="['status-dot', epStatusDotClass(ep)]"></span>
            {{ epStatusLabel(ep) }}
          </button>
          <div v-if="epStatusMenuId === ep.id" class="status-menu">
            <button
              v-for="s in epStatusOptions"
              :key="s.value"
              type="button"
              class="status-menu-item"
              :class="{ on: epStatus(ep) === s.value }"
              @click="setEpisodeStatus(ep, s.value)"
            >{{ s.label }}</button>
          </div>
        </div>
        <div class="ep-actions" @click.stop>
          <button type="button" :class="['tag', 'ep-res-btn']" title="点击修改本集视频分辨率" @click="epResMenuId = epResMenuId === ep.id ? null : ep.id">
            {{ epResolution(ep) }}
          </button>
          <div v-if="epResMenuId === ep.id" class="status-menu">
            <button
              v-for="r in resolutionOptions"
              :key="r.value"
              type="button"
              class="status-menu-item"
              :class="{ on: epResolution(ep) === r.value }"
              @click="setEpisodeResolution(ep, r.value)"
            >{{ r.label }}</button>
          </div>
          <button
            class="btn btn-icon btn-sm ep-delete"
            type="button"
            title="删除本集"
            @click="episodeToDelete = ep"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- 标题 -->
      <h3 class="ep-title">{{ ep.title }}</h3>

      <!-- 元数据行 -->
      <div class="ep-meta-row">
        <span v-if="ep.duration" class="ep-meta">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          {{ ep.duration }}s
        </span>
        <span v-if="epHasScript(ep)" class="ep-meta ep-meta-ok">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          剧本已录入
        </span>
        <span v-if="epHasVideo(ep)" class="ep-meta ep-meta-ok">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          已合成
        </span>
      </div>

      <!-- 底部：更新时间 + 进入箭头 -->
      <div class="ep-footer">
        <span v-if="ep.updatedAt || ep.updated_at" class="ep-time">{{ formatEpTime(ep.updatedAt || ep.updated_at) }}</span>
        <svg class="ep-arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </div>

    <!-- Empty episode state（点击也可直接添加第一集） -->
    <div v-if="!drama.episodes?.length" class="card ep-empty" role="button" tabindex="0" title="点击创建第一集" @click="openAddEpisode" @keydown.enter="openAddEpisode">
      <div class="ep-empty-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      </div>
      <p>点击创建第一集</p>
    </div>

    <!-- 已有剧集时，列表末尾常驻「添加下一集」卡片 -->
    <div v-else class="card ep-empty ep-add" role="button" tabindex="0" :title="`添加第 ${(drama.episodes?.length || 0) + 1} 集`" @click="openAddEpisode" @keydown.enter="openAddEpisode">
      <div class="ep-empty-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      </div>
      <p>添加第 {{ (drama.episodes?.length || 0) + 1 }} 集</p>
    </div>
  </div>

  <div v-if="addDialog" class="overlay" @click.self="addDialog = false">
    <div class="dialog ep-dialog">
      <div class="dialog-head">
        <div class="dialog-title">创建新集</div>
        <button class="btn btn-icon btn-sm btn-ghost ml-auto dialog-close" @click="addDialog = false">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="dialog-body">
        <label class="field">
          <span class="field-label">标题</span>
          <input v-model="newEpisodeTitle" class="input" placeholder="默认按集数自动命名" />
          <span class="field-hint">留空时会自动按集数命名，例如“第 3 集”。</span>
        </label>
        <label class="field">
          <span class="field-label">视频分辨率</span>
          <BaseSelect v-model="newEpisodeResolution" :options="resolutionOptions" placeholder="选择分辨率" />
          <span class="field-hint">创建后本集视频按此分辨率生成，之后仍可在集卡片上修改。</span>
        </label>
      </div>
      <div class="dialog-foot">
        <span class="dialog-foot-copy">创建后自动锁定当前启用的图片与视频生成能力。</span>
        <button class="btn" @click="addDialog = false">取消</button>
        <button class="btn btn-primary" :disabled="creatingEpisode" @click="addEpisode">
          {{ creatingEpisode ? '创建中...' : '创建' }}
        </button>
      </div>
    </div>
  </div>
  <ConfirmDialog
    :open="!!episodeToDelete"
    title="删除本集"
    :message="`确定删除「${episodeToDelete?.title || `第 ${episodeToDelete?.episode_number || episodeToDelete?.episodeNumber} 集`}」？删除后不可在列表中查看，其分镜与生成记录将不再可访问。`"
    :loading="deletingEpisode"
    @confirm="confirmDelEpisode"
    @cancel="episodeToDelete = null"
  />
</template>

<script setup>
import BaseSelect from '~/components/BaseSelect.vue'

// drama 由门面传入；vm = useDetailEpisodes(dramaId, load) 的返回，解构为同名局部量
const props = defineProps({
  drama: { type: Object, required: true },
  vm: { type: Object, required: true },
})
const {
  addDialog, creatingEpisode, newEpisodeTitle, episodeToDelete, deletingEpisode,
  resolutionOptions, newEpisodeResolution, epResMenuId, epResolution, setEpisodeResolution,
  epStatusOptions, epStatusMenuId, epStatus, epStatusLabel, epStatusDotClass,
  formatEpTime, setEpisodeStatus, epHasScript, epHasVideo,
  openAddEpisode, addEpisode, confirmDelEpisode,
} = props.vm
</script>

<style scoped src="~/assets/styles/drama.detail.css"></style>
