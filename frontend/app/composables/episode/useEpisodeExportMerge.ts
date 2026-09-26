/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { mergeAPI } from '~/composables/useApi'

export function useEpisodeExportMerge(wb: any) {
  const sbs = wb.sbs
  const hasVid = (...args: any[]) => wb.hasVid(...args)
  const epId = wb.epId
  const panel = wb.panel
  const activeMerge = wb.activeMerge
  const mergeData = wb.mergeData
  const sanitizeFileName = (...args: any[]) => wb.sanitizeFileName(...args)
  const drama = wb.drama
  const episodeNumber = wb.episodeNumber
  const selectedSb = wb.selectedSb
  const selectedVideoTaskNumber = wb.selectedVideoTaskNumber
  const mediaExt = (...args: any[]) => wb.mediaExt(...args)
  const episodeNamePart = (...args: any[]) => wb.episodeNamePart(...args)
  const episode = wb.episode
  const mergeUrl = wb.mergeUrl

const exportSelectedIds = ref([]) // 勾选的镜头 id
const exportMerges = ref([])      // 成片(拼接记录)列表
let exportSelTouched = false      // 用户手动操作过选择后,不再自动全选

const exportReadyIds = computed(() => sbs.value.filter(s => hasVid(s)).map(s => s.id))
const exportSelectedReadyIds = computed(() => exportSelectedIds.value.filter(id => exportReadyIds.value.includes(id)))

watch(exportReadyIds, (ids) => {
  if (exportSelTouched) {
    exportSelectedIds.value = exportSelectedIds.value.filter(id => ids.includes(id))
  } else {
    exportSelectedIds.value = [...ids]
  }
})

function isExportSelected(id) { return exportSelectedIds.value.includes(id) }
function toggleExportSelect(sb) {
  if (!hasVid(sb)) return
  exportSelTouched = true
  exportSelectedIds.value = isExportSelected(sb.id)
    ? exportSelectedIds.value.filter(x => x !== sb.id)
    : [...exportSelectedIds.value, sb.id]
}
function toggleSelectAllExport() {
  exportSelTouched = true
  exportSelectedIds.value = exportSelectedReadyIds.value.length === exportReadyIds.value.length ? [] : [...exportReadyIds.value]
}

async function loadExportMerges() {
  if (!epId.value) return
  try { exportMerges.value = await mergeAPI.list(epId.value) || [] } catch { /* 静默 */ }
}

// 拼接状态链式轮询的定时器（卸载时取消）
let mergePollTimer = null
function stopMergeStatusPolling() {
  if (mergePollTimer) { clearTimeout(mergePollTimer); mergePollTimer = null }
}

// 成片列表仅在导出面板展示：进导出 tab 时才拉，不在初始化预取
watch(panel, p => { if (p === 'export') loadExportMerges() })

// 删除成片：软删记录 + 物理移除文件，删除后同步刷新列表与当前集播放状态
const mergeToDelete = ref(null)
const mergeDeleteLoading = ref(false)

function askDeleteMerge(m) {
  mergeToDelete.value = m
}

async function confirmDeleteMerge() {
  const m = mergeToDelete.value
  if (!m || mergeDeleteLoading.value) return
  mergeDeleteLoading.value = true
  try {
    await mergeAPI.remove(epId.value, m.id)
    toast.success('已删除成片')
    if (activeMerge.value?.id === m.id) activeMerge.value = null
    mergeToDelete.value = null
    await loadExportMerges()
    // 当前集若以被删成片为播放源，刷新后由后端返回的最新未删除记录接管（可能为 null）
    try { mergeData.value = await mergeAPI.status(epId.value) } catch {}
  } catch (e) {
    toast.error(e.message || '删除失败')
  } finally {
    mergeDeleteLoading.value = false
  }
}

const dramaNamePart = computed(() => sanitizeFileName(drama.value?.title) || '未命名剧集')
const episodeNoPart = computed(() => `第${episodeNumber.value}集`)
// 分镜视频：与播放器标题同一序号（无分镜号时回退任务序号）
function shotFileName(url) {
  const n = selectedSb.value?.storyboard_number ?? selectedSb.value?.storyboardNumber ?? selectedVideoTaskNumber.value
  return [dramaNamePart.value, episodeNoPart.value, `分镜${n}`].join('-') + '.' + mediaExt(url)
}
// video_merges.title 是后端写入的记录字段，历史数据为内部占位串「Episode {主键} Merge」（37 是 episodes.id，非集号），
// 不得进入文件名：以本集标题为准，仅在本集标题缺失时用可信快照兜底
const MERGE_TITLE_PLACEHOLDER = /^Episode\s*\d+\s*Merge$/i
function mergeTitlePart(m) {
  const current = episodeNamePart(episode.value?.title)
  if (current) return current
  const snapshot = String(m?.title || '').trim()
  return MERGE_TITLE_PLACEHOLDER.test(snapshot) ? '' : episodeNamePart(snapshot)
}
// 成片：同一集的多份历史成片同名，浏览器自动追加 (1)(2) 后缀
function mergeFileName(m) {
  const parts = [dramaNamePart.value, episodeNoPart.value, mergeTitlePart(m)]
  return parts.filter(Boolean).join('-') + '.' + mediaExt(m?.merged_url || mergeUrl.value)
}

async function doMerge(ids) {
  const storyboardIds = Array.isArray(ids) ? ids : undefined
  if (storyboardIds && !storyboardIds.length) {
    toast.error('请先勾选至少一个已生成视频的镜头')
    return
  }
  try {
    await mergeAPI.merge(epId.value, storyboardIds)
    toast.success('拼接中...')
  } catch (e) {
    toast.error(e.message || '拼接失败')
    return
  }
  // 拼接状态链式轮询：请求完成后再排 3s，离开页面卸载时取消（原 setInterval 存在泄漏与后台叠加请求）
  stopMergeStatusPolling()
  mergePollTimer = setTimeout(tickMergeStatus, 3000)
  async function tickMergeStatus() {
    mergePollTimer = null
    try { mergeData.value = await mergeAPI.status(epId.value) } catch {}
    const st = mergeData.value?.status
    if (st === 'completed' || st === 'failed') {
      if (st === 'completed') {
        toast.success('拼接完成')
        loadExportMerges()
      } else {
        toast.error(mergeData.value?.error_msg || mergeData.value?.errorMsg || '拼接失败')
      }
      return
    }
    mergePollTimer = setTimeout(tickMergeStatus, 3000)
  }
}
  return {
    exportSelectedIds, exportMerges, exportSelTouched, exportReadyIds, exportSelectedReadyIds, isExportSelected, toggleExportSelect, toggleSelectAllExport, loadExportMerges, mergePollTimer, stopMergeStatusPolling, mergeToDelete, mergeDeleteLoading, askDeleteMerge, confirmDeleteMerge, dramaNamePart, episodeNoPart, shotFileName, MERGE_TITLE_PLACEHOLDER, mergeTitlePart, mergeFileName, doMerge,
  }
}
