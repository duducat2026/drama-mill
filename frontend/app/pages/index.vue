<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/your-org/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <https://www.gnu.org/licenses/>.
-->

<template>
  <div class="page">
    <div class="launcher-hero">
      <div class="head-left">
        <p class="launcher-eyebrow"><span class="eyebrow-dot"></span>DRAMA MILL · 短剧生产线</p>
        <h1 class="launcher-title">项目启动台</h1>
        <p class="launcher-sub">从一个创意到一部短剧，AI 全流程为你代工</p>
        <div class="hero-stats">
          <span class="tag">{{ pagination.total }} 个项目</span>
          <span class="tag tag-success">{{ activeCount }} 进行中</span>
          <span v-if="failedCount" class="tag tag-error">{{ failedCount }} 失败</span>
          <span class="tag tag-accent">{{ stylePresets.length }} 种视觉风格</span>
        </div>
      </div>
      <div class="hero-actions">
        <button v-if="isAdmin" class="btn" @click="navigateTo('/admin/panel')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>
          </svg>
          管理后台
        </button>
        <button class="btn" @click="navigateTo('/novels')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
          </svg>
          文档库
        </button>
        <button class="btn" @click="showNovelWizard = true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          导入文档
        </button>
        <button class="btn" @click="showBatchPanel = true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          批量生产{{ runningBatchBadge ? ` (${runningBatchBadge})` : '' }}
        </button>
        <button class="btn btn-primary" @click="showCreate = true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          新建项目
        </button>
      </div>
    </div>

    <!-- 存储配额超额告警：用量超过生效配额时提醒用户清理或联系管理员调整 -->
    <div v-if="quota?.exceeded" class="quota-alert" role="alert">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
      </svg>
      <span>
        <b>存储空间已超额</b>：已用 {{ fmtQuotaSize(quota.used_bytes) }} / 配额 {{ fmtQuotaSize(quota.quota_bytes) }}（{{ quota.percent }}%）。
        请清理项目素材或联系管理员上调配额，否则新生成内容可能无法正常保存。
      </span>
    </div>

    <div class="toolbar">
      <label class="search-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input v-model.trim="searchKeyword" class="input" placeholder="搜索项目" />
      </label>
      <div class="chip-row">
        <button
          v-for="f in filters"
          :key="f.value"
          type="button"
          class="filter-chip"
          :class="{ on: statusFilter === f.value }"
          @click="statusFilter = f.value"
        >
          {{ f.label }}
        </button>
      </div>
      <select v-model="sortMode" class="input sort-select" aria-label="项目排序">
        <option value="updated">最近更新</option>
        <option value="title">项目名称</option>
      </select>
    </div>

    <div v-if="loading" class="project-grid">
      <div v-for="i in 6" :key="i" class="card skeleton-card">
        <div class="skeleton-cover"></div>
        <div class="skeleton-body">
          <div class="skeleton-line w-60"></div>
          <div class="skeleton-line w-40"></div>
        </div>
      </div>
    </div>

    <div v-else-if="filteredDramas.length" class="project-grid">
      <ProjectCard
        v-for="(d, i) in filteredDramas"
        :key="d.id"
        :drama="d"
        :index="i"
        :style-presets="stylePresets"
        @open="openDrama"
        @delete="d => dramaToDelete = d"
      />
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <line x1="12" y1="8" x2="12" y2="16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      </div>
      <p class="empty-title">{{ pagination.total ? '没有匹配的项目' : '新建第一个短剧项目' }}</p>
      <p class="empty-desc">{{ pagination.total ? '调整搜索词或筛选条件。' : '创建后选择集开始制作。' }}</p>
      <button v-if="!pagination.total" class="btn btn-primary" @click="showCreate = true">新建项目</button>
    </div>

    <div v-if="pagination.total_pages > 1" class="list-pager">
      <button class="btn btn-sm" :disabled="page <= 1" @click="gotoPage(page - 1)">上一页</button>
      <span class="pager-info">第 {{ page }} / {{ pagination.total_pages }} 页 · 共 {{ pagination.total }} 个</span>
      <button class="btn btn-sm" :disabled="page >= pagination.total_pages" @click="gotoPage(page + 1)">下一页</button>
    </div>

    <ProjectCreateDialog v-model:open="showCreate" :style-presets="stylePresets" />
    <ConfirmDialog
      :open="!!dramaToDelete"
      title="删除项目"
      :message="`确定删除「${dramaToDelete?.title}」？项目下的剧集、分镜与生成记录将一并删除，此操作不可恢复。`"
      :loading="deletingDrama"
      @confirm="confirmDelDrama"
      @cancel="dramaToDelete = null"
    />
    <NovelImportWizard
      v-if="showNovelWizard"
      @close="showNovelWizard = false"
      @created="load"
      @batch-created="showBatchPanel = true"
    />
    <BatchProductionPanel
      v-if="showBatchPanel"
      @close="showBatchPanel = false; loadBatches()"
    />
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { dramaAPI, stylePresetAPI, api, quotaAPI } from '~/composables/useApi'
import NovelImportWizard from '~/components/NovelImportWizard.vue'
import BatchProductionPanel from '~/components/BatchProductionPanel.vue'

const { user, isAdmin, fetchMe } = useAuth()
// 运行中批次徽标轮询（外提至 composable）
const { runningBatchBadge, loadBatches } = useBatchBadge()

const dramas = ref([])
const loading = ref(false)
const showCreate = ref(false)
const showNovelWizard = ref(false)
const showBatchPanel = ref(false)

// 服务端分页：列表瘦身后单条仅数百字节，20 条/页足够；总数与状态计数由后端提供
const PAGE_SIZE = 20
const page = ref(1)
const pagination = ref({ page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 0 })
const statsByStatus = ref({})
// 手动标记的 active 与生产编排写入的 producing 都算进行中；生产失败单独计数
const activeCount = computed(() => (statsByStatus.value.active || 0) + (statsByStatus.value.producing || 0))
const failedCount = computed(() => statsByStatus.value.failed || 0)

const searchKeyword = ref('')
const statusFilter = ref('all')
const sortMode = ref('updated')
const dramaToDelete = ref(null)
const deletingDrama = ref(false)
const stylePresets = ref([])
const filters = [
  { label: '全部', value: 'all' },
  { label: '待开始', value: 'draft' },
  { label: '进行中', value: 'active' },
  { label: '已完成', value: 'completed' },
]

// 搜索/筛选下推服务端（keyword 模糊标题、status 精确匹配）；排序保持客户端（页内）
const filteredDramas = computed(() => {
  return [...dramas.value].sort((a, b) => {
    if (sortMode.value === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
    return new Date(b.updated_at || b.updatedAt || 0).getTime() - new Date(a.updated_at || a.updatedAt || 0).getTime()
  })
})

async function load() {
  loading.value = true
  try {
    const keyword = searchKeyword.value.trim()
    const [res, presets, stats] = await Promise.all([
      // active 筛选需同时命中生产编排写入的 producing（逗号多值由后端 inArray 下推）
      dramaAPI.list({ page: page.value, page_size: PAGE_SIZE, status: statusFilter.value === 'all' ? undefined : (statusFilter.value === 'active' ? 'active,producing' : statusFilter.value), keyword: keyword || undefined }),
      stylePresetAPI.list(),
      api.get('/dramas/stats').catch(() => null),
    ])
    dramas.value = res.items || []
    pagination.value = res.pagination || { page: page.value, page_size: PAGE_SIZE, total: 0, total_pages: 0 }
    if (stats?.by_status) statsByStatus.value = Object.fromEntries(stats.by_status.map(s => [s.status, s.count]))
    stylePresets.value = presets || []
    loadBatches()
  } catch (e) {
    toast.error(e.message)
  } finally {
    loading.value = false
  }
}

function gotoPage(p) {
  if (p < 1 || p > pagination.value.total_pages) return
  page.value = p
  load()
}

// 搜索词/筛选变化回第一页重拉（搜索词防抖 300ms）
let searchTimer = null
watch(searchKeyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; load() }, 300)
})
watch(statusFilter, () => { page.value = 1; load() })

async function confirmDelDrama() {
  const d = dramaToDelete.value
  if (!d) return
  try {
    deletingDrama.value = true
    await dramaAPI.del(d.id)
    toast.success('已删除')
    dramaToDelete.value = null
    // 删除导致当前页只剩它一条且非首页时自动回退一页，避免落在空页
    if (dramas.value.length <= 1 && page.value > 1) page.value--
    load()
  } catch (e) {
    toast.error(e.message)
  } finally {
    deletingDrama.value = false
  }
}

function getDramaPath(d) {
  return `/drama/${d.id}`
}

function openDrama(d) {
  navigateTo(getDramaPath(d))
}

// 存储配额状态（超额时展示告警横幅）
const quota = ref(null)
function fmtQuotaSize(bytes) {
  if (bytes == null) return '-'
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

onMounted(async () => {
  // 登录守卫：未登录/凭证失效跳登录页；拉取当前用户（决定管理后台入口）
  const me = user.value || await fetchMe()
  if (!me) return navigateTo('/login')
  load()
  // 存储配额检查：超额时顶部告警（后端 60s 缓存，探测开销极低；失败静默不阻断首页）
  quotaAPI.status().then(q => { quota.value = q }).catch(() => {})
})
</script>

<style scoped src="assets/styles/launcher.css"></style>
