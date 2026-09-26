/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { taskAPI } from '~/composables/useApi'

export function useEpisodeGenTasks(wb: any) {
  const retryingTaskIds = wb.retryingTaskIds
  const refresh = (...args: any[]) => wb.refresh(...args)
  const restorePendingImageTasks = (...args: any[]) => wb.restorePendingImageTasks(...args)
  const epId = wb.epId
  const genTaskQueue = wb.genTaskQueue
  const hasVid = (...args: any[]) => wb.hasVid(...args)
  const sbs = wb.sbs
  const pendingVideoIds = wb.pendingVideoIds
  const failedVideoMessages = wb.failedVideoMessages
  const chars = wb.chars
  const scenes = wb.scenes
  const propItems = wb.propItems

const genTasks = ref([])
const genMerges = ref([])
const taskDrawer = ref(false)
let genTasksTimer = null
const GEN_TASK_PAGE_SIZE = 20
const genTaskPage = ref(1)
const genTaskPagination = ref({ page: 1, page_size: GEN_TASK_PAGE_SIZE, total: 0, total_pages: 0 })

function openTaskDrawer() {
  taskDrawer.value = true
  loadGenTasks()
}
function closeTaskDrawer() {
  taskDrawer.value = false
}
// 任务抽屉重试：失败任务重新入队执行（复用原参数），图片任务同步恢复「生成中」状态并按任务态跟踪
async function retryGenTask(row) {
  if (!row?.id || retryingTaskIds.value.includes(row.id)) return
  retryingTaskIds.value.push(row.id)
  try {
    await taskAPI.retry(row.id)
    toast.success('任务已重新提交，进入生成队列')
    await Promise.all([loadGenTasks(), refresh()])
    if (row.kind === 'image') restorePendingImageTasks()
  } catch (e) {
    toast.error(e.message)
  } finally {
    retryingTaskIds.value = retryingTaskIds.value.filter(x => x !== row.id)
  }
}
// Seedance 2.0 视频生成面板：仅多模态参考（参考图 0-9 + 参考视频 0-3 + 参考音频 0-3 + 可选文本）
async function loadGenTasks(page = 1) {
  if (!epId.value) return
  try {
    taskAPI.queue().then(q => { if (q) genTaskQueue.value = q }).catch(() => {})
    // 单次拉取大页（200），用于抽屉分页展示 + 状态恢复，避免双调用双查询
    const data = await taskAPI.listByEpisode(epId.value, { page, page_size: 200 })
    genTaskPage.value = data?.pagination?.page || page
    // 抽屉分页：从大页结果中取前 GEN_TASK_PAGE_SIZE 条
    const allTasks = data?.tasks || []
    genTaskPagination.value = data?.pagination || { page, page_size: GEN_TASK_PAGE_SIZE, total: 0, total_pages: 0 }
    genTasks.value = allTasks.slice(0, GEN_TASK_PAGE_SIZE)
    genMerges.value = data?.merges || []

    // 生成中/失败状态只存在内存里,页面刷新后丢失;从 sys_task 记录按分镜恢复,
    // 否则已失败的镜头刷新后会退化成"待生成"；复用已拉取的大页结果，不再二次请求
    const videoTasks = allTasks.filter(t => t.type === 'video' && t.storyboard_id)
    // 每个分镜只取最新一条任务(created_at 降序、id 兜底),旧任务不干预当前状态
    const latestBySb = new Map()
    for (const t of videoTasks) {
      const prev = latestBySb.get(t.storyboard_id)
      if (!prev
        || String(t.created_at || '') > String(prev.created_at || '')
        || (String(t.created_at || '') === String(prev.created_at || '') && t.id > prev.id)) {
        latestBySb.set(t.storyboard_id, t)
      }
    }
    // pending/failed 全量重建而非与现有值并集——否则刷新恢复的"生成中"在任务失败后
    // 永不消退(videoTaskState 中 pending 优先于 failed,重试按钮还被禁用)
    const pending = new Set()
    const failed = {}
    for (const [sbId, t] of latestBySb) {
      // 分镜已有视频(失败后重试成功)时不再报历史错误
      if (hasVid(sbs.value.find(s => s.id === sbId))) continue
      if (t.status === 'processing') pending.add(sbId)
      else if (t.status === 'failed') failed[sbId] = t.error_msg || '生成失败'
    }
    // 刚点击提交、任务记录尚未加载出来的本地状态保留,避免状态闪退
    for (const id of pendingVideoIds.value) if (!latestBySb.has(id)) pending.add(id)
    for (const id of Object.keys(failedVideoMessages.value)) {
      if (!latestBySb.has(Number(id))) failed[id] = failedVideoMessages.value[id]
    }
    pendingVideoIds.value = [...pending]
    failedVideoMessages.value = failed
  } catch { /* 静默失败,不打断其他刷新 */ }
}

function stopGenTasksPolling() {
  if (genTasksTimer) { clearTimeout(genTasksTimer); genTasksTimer = null }
}

const genTaskActiveCount = computed(() =>
  genTasks.value.filter(t => t.status === 'processing').length +
  genMerges.value.filter(m => m.status === 'processing' || m.status === 'pending').length
)
const genTaskDoneCount = computed(() =>
  genTasks.value.filter(t => t.status === 'completed').length +
  genMerges.value.filter(m => m.status === 'completed').length
)
const genTaskFailedCount = computed(() =>
  genTasks.value.filter(t => t.status === 'failed').length +
  genMerges.value.filter(m => m.status === 'failed').length
)

function genTaskTargetLabel(t) {
  if (t.storyboard_id) {
    const sb = sbs.value.find(x => x.id === t.storyboard_id)
    return `分镜 #${sb?.storyboard_number ?? sb?.storyboardNumber ?? t.storyboard_id}`
  }
  if (t.character_id) {
    const c = chars.value.find(x => x.id === t.character_id)
    return `角色 · ${c?.name || t.character_id}`
  }
  if (t.scene_id) {
    const s = scenes.value.find(x => x.id === t.scene_id)
    return `场景 · ${s?.location || t.scene_id}`
  }
  if (t.prop_id) {
    const p = propItems.value.find(x => x.id === t.prop_id)
    return `道具 · ${p?.name || t.prop_id}`
  }
  return '通用'
}

// 统一行结构：image / video / merge 三类合并按时间倒序
const genTaskRows = computed(() => {
  const taskRows = genTasks.value.map(t => ({
    key: `task-${t.id}`,
    kind: t.type, // image | video
    id: t.id,
    targetLabel: genTaskTargetLabel(t),
    provider: t.provider || '',
    model: t.model || '',
    status: t.status || 'processing',
    errorMsg: t.error_msg || '',
    previewUrl: t.local_path || t.result_url || '',
    prompt: t.prompt || '',
    createdAt: t.created_at || '',
    completedAt: t.completed_at || '',
  }))
  const mergeRows = genMerges.value.map(m => ({
    key: `merge-${m.id}`,
    kind: 'merge',
    id: m.id,
    targetLabel: '整集拼接',
    provider: m.provider || 'ffmpeg',
    model: m.model || '',
    status: m.status || 'pending',
    errorMsg: m.error_msg || '',
    previewUrl: m.merged_url || '',
    prompt: '',
    createdAt: m.created_at || '',
    completedAt: m.completed_at || '',
  }))
  return [...taskRows, ...mergeRows].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
})

function genTaskKindLabel(kind) {
  return kind === 'image' ? '图片' : kind === 'video' ? '视频' : '合并'
}

function genTaskStatusLabel(status) {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  return '生成中'
}

// 映射到现有 video-task-status 的样式类:is-done / is-pending / is-failed
function genTaskStateClass(status) {
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'
  return 'pending'
}

// local_path 为站内相对路径补 '/',远端 result_url 原样使用
function genTaskPreviewSrc(url) {
  if (!url) return ''
  return /^https?:\/\//.test(url) ? url : '/' + url
}

function genTaskDuration(row) {
  if (!row.createdAt || !row.completedAt) return ''
  const ms = new Date(row.completedAt).getTime() - new Date(row.createdAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  return ms >= 60000 ? `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 1000)}s`
}

// 抽屉打开且有进行中任务时轮询;关闭或全部结束时停止
// 请求完成后再排程（避免固定 setInterval 在慢请求下叠加），页面隐藏时暂停拉取、回前台自动恢复
watch([taskDrawer, genTaskActiveCount], ([open, active]) => {
  stopGenTasksPolling()
  if (open && active > 0) scheduleGenTasksPoll()
})
function scheduleGenTasksPoll() {
  genTasksTimer = setTimeout(async () => {
    if (typeof document !== 'undefined' && document.hidden) { scheduleGenTasksPoll(); return }
    await loadGenTasks()
    if (taskDrawer.value && genTaskActiveCount.value > 0) scheduleGenTasksPoll()
  }, 4000)
}

  return {
    genTasks, genMerges, taskDrawer, genTasksTimer, GEN_TASK_PAGE_SIZE, genTaskPage, genTaskPagination, openTaskDrawer, closeTaskDrawer, retryGenTask, loadGenTasks, stopGenTasksPolling, genTaskActiveCount, genTaskDoneCount, genTaskFailedCount, genTaskTargetLabel, genTaskRows, genTaskKindLabel, genTaskStatusLabel, genTaskStateClass, genTaskPreviewSrc, genTaskDuration, scheduleGenTasksPoll,
  }
}
