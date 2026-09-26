/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { X } from 'lucide-vue-next'
import { taskAPI } from '~/composables/useApi'

export function useEpisodeVideoTasks(wb: any) {
  const hasVid = (...args: any[]) => wb.hasVid(...args)
  const isPendingVideo = (...args: any[]) => wb.isPendingVideo(...args)
  const videoFailMessage = (...args: any[]) => wb.videoFailMessage(...args)
  const sbs = wb.sbs
  const getShotReferenceImages = (...args: any[]) => wb.getShotReferenceImages(...args)
  const getSceneName = (...args: any[]) => wb.getSceneName(...args)
  const selectedSb = wb.selectedSb
  const dramaId = wb.dramaId
  const resolveVideoPromptRefs = (...args: any[]) => wb.resolveVideoPromptRefs(...args)
  const videoDuration = wb.videoDuration
  const dramaAspectRatio = wb.dramaAspectRatio
  const bareModelName = (...args: any[]) => wb.bareModelName(...args)
  const videoModel = wb.videoModel
  const ownerConfigId = (...args: any[]) => wb.ownerConfigId(...args)
  const videoModelOptions = wb.videoModelOptions
  const videoModelLock = wb.videoModelLock
  const videoRefVideoUrls = wb.videoRefVideoUrls
  const videoRefAudioUrls = wb.videoRefAudioUrls
  const failedVideoMessages = wb.failedVideoMessages
  const pendingVideoIds = wb.pendingVideoIds
  const refresh = (...args: any[]) => wb.refresh(...args)
  const watchAsyncResult = (...args: any[]) => wb.watchAsyncResult(...args)
  const sleepVisible = (...args: any[]) => wb.sleepVisible(...args)
  const refreshStoryboardsOnly = (...args: any[]) => wb.refreshStoryboardsOnly(...args)
  const getVideoUrl = (...args: any[]) => wb.getVideoUrl(...args)

function videoTaskState(sb) {
  if (hasVid(sb)) return 'done'
  if (isPendingVideo(sb?.id)) return 'pending'
  if (videoFailMessage(sb?.id)) return 'failed'
  return 'ready'
}

function videoTaskStatusLabel(sb) {
  const state = videoTaskState(sb)
  if (state === 'done') return '已完成'
  if (state === 'pending') return '生成中'
  if (state === 'failed') return '失败'
  return '待生成'
}

function videoTaskActionLabel(sb) {
  const state = videoTaskState(sb)
  if (state === 'done') return '重新生成'
  if (state === 'pending') return '生成中'
  return '生成'
}

const videoTaskRows = computed(() => sbs.value.map((sb, index) => {
  const duration = Number(sb.duration || 5)
  const referenceCount = getShotReferenceImages(sb).length
  const sceneName = getSceneName(sb)
  return {
    id: sb.id,
    index,
    storyboard: sb,
    title: sb.description || `镜头 #${String(index + 1).padStart(2, '0')}`,
    meta: sceneName || `${referenceCount} 个参考素材`,
    duration: Number.isFinite(duration) ? duration : 5,
    referenceCount,
    state: videoTaskState(sb),
    // 只有当前处于失败状态才显示错误,避免重试成功的分镜残留历史错误信息
    error: videoTaskState(sb) === 'failed' ? videoFailMessage(sb.id) : '',
  }
}))
const videoTaskDoneCount = computed(() => videoTaskRows.value.filter(task => task.state === 'done').length)
const videoTaskFailedCount = computed(() => videoTaskRows.value.filter(task => task.state === 'failed').length)

const selectedVideoTaskNumber = computed(() => {
  const index = videoTaskRows.value.findIndex(task => String(task.id) === String(selectedSb.value?.id))
  return index >= 0 ? index + 1 : 0
})

// ===== 下载文件命名：剧名-第X集-分镜N（分镜视频）、剧名-第X集-本集标题（成片）=====
// 静态资源与页面同源（nginx 直连磁盘），a[download] 即可指定文件名，无需后端下载端点
async function genVid(sb) {
  const referenceImages = getShotReferenceImages(sb)
  const params = {
    storyboard_id: sb.id,
    drama_id: dramaId,
    prompt: resolveVideoPromptRefs(sb),
    duration: Number(videoDuration.value || sb.duration || 10),
    aspect_ratio: dramaAspectRatio.value,
    generate_audio: true,
    model: bareModelName(videoModel.value) || undefined,
    config_id: ownerConfigId(videoModelOptions.value, videoModel.value),
    no_balance: videoModelLock.value || undefined,
    reference_image_urls: referenceImages,
    reference_video_urls: videoRefVideoUrls.value,
    reference_audio_urls: videoRefAudioUrls.value,
  }
  if (params.reference_audio_urls.length && !referenceImages.length && !params.reference_video_urls.length) {
    toast.error('参考音频需要至少 1 个参考图片或视频')
    return
  }
  if (!params.prompt && !referenceImages.length && !params.reference_video_urls.length && !params.reference_audio_urls.length) {
    toast.error('需要至少一个参考素材或视频提示词')
    return
  }
  try {
    delete failedVideoMessages.value[sb.id]
    if (!isPendingVideo(sb.id)) pendingVideoIds.value.push(sb.id)
    const generation = await taskAPI.generate({ type: 'video', ...params })
    toast.success('视频生成中')
    await refresh()
    pollVideoGeneration(generation?.id, sb.id)
  } catch (e) {
    pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== sb.id)
    failedVideoMessages.value = {
      ...failedVideoMessages.value,
      [sb.id]: e.message || '视频生成失败',
    }
    toast.error(e.message)
  }
}
async function pollVideoGeneration(generationId, storyboardId) {
  if (!generationId) {
    watchAsyncResult(() => {
      const target = sbs.value.find(s => s.id === storyboardId)
      const done = !!(target?.video_url || target?.videoUrl)
      if (done) pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== storyboardId)
      return done
    }, 60, 4000)
    return
  }
  let lastStatus = ''
  for (let i = 0; i < 120; i++) {
    await sleepVisible(4000)
    try {
      const res = await taskAPI.get(generationId)
      const status = res?.status || ''
      // 进行中只轻量同步分镜/任务；仅终态才全量刷新，避免每 4s 拉一次项目树+统计接口
      if (status === lastStatus) continue
      lastStatus = status
      if (status === 'completed') {
        await refresh()
        pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== storyboardId)
        delete failedVideoMessages.value[storyboardId]
        toast.success('视频生成完成')
        return
      }
      if (status === 'failed') {
        await refresh()
        pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== storyboardId)
        failedVideoMessages.value = {
          ...failedVideoMessages.value,
          [storyboardId]: res?.error_msg || res?.errorMsg || '视频生成失败',
        }
        toast.error(failedVideoMessages.value[storyboardId])
        return
      }
      if (status) await refreshStoryboardsOnly()
    } catch {}
  }
  pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== storyboardId)
  failedVideoMessages.value = {
    ...failedVideoMessages.value,
    [storyboardId]: '视频生成超时',
  }
  toast.error('视频生成超时')
}
function batchVideos() {
  const missing = sbs.value.filter(s => !hasVid(s) && !isPendingVideo(s.id))
  if (!missing.length) {
    toast.info('所有镜头视频已生成')
    return
  }
  const pendingIds = missing.map(s => s.id)
  pendingIds.forEach(id => {
    const sb = sbs.value.find(item => item.id === id)
    if (sb) genVid(sb)
  })
  if (pendingIds.length) {
    pendingVideoIds.value = [...new Set([...pendingVideoIds.value, ...pendingIds])]
    watchAsyncResult(() => pendingIds.every(id => {
      const target = sbs.value.find(s => s.id === id)
      const done = !!getVideoUrl(target)
      if (done) pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== id)
      return done
    }), 80, 4000)
  }
}
// 批量重试失败的视频任务：逐个重新提交失败分镜的视频生成
function retryFailedVideos() {
  const failed = sbs.value.filter(s => videoTaskState(s) === 'failed')
  if (!failed.length) { toast.info('没有失败的视频任务'); return }
  failed.forEach(sb => genVid(sb))
}
  return {
    videoTaskState, videoTaskStatusLabel, videoTaskActionLabel, videoTaskRows, videoTaskDoneCount, videoTaskFailedCount, selectedVideoTaskNumber, genVid, pollVideoGeneration, batchVideos, retryFailedVideos,
  }
}
