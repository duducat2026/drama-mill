/*
 * novels.vue 文档库页面逻辑 composable（拆分超限文件）：
 * 承载列表/服务端分页/多选/搜索/导入/预览/编辑/删除/批量删除/生成项目列表/拆分模版与风格加载，
 * 「批量创建项目」与「文档拆分」两个弹窗内聚到各自子组件，本 composable 仅协调其开关与刷新。
 */
import { toast } from 'vue-sonner'
import { novelAPI, novelSplitTemplateAPI, stylePresetAPI } from '~/composables/useApi'

export function useNovelsLibrary() {
  const { user, fetchMe } = useAuth()

  const keyword = ref('')
  const novels = ref([])
  const loadingNovels = ref(false)
  const selected = ref(new Set())
  const templates = ref([])
  const stylePresets = ref([])

  // 服务端分页：过滤下推 SQL（COUNT + LIMIT/OFFSET），列表不带正文列
  const PAGE_SIZE_OPTIONS = [
    { label: '20 条/页', value: 20 },
    { label: '50 条/页', value: 50 },
    { label: '100 条/页', value: 100 },
  ]
  const pageSize = ref(20)
  const page = ref(1)
  const pagination = ref({ page: 1, page_size: 20, total: 0, total_pages: 0 })

  // 翻页器页码列表：total_pages≤7 全显示；否则首尾+当前±1，中间用 '...' 省略
  const pageList = computed(() => {
    const tp = pagination.value.total_pages
    const cur = page.value
    if (tp <= 7) return Array.from({ length: tp }, (_, i) => i + 1)
    const pages = [1]
    const start = Math.max(2, cur - 1)
    const end = Math.min(tp - 1, cur + 1)
    if (start > 2) pages.push('...')
    for (let i = start; i <= end; i++) pages.push(i)
    if (end < tp - 1) pages.push('...')
    pages.push(tp)
    return pages
  })

  // ─── 小说列表 ─────────────────────────────────────────

  async function loadNovels() {
    loadingNovels.value = true
    try {
      const res = await novelAPI.list({ keyword: keyword.value || undefined, page: page.value, page_size: pageSize.value })
      novels.value = res.items || []
      pagination.value = res.pagination || { page: page.value, page_size: pageSize.value, total: 0, total_pages: 0 }
      // 清理已不存在的选中项（选中仅针对当前页）
      const ids = new Set(novels.value.map(n => n.id))
      selected.value = new Set([...selected.value].filter(id => ids.has(id)))
    } catch (e) {
      toast.error(e.message)
    } finally {
      loadingNovels.value = false
    }
  }

  function gotoPage(p) {
    if (p < 1 || p > pagination.value.total_pages || p === page.value) return
    page.value = p
    loadNovels()
  }
  function changePageSize() {
    page.value = 1
    loadNovels()
  }

  let searchTimer = null
  watch(keyword, () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { page.value = 1; loadNovels() }, 300)
  })

  const allSelected = computed(() => novels.value.length > 0 && selected.value.size === novels.value.length)
  function toggleAll(e) {
    selected.value = e.target.checked ? new Set(novels.value.map(n => n.id)) : new Set()
  }
  function toggleOne(id) {
    const next = new Set(selected.value)
    next.has(id) ? next.delete(id) : next.add(id)
    selected.value = next
  }

  const SPLIT_LABELS = { uploaded: '待拆分', splitting: '拆分中', split: '已拆分', failed: '拆分失败' }
  function splitLabel(n) { return SPLIT_LABELS[n.split_status] || n.split_status || '待拆分' }
  function splitTagClass(n) {
    return n.split_status === 'split' ? 'tag-success' : n.split_status === 'splitting' ? 'tag-accent' : n.split_status === 'failed' ? 'tag-error' : ''
  }

  function fmtDate(s) {
    if (!s) return ''
    const d = new Date(s)
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  // ─── 导入（入文档库，不建项目）─────────────────────────

  const importInputEl = ref(null)
  const importing = ref(false)
  function pickImportFiles() { importInputEl.value?.click() }
  async function onImportFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || importing.value) return
    importing.value = true
    let ok = 0
    const errs = []
    for (const f of files) {
      try {
        await novelAPI.upload(f)
        ok++
      } catch (err) {
        errs.push(`${f.name}（${err.message}）`)
      }
    }
    importing.value = false
    if (ok) toast.success(`已导入 ${ok} 部小说入库`)
    if (errs.length) toast.error(`导入失败：${errs.join('；')}`)
    loadNovels()
  }

  // ─── 预览 ────────────────────────────────────────────

  const preview = ref(null)
  async function openPreview(n) {
    try {
      preview.value = await novelAPI.content(n.id)
    } catch (e) {
      toast.error(e.message)
    }
  }

  // ─── 编辑 ────────────────────────────────────────────

  const editing = ref(null)
  const savingEdit = ref(false)
  async function openEdit(n) {
    try {
      const full = await novelAPI.content(n.id)
      editing.value = { id: n.id, title: full.title, content: full.content }
    } catch (e) {
      toast.error(e.message)
    }
  }
  async function saveEdit() {
    savingEdit.value = true
    try {
      await novelAPI.update(editing.value.id, { title: editing.value.title, content: editing.value.content })
      toast.success('已保存')
      editing.value = null
      loadNovels()
    } catch (e) {
      toast.error(e.message)
    } finally {
      savingEdit.value = false
    }
  }

  // ─── 删除 / 批量删除 ──────────────────────────────────

  const novelToDelete = ref(null)
  const showBatchDelete = ref(false)
  const deleting = ref(false)
  async function confirmDelete() {
    const n = novelToDelete.value
    if (!n) return
    deleting.value = true
    try {
      await novelAPI.del(n.id)
      toast.success('已删除')
      novelToDelete.value = null
      // 删除导致当前页只剩它一条且非首页时自动回退一页，避免落在空页
      if (novels.value.length <= 1 && page.value > 1) page.value--
      loadNovels()
    } catch (e) {
      toast.error(e.message)
    } finally {
      deleting.value = false
    }
  }
  async function confirmBatchDelete() {
    deleting.value = true
    try {
      const res = await novelAPI.batchDelete([...selected.value])
      toast.success(`已删除 ${res.deleted} 部文档`)
      showBatchDelete.value = false
      // 本页全部被删且非首页时回退一页，避免落在空页
      if (selected.value.size >= novels.value.length && page.value > 1) page.value--
      selected.value = new Set()
      loadNovels()
    } catch (e) {
      toast.error(e.message)
    } finally {
      deleting.value = false
    }
  }

  // ─── 小说生成的项目 ────────────────────────────────────

  const dramasModal = ref(null)
  async function openDramas(n) {
    try {
      const list = await novelAPI.dramas(n.id)
      dramasModal.value = { title: n.title, list: list || [] }
    } catch (e) {
      toast.error(e.message)
    }
  }

  // ─── 弹窗协调（批量创建项目 / 文档拆分 / 批量生产面板）───

  const showBatchPanel = ref(false)
  const showCreateProjects = ref(false)
  const preSplitNovel = ref(null)

  function openCreateProjects() {
    if (!selected.value.size) return
    showCreateProjects.value = true
  }
  function onProjectsSubmitted() {
    showCreateProjects.value = false
    selected.value = new Set()
    showBatchPanel.value = true
    loadNovels()
  }
  function openPreSplit(n) { preSplitNovel.value = n }
  function onPreSplitDone() {
    preSplitNovel.value = null
    page.value = 1
    loadNovels()
  }

  // ─── 拆分提示词模版（供拆分弹窗与创建项目使用，管理移至 /novel-templates）───

  async function loadTemplates() {
    try {
      templates.value = await novelSplitTemplateAPI.list(true)
    } catch {}
  }

  // ─── 初始化 ────────────────────────────────────────────

  onMounted(async () => {
    const me = user.value || await fetchMe()
    if (!me) return navigateTo('/login')
    loadNovels()
    loadTemplates()
    stylePresetAPI.list().then(p => { stylePresets.value = p || [] }).catch(() => {})
  })

  return {
    keyword, novels, loadingNovels, selected, templates, stylePresets,
    PAGE_SIZE_OPTIONS, pageSize, page, pagination, pageList,
    loadNovels, gotoPage, changePageSize, allSelected, toggleAll, toggleOne,
    splitLabel, splitTagClass, fmtDate,
    importInputEl, pickImportFiles, onImportFiles,
    preview, openPreview,
    editing, savingEdit, openEdit, saveEdit,
    novelToDelete, showBatchDelete, deleting, confirmDelete, confirmBatchDelete,
    dramasModal, openDramas,
    showBatchPanel, showCreateProjects, preSplitNovel,
    openCreateProjects, onProjectsSubmitted, openPreSplit, onPreSplitDone,
  }
}
