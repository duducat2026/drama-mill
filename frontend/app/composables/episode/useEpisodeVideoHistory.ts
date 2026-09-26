/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { storyboardAPI, taskAPI } from '~/composables/useApi'

export function useEpisodeVideoHistory(wb: any) {
  const getVideoUrl = (...args: any[]) => wb.getVideoUrl(...args)
  const selectedSb = wb.selectedSb

const sbVideoHistory = ref([])
const previewVideoUrl = ref('') // 正在预览的历史视频(相对路径);空 = 预览当前主视频

// 注意:/tasks 返回原始行(camelCase),/episodes/:id/generation-tasks 返回 snake_case,两种命名都兼容
function taskVideoPath(t) { return t?.local_path || t?.localPath || t?.result_url || t?.resultUrl || '' }
function taskCreatedAt(t) { return t?.created_at || t?.createdAt || '' }
function isCurrentVideo(t) { const p = taskVideoPath(t); return !!p && p === getVideoUrl(selectedSb.value) }

async function loadSbVideoHistory() {
  previewVideoUrl.value = ''
  if (!selectedSb.value?.id) { sbVideoHistory.value = []; return }
  try {
    const res = await taskAPI.list({ type: 'video', storyboard_id: selectedSb.value.id, page_size: 50 })
    sbVideoHistory.value = (res?.items || [])
      .filter(t => t.status === 'completed' && taskVideoPath(t))
      .sort((a, b) => taskCreatedAt(b).localeCompare(taskCreatedAt(a)))
  } catch { sbVideoHistory.value = [] }
}

watch(() => [selectedSb.value?.id, getVideoUrl(selectedSb.value)], () => { loadSbVideoHistory() })

function previewHistoryVideo(t) {
  previewVideoUrl.value = isCurrentVideo(t) ? '' : taskVideoPath(t)
}

async function setAsMainVideo() {
  const sb = selectedSb.value
  if (!sb || !previewVideoUrl.value) return
  try {
    await storyboardAPI.update(sb.id, { video_url: previewVideoUrl.value })
    sb.video_url = previewVideoUrl.value
    sb.videoUrl = previewVideoUrl.value
    toast.success('已设为主视频')
  } catch (e) { toast.error(e.message || '设置失败') }
}

async function removeHistoryVideo(t) {
  try {
    await taskAPI.del(t.id)
    sbVideoHistory.value = sbVideoHistory.value.filter(x => x.id !== t.id)
    if (previewVideoUrl.value === taskVideoPath(t)) previewVideoUrl.value = ''
    toast.success('已删除该历史记录')
  } catch (e) { toast.error(e.message || '删除失败') }
}

  return {
    sbVideoHistory, previewVideoUrl, taskVideoPath, taskCreatedAt, isCurrentVideo, loadSbVideoHistory, previewHistoryVideo, setAsMainVideo, removeHistoryVideo,
  }
}
