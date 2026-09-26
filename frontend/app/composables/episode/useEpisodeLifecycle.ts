/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import type { Workbench } from './workbench-context'

export function useEpisodeLifecycle(wb: any) {
  const handleImageViewerKeydown = (...args: any[]) => wb.handleImageViewerKeydown(...args)
  const stopGenTasksPolling = (...args: any[]) => wb.stopGenTasksPolling(...args)
  const stopMergeStatusPolling = (...args: any[]) => wb.stopMergeStatusPolling(...args)
  const refresh = (...args: any[]) => wb.refresh(...args)
  const loadConfigs = (...args: any[]) => wb.loadConfigs(...args)
  const refreshAiCall = wb.refreshAiCall
  const syncExtractStatus = (...args: any[]) => wb.syncExtractStatus(...args)
  const restorePendingImageTasks = (...args: any[]) => wb.restorePendingImageTasks(...args)
  const restoreStoryboardSplit = (...args: any[]) => wb.restoreStoryboardSplit(...args)
  const restoreRewriteStatus = (...args: any[]) => wb.restoreRewriteStatus(...args)

onMounted(() => {
  window.addEventListener('keydown', handleImageViewerKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleImageViewerKeydown)
  stopGenTasksPolling()
  stopMergeStatusPolling()
})

onMounted(async () => { await refresh(); loadConfigs(); refreshAiCall(); syncExtractStatus(); restorePendingImageTasks(); restoreStoryboardSplit(); restoreRewriteStatus() })
  return {}
}
