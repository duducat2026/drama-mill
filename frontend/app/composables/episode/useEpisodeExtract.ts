/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { episodeAPI } from '~/composables/useApi'

export function useEpisodeExtract(wb: any) {
  const epId = wb.epId
  const saveScr = (...args: any[]) => wb.saveScr(...args)
  const chatModelOverride = (...args: any[]) => wb.chatModelOverride(...args)
  const chatConfigId = (...args: any[]) => wb.chatConfigId(...args)
  const refresh = (...args: any[]) => wb.refresh(...args)
  const videoPromptBatch = wb.videoPromptBatch
  const vpTaskListOpen = wb.vpTaskListOpen
  const pollVideoPromptBatch = (...args: any[]) => wb.pollVideoPromptBatch(...args)

const EXTRACT_TARGETS = [
  { key: 'characters', label: '角色' },
  { key: 'scenes', label: '场景' },
  { key: 'props', label: '道具' },
]
const extractingTargets = ref([])
// 提取失败原因追踪：{ characters: null|string, scenes: null|string, props: null|string }
const extractErrors = ref({})
const extractFailedCount = computed(() => Object.values(extractErrors.value).filter(Boolean).length)
const extractingLabels = computed(() => EXTRACT_TARGETS.filter(t => extractingTargets.value.includes(t.key)).map(t => t.label).join('、'))
function isExtracting(target) { return extractingTargets.value.includes(target) }
function isExtractFailed(target) { return !!extractErrors.value[target] }

function doExtract(target) {
  if (isExtracting(target) || !epId.value) return
  saveScr()
  extractErrors.value = { ...extractErrors.value, [target]: null }
  extractingTargets.value.push(target)
  episodeAPI.extract(epId.value, target, chatModelOverride(), chatConfigId())
    .then(() => pollExtractStatus(target))
    .catch(e => {
      extractingTargets.value = extractingTargets.value.filter(t => t !== target)
      extractErrors.value = { ...extractErrors.value, [target]: e.message }
      toast.error(e.message)
    })
}
function doExtractAll() { EXTRACT_TARGETS.forEach(t => doExtract(t.key)) }

// 重试失败的资产提取：将失败原因作为反馈传给 Agent 优化重新提取
function doRetryExtract(target) {
  if (isExtracting(target) || !epId.value) return
  extractingTargets.value.push(target)
  extractErrors.value = { ...extractErrors.value, [target]: null }
  episodeAPI.retryExtract(epId.value, target, chatModelOverride(), chatConfigId())
    .then(() => pollExtractStatus(target))
    .catch(e => {
      extractingTargets.value = extractingTargets.value.filter(t => t !== target)
      extractErrors.value = { ...extractErrors.value, [target]: e.message }
      toast.error(e.message)
    })
}

function pollExtractStatus(target, attempts = 150) {
  const label = EXTRACT_TARGETS.find(t => t.key === target)?.label || target
  const tick = async (left) => {
    try {
      const st = await episodeAPI.extractStatus(epId.value)
      const task = st?.[target]
      if (task && task.status !== 'running') {
        extractingTargets.value = extractingTargets.value.filter(t => t !== target)
        if (task.status === 'done') {
          extractErrors.value = { ...extractErrors.value, [target]: null }
          toast.success(`${label}提取完成`)
          await refresh()
        } else {
          extractErrors.value = { ...extractErrors.value, [target]: task.error || `${label}提取失败` }
          toast.error(task.error || `${label}提取失败`)
        }
        return
      }
    } catch {}
    if (left > 0) setTimeout(() => tick(left - 1), 2500)
    else extractingTargets.value = extractingTargets.value.filter(t => t !== target)
  }
  setTimeout(() => tick(attempts), 2500)
}

/** 页面加载后恢复仍在运行的提取任务状态（刷新页面不丢进度展示） */
async function syncExtractStatus() {
  if (!epId.value) return
  try {
    const st = await episodeAPI.extractStatus(epId.value)
    for (const t of EXTRACT_TARGETS) {
      if (st?.[t.key]?.status === 'running' && !isExtracting(t.key)) {
        extractingTargets.value.push(t.key)
        pollExtractStatus(t.key)
      } else if (st?.[t.key]?.status === 'error') {
        // 恢复失败状态供查看与重试
        extractErrors.value = { ...extractErrors.value, [t.key]: st[t.key].error || `${t.label}提取失败` }
      }
    }
  } catch {}
  try {
    const vp = await episodeAPI.videoPromptsStatus(epId.value)
    if (vp?.status === 'running' && !videoPromptBatch.value.running) {
      videoPromptBatch.value = { running: true, total: vp.total || 0, completed: vp.completed || 0, failed: vp.failed || 0, items: vp.items || [] }
      vpTaskListOpen.value = true
      pollVideoPromptBatch()
    } else if (vp && vp.status !== 'running' && (vp.items?.length || vp.failed)) {
      // 上次批量有结果（含失败项）：恢复 items 供查看与重试
      videoPromptBatch.value = { running: false, total: 0, completed: 0, failed: vp.failed || 0, items: vp.items || [] }
    }
  } catch {}
}

// ─── 批量视频提示词：后端异步逐分镜生成，前端轮询进度 ──────────
  return {
    EXTRACT_TARGETS, extractingTargets, extractErrors, extractFailedCount, extractingLabels, isExtracting, isExtractFailed, doExtract, doExtractAll, doRetryExtract, pollExtractStatus, syncExtractStatus,
  }
}
