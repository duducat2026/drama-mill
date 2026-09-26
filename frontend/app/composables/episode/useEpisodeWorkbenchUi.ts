/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */

export function useEpisodeWorkbenchUi(wb: any) {
  const assetDetail = wb.assetDetail
  const closeAssetDetail = (...args: any[]) => wb.closeAssetDetail(...args)
  const taskDrawer = wb.taskDrawer
  const closeTaskDrawer = (...args: any[]) => wb.closeTaskDrawer(...args)

const imageViewer = ref({ open: false, src: '', title: '' })
const activeMerge = ref(null) // 成片大预览弹窗中正在播放的拼接记录
function openImageViewer(src, title = '') {
  if (!src) return
  imageViewer.value = { open: true, src, title }
}

function closeImageViewer() {
  imageViewer.value = { open: false, src: '', title: '' }
}

function handleImageViewerKeydown(event) {
  if (event.key !== 'Escape') return
  if (imageViewer.value.open) closeImageViewer()
  else if (assetDetail.value.open) closeAssetDetail()
  else if (taskDrawer.value) closeTaskDrawer()
}

  return {
    imageViewer, activeMerge, openImageViewer, closeImageViewer, handleImageViewerKeydown,
  }
}
