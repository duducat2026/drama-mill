<!--
  Drama Mill — AI 短剧生成平台
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<!--
  项目启动台 — 用户登录后的首页
  职责：展示项目列表 + 搜索/筛选/分页 + 新建/删除入口 + 存储配额告警 + 批量生产徽标
  样式外置至 assets/styles/launcher.css
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
          <LayoutDashboard :size="14" :stroke-width="1.9" />
          管理后台
        </button>
        <button class="btn" @click="navigateTo('/novels')">
          <BookOpen :size="14" :stroke-width="1.9" />
          文档库
        </button>
        <button class="btn" @click="showNovelWizard = true">
          <FilePlus :size="14" :stroke-width="1.9" />
          导入文档
        </button>
        <button class="btn" @click="showBatchPanel = true">
          <ListChecks :size="14" :stroke-width="1.9" />
          批量生产{{ runningBatchBadge ? ` (${runningBatchBadge})` : '' }}
        </button>
        <button class="btn btn-primary" @click="showCreate = true">
          <Plus :size="14" :stroke-width="2.2" />
          新建项目
        </button>
      </div>
    </div>

    <!-- 存储配额超额告警：用量超过生效配额时提醒用户清理或联系管理员调整 -->
    <div v-if="quota?.exceeded" class="quota-alert" role="alert">
      <TriangleAlert :size="15" :stroke-width="2" />
      <span>
        <b>存储空间已超额</b>：已用 {{ fmtQuotaSize(quota.used_bytes) }} / 配额 {{ fmtQuotaSize(quota.quota_bytes) }}（{{ quota.percent }}%）。
        请清理项目素材或联系管理员上调配额，否则新生成内容可能无法正常保存。
      </span>
    </div>

    <div class="toolbar">
      <label class="search-box">
        <Search :size="15" :stroke-width="1.8" />
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

    <div v-if="isLoading" class="project-grid">
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
        <FolderPlus :size="28" :stroke-width="1.3" />
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
      @created="fetchProjects"
      @batch-created="showBatchPanel = true"
    />
    <BatchProductionPanel
      v-if="showBatchPanel"
      @close="showBatchPanel = false; loadBatches()"
    />
  </div>
</template>

<script setup>
import { BookOpen, FilePlus, FolderPlus, LayoutDashboard, ListChecks, Plus, Search, TriangleAlert } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { dramaAPI, stylePresetAPI, api, quotaAPI } from '~/composables/useApi'
import NovelImportWizard from '~/components/NovelImportWizard.vue'
import BatchProductionPanel from '~/components/BatchProductionPanel.vue'

const { user, isAdmin, fetchMe } = useAuth()
// 运行中批次徽标轮询（抽取为独立 composable）
const { runningBatchBadge, loadBatches } = useBatchBadge()

const projectList = ref([])
const isLoading = ref(false)
const showCreate = ref(false)
const showNovelWizard = ref(false)
const showBatchPanel = ref(false)

// 服务端分页：卡片列表轻量，每页 20 条即可覆盖首屏；总量与状态计数由后端返回
const PAGE_SIZE = 20
const page = ref(1)
const pagination = ref({ page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 0 })
const statusCounts = ref({})
// active + producing 均属“进行中”状态；失败单独统计
const activeCount = computed(() => (statusCounts.value.active || 0) + (statusCounts.value.producing || 0))
const failedCount = computed(() => statusCounts.value.failed || 0)

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

// 搜索/筛选下推服务端（keyword 模糊标题、status 精确匹配）；排序在客户端就地完成（页内）
const filteredDramas = computed(() => {
  return [...projectList.value].sort((a, b) => {
    if (sortMode.value === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
    return new Date(b.updated_at || b.updatedAt || 0).getTime() - new Date(a.updated_at || a.updatedAt || 0).getTime()
  })
})

async function fetchProjects() {
  isLoading.value = true
  try {
    const kw = searchKeyword.value.trim()
    const [listRes, presets, statsRaw] = await Promise.all([
      // active 筛选包含 producing 状态（后端 inArray 逗号多值下推）
      dramaAPI.list({ page: page.value, page_size: PAGE_SIZE, status: statusFilter.value === 'all' ? undefined : (statusFilter.value === 'active' ? 'active,producing' : statusFilter.value), keyword: kw || undefined }),
      stylePresetAPI.list(),
      api.get('/dramas/stats').catch(() => null),
    ])
    projectList.value = listRes.items || []
    pagination.value = listRes.pagination || { page: page.value, page_size: PAGE_SIZE, total: 0, total_pages: 0 }
    if (statsRaw?.by_status) statusCounts.value = Object.fromEntries(statsRaw.by_status.map(s => [s.status, s.count]))
    stylePresets.value = presets || []
    loadBatches()
  } catch (e) {
    toast.error(e.message)
  } finally {
    isLoading.value = false
  }
}

function gotoPage(p) {
  if (p < 1 || p > pagination.value.total_pages) return
  page.value = p
  fetchProjects()
}

// 搜索词/筛选变化重置到第一页并重新加载（搜索词 300ms 防抖）
let searchDebounce = null
watch(searchKeyword, () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => { page.value = 1; fetchProjects() }, 300)
})
watch(statusFilter, () => { page.value = 1; fetchProjects() })

async function confirmDelDrama() {
  const target = dramaToDelete.value
  if (!target) return
  try {
    deletingDrama.value = true
    await dramaAPI.del(target.id)
    toast.success('已删除')
    dramaToDelete.value = null
    // 当前页只剩这一条且非首页时自动回退一页，避免空屏
    if (projectList.value.length <= 1 && page.value > 1) page.value--
    fetchProjects()
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

// 存储配额信息（超额时展示告警横幅）
const quota = ref(null)
function fmtQuotaSize(bytes) {
  if (bytes == null) return '-'
  const tiers = ['KB', 'MB', 'GB', 'TB']
  let val = bytes / 1024
  let idx = 0
  while (val >= 1024 && idx < tiers.length - 1) { val /= 1024; idx++ }
  return `${val >= 100 ? val.toFixed(0) : val.toFixed(1)} ${tiers[idx]}`
}

onMounted(async () => {
  // 登录守卫：未登录或凭证失效则跳转登录页；拉取当前用户信息（决定管理后台入口可见性）
  const me = user.value || await fetchMe()
  if (!me) return navigateTo('/login')
  fetchProjects()
  // 存储配额检测：超额时顶部挂横幅（后端 60s 缓存、探测代价极低；失败静默不阻断首页）
  quotaAPI.status().then(q => { quota.value = q }).catch(() => {})
})
</script>

<style scoped src="assets/styles/launcher.css"></style>
