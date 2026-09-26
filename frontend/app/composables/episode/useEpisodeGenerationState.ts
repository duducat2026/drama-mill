/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */

export function useEpisodeGenerationState(wb: any) {
const pendingCharImageIds = ref([])
const pendingSceneImageIds = ref([])
const pendingPropImageIds = ref([])
const pendingVideoIds = ref([])
const failedVideoMessages = ref({})
// 图片生成失败态（assetId → 错误信息）：任务失败即时反映，徽标切为「生成失败」，点击生成即重试
const failedCharImages = ref({})
const failedSceneImages = ref({})
const failedPropImages = ref({})
const genTaskQueue = ref({ running: 0, queued: 0, max: 3 })
const retryingTaskIds = ref([])
// 任务列表面板：顶栏按钮触发的右侧抽屉,按集聚合 sys_task + video_merges；sys_task 服务端分页（状态恢复另拉 200 条保证完整）
function isPendingCharImage(id) {
  return pendingCharImageIds.value.includes(id)
}

function isFailedCharImage(id) { return !!failedCharImages.value[id] }
function isFailedSceneImage(id) { return !!failedSceneImages.value[id] }
function isFailedPropImage(id) { return !!failedPropImages.value[id] }

// ─── 资产图片统一任务列表：聚合角色/场景/道具的生成状态，支持查看失败原因与一键重试 ───
function isPendingSceneImage(id) {
  return pendingSceneImageIds.value.includes(id)
}

function isPendingVideo(id) {
  return pendingVideoIds.value.includes(id)
}

function videoFailMessage(id) {
  return failedVideoMessages.value[id] || ''
}

function isPendingPropImage(id) {
  return pendingPropImageIds.value.includes(id)
}
  return {
    pendingCharImageIds, pendingSceneImageIds, pendingPropImageIds, pendingVideoIds, failedVideoMessages, failedCharImages, failedSceneImages, failedPropImages, genTaskQueue, retryingTaskIds, isPendingCharImage, isFailedCharImage, isFailedSceneImage, isFailedPropImage, isPendingSceneImage, isPendingVideo, videoFailMessage, isPendingPropImage,
  }
}
