<!--
  Drama Mill — AI 短剧生成平台
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<!--
  ProjectCard.vue — 项目启动台（index.vue）单张项目卡片，由超限文件拆分外提。
  自持状态：卡片菜单/状态快切菜单 + 手动标记项目状态；点击/删除经事件回传父页。
  样式：卡片内部样式必须随组件 scoped 挂载（父页 scoped 不穿透子组件内部元素）。
-->
<template>
  <article
    class="card project-card"
    :style="{ animationDelay: `${index * 0.04}s` }"
    tabindex="0"
    role="button"
    :aria-label="`打开项目 ${drama.title}`"
    @click="emit('open', drama)"
    @keydown.enter.prevent="emit('open', drama)"
    @keydown.space.prevent="emit('open', drama)"
  >
    <div class="project-thumb" aria-hidden="true">
      <Film :size="34" :stroke-width="1.4" />
      <div class="status-wrap" @click.stop>
        <button type="button" class="cover-badge tag status-badge" title="点击标记项目状态" @click="statusMenuId = statusMenuId === drama.id ? null : drama.id">
          <span class="status-dot" :class="statusDotClass(drama)"></span>
          {{ projectStatus(drama) }}
        </button>
        <div v-if="statusMenuId === drama.id" class="more-menu status-menu">
          <button
            v-for="s in statusOptions"
            :key="s.value"
            type="button"
            class="menu-item"
            :class="{ on: currentStatus(drama) === s.value }"
            @click="setDramaStatus(drama, s.value)"
          >{{ s.label }}</button>
        </div>
      </div>
      <div class="more-wrap">
        <button class="btn btn-icon btn-sm cover-more" type="button" title="更多" @click.stop="toggleMenu(drama.id)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>
          </svg>
        </button>
        <div v-if="activeMenuId === drama.id" class="more-menu" @click.stop>
          <button type="button" class="menu-item" @click="activeMenuId = null; emit('open', drama)">打开项目</button>
          <button type="button" class="menu-item is-danger" @click="activeMenuId = null; emit('delete', drama)">删除项目</button>
        </div>
      </div>
    </div>
    <div class="project-body">
      <h2 class="project-name truncate">{{ drama.title }}</h2>
      <div class="project-meta">
        <span v-if="drama.style" class="tag tag-accent">{{ styleLabel(drama.style) }}</span>
        <span>{{ drama.character_count || 0 }} 角色 · {{ drama.scene_count || 0 }} 场景 · {{ drama.episode_count || 0 }} 集</span>
      </div>
      <div class="project-foot">
        <span class="updated">
          <Clock :size="11" :stroke-width="1.8" />
          {{ fmtDate(drama.updated_at || drama.updatedAt) }}
        </span>
        <span v-if="drama.aspect_ratio" class="ratio-chip">{{ drama.aspect_ratio }}</span>
        <span class="open-hint" aria-hidden="true">打开项目
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </span>
      </div>
    </div>
  </article>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { Film, Clock } from 'lucide-vue-next'
import { dramaAPI } from '~/composables/useApi'

const props = defineProps({
  drama: { type: Object, required: true },
  index: { type: Number, default: 0 },
  stylePresets: { type: Array, default: () => [] },
})
const emit = defineEmits(['open', 'delete'])

const activeMenuId = ref(null)
const statusMenuId = ref(null)

// 项目状态由用户手动标记（持久化到 dramas.status），不再按内容自动推算；
// producing/failed 由生产编排自动写入，展示时并入进行中/失败
const statusOptions = [
  { label: '待开始', value: 'draft' },
  { label: '进行中', value: 'active' },
  { label: '已完成', value: 'completed' },
]
const statusLabels = {
  ...Object.fromEntries(statusOptions.map(s => [s.value, s.label])),
  producing: '生产中',
  failed: '生产失败',
}

function currentStatus(d) { return d.status || 'draft' }
function projectStatus(d) { return statusLabels[currentStatus(d)] || '待开始' }
function statusDotClass(d) {
  const s = currentStatus(d)
  return (s === 'active' || s === 'producing') ? 'on' : s === 'completed' ? 'done' : s === 'failed' ? 'err' : ''
}

async function setDramaStatus(d, status) {
  statusMenuId.value = null
  if (currentStatus(d) === status) return
  const prev = d.status
  d.status = status
  try {
    await dramaAPI.update(d.id, { status })
  } catch (e) {
    d.status = prev
    toast.error(e.message)
  }
}

function styleLabel(key) {
  return props.stylePresets.find(p => p.value === key)?.name || key || ''
}

function toggleMenu(id) {
  activeMenuId.value = activeMenuId.value === id ? null : id
}

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
</script>

<style scoped src="assets/styles/project-card.css"></style>
