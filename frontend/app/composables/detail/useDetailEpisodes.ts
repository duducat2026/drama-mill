/*
 * Drama Mill — 项目详情「剧集列表」逻辑（自 views/drama/detail.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 *
 * 集的新建 / 软删 / 手动状态标记 / 分辨率切换；集卡片状态由用户手动标记，不再按剧本内容自动推算。
 */
import { toast } from 'vue-sonner'
import { episodeAPI } from '~/composables/useApi'

export function useDetailEpisodes(dramaId: number, load: () => Promise<void>) {
  const addDialog = ref(false)
  const creatingEpisode = ref(false)
  const newEpisodeTitle = ref('')
  const episodeToDelete = ref<any>(null)
  const deletingEpisode = ref(false)

  // 视频分辨率：创建集时固定（持久化到 episodes.resolution），集卡片上可修改
  const resolutionOptions = [
    { label: '720p · 高清', value: '720p' },
    { label: '480p · 流畅', value: '480p' },
  ]
  const newEpisodeResolution = ref('720p')
  const epResMenuId = ref<number | null>(null)

  function epResolution(ep) { return ep.resolution === '480p' ? '480p' : '720p' }

  async function setEpisodeResolution(ep: any, resolution: string) {
    epResMenuId.value = null
    if (epResolution(ep) === resolution) return
    const prev = ep.resolution
    ep.resolution = resolution
    try {
      await episodeAPI.update(ep.id, { resolution })
      toast.success(`本集视频分辨率已切换为 ${resolution}`)
    } catch (e: any) {
      ep.resolution = prev
      toast.error(e.message)
    }
  }

  // 集状态由用户手动标记（持久化到 episodes.status），不再按剧本内容自动推算
  const epStatusOptions = [
    { label: '待开始', value: 'draft' },
    { label: '进行中', value: 'active' },
    { label: '已完成', value: 'completed' },
  ]
  const epStatusMenuId = ref<number | null>(null)

  function epStatus(ep) { return ep.status || 'draft' }
  function epStatusLabel(ep: any) { return epStatusOptions.find(s => s.value === epStatus(ep))?.label || '待开始' }
  function epStatusDotClass(ep: any) { return epStatus(ep) === 'active' ? 'dot-active' : epStatus(ep) === 'completed' ? 'dot-done' : 'dot-pending' }

  function formatEpTime(ts: any) {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    const diff = Number(now) - Number(d)
    if (diff < 60_000) return '刚刚'
    if (diff < 3600_000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400_000) return `${Math.floor(diff / 3600000)} 小时前`
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  async function setEpisodeStatus(ep: any, status: string) {
    epStatusMenuId.value = null
    if (epStatus(ep) === status) return
    const prev = ep.status
    ep.status = status
    try {
      await episodeAPI.update(ep.id, { status })
    } catch (e: any) {
      ep.status = prev
      toast.error(e.message)
    }
  }

  // summary 模式下剧本/视频仅返回布尔（不再传大文本）
  function epHasScript(ep: any) { return !!ep.has_script }
  function epHasVideo(ep: any) { return !!ep.has_video }

  function openAddEpisode() {
    newEpisodeTitle.value = ''
    newEpisodeResolution.value = '720p'
    addDialog.value = true
  }

  async function addEpisode() {
    try {
      creatingEpisode.value = true
      // 图片/视频生成配置由后端自动锁定为当前启用的最高优先级配置；分辨率随集固定
      await episodeAPI.create({
        drama_id: dramaId,
        title: newEpisodeTitle.value || undefined,
        resolution: newEpisodeResolution.value,
      })
      toast.success('已添加新集')
      addDialog.value = false
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      creatingEpisode.value = false
    }
  }

  async function confirmDelEpisode() {
    const ep = episodeToDelete.value
    if (!ep) return
    try {
      deletingEpisode.value = true
      await episodeAPI.del(ep.id)
      toast.success('已删除')
      episodeToDelete.value = null
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      deletingEpisode.value = false
    }
  }

  return {
    addDialog,
    creatingEpisode,
    newEpisodeTitle,
    episodeToDelete,
    deletingEpisode,
    resolutionOptions,
    newEpisodeResolution,
    epResMenuId,
    epResolution,
    setEpisodeResolution,
    epStatusOptions,
    epStatusMenuId,
    epStatus,
    epStatusLabel,
    epStatusDotClass,
    formatEpTime,
    setEpisodeStatus,
    epHasScript,
    epHasVideo,
    openAddEpisode,
    addEpisode,
    confirmDelEpisode,
  }
}
