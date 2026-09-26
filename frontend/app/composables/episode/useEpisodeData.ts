/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { dramaAPI, episodeAPI, mergeAPI } from '~/composables/useApi'

export function useEpisodeData(wb: any) {
  const storedPanel = (...args: any[]) => wb.storedPanel(...args)
  const episode = wb.episode
  const chars = wb.chars
  const scenes = wb.scenes
  const propItems = wb.propItems
  const sbs = wb.sbs
  const selectedSbIds = wb.selectedSbIds
  const selectedSb = wb.selectedSb
  const loadGenTasks = (...args: any[]) => wb.loadGenTasks(...args)
  const genTaskPage = wb.genTaskPage
  const drama = wb.drama
  const dramaId = wb.dramaId
  const episodeNumber = wb.episodeNumber
  const scriptStep = wb.scriptStep
  const mergeData = wb.mergeData
  const epId = wb.epId
  const panel = wb.panel
  const loadExportMerges = (...args: any[]) => wb.loadExportMerges(...args)
  const loadEpStats = (...args: any[]) => wb.loadEpStats(...args)
  const epNumberOf = (...args: any[]) => wb.epNumberOf(...args)
  const route = wb.route
  const syncExtractStatus = (...args: any[]) => wb.syncExtractStatus(...args)
  const restorePendingImageTasks = (...args: any[]) => wb.restorePendingImageTasks(...args)

let panelRestored = !!storedPanel
async function refreshAssets() {
  const ep = episode.value
  if (!ep?.id) return
  try { chars.value = await episodeAPI.characters(ep.id) } catch {}
  try { scenes.value = await episodeAPI.scenes(ep.id) } catch {}
  try { propItems.value = await episodeAPI.props(ep.id) } catch {}
  await refreshStoryboardsOnly()
}

// 更轻：只拉分镜列表 + 任务面板（视频生成/分镜拆分进度轮询用）
async function refreshStoryboardsOnly() {
  const ep = episode.value
  if (!ep?.id) return
  try {
    sbs.value = await episodeAPI.storyboards(ep.id)
    selectedSbIds.value = selectedSbIds.value.filter(id => sbs.value.some(sb => sb.id === id))
    if (sbs.value.length) {
      const currentSelectedId = selectedSb.value?.id
      selectedSb.value = sbs.value.find(sb => sb.id === currentSelectedId) || sbs.value[0]
    } else {
      selectedSb.value = null
    }
  } catch {}
  await loadGenTasks(genTaskPage.value)
}

async function refresh() {
  try {
    // summary 模式：只取轻字段（has_script/has_video 布尔标记），不拉全剧 MEDIUMTEXT 正文
    drama.value = await dramaAPI.get(dramaId, { summary: true })
    const ep = drama.value.episodes?.find(e => (e.episode_number || e.episodeNumber) === episodeNumber.value)
    if (ep) {
      // 单独加载当前集正文（content/script_content），不随项目树全量拉取
      episode.value = await episodeAPI.get(ep.id)
      try { chars.value = await episodeAPI.characters(ep.id) } catch { chars.value = [] }
      try { scenes.value = await episodeAPI.scenes(ep.id) } catch { scenes.value = [] }
      try { propItems.value = await episodeAPI.props(ep.id) } catch { propItems.value = [] }
      sbs.value = await episodeAPI.storyboards(ep.id)
      selectedSbIds.value = selectedSbIds.value.filter(id => sbs.value.some(sb => sb.id === id))
      if (sbs.value.length) {
        const currentSelectedId = selectedSb.value?.id
        selectedSb.value = sbs.value.find(sb => sb.id === currentSelectedId) || sbs.value[0]
      } else {
        selectedSb.value = null
      }

      const epHasContent = !!(episode.value?.content)
      const epHasScript = !!(episode.value?.script_content || episode.value?.scriptContent)

      if (panelRestored) {
        // 已恢复到上次所在步骤，跳过自动重置（仅首次加载生效）
        panelRestored = false
      } else if (epHasScript || epHasContent) scriptStep.value = 1
      else scriptStep.value = 0
    }
  } catch (e) {
    toast.error(e.message)
  }
  try { mergeData.value = await mergeAPI.status(epId.value) } catch {}
  // 惰性分档：任务列表参与刷新后状态恢复必须同步等；成片列表仅导出面板可见（watch panel 懒拉）；
  // 耗时/成本药丸异步回填不阻断首屏
  await loadGenTasks()
  if (panel.value === 'export') await loadExportMerges()
  void loadEpStats()
}

// ─── 上下集跳转 ───
const episodeSequence = computed(() =>
  [...(drama.value?.episodes || [])].sort((a, b) => epNumberOf(a) - epNumberOf(b))
)
const episodeIndex = computed(() => episodeSequence.value.findIndex(e => epNumberOf(e) === episodeNumber.value))
const prevEpisode = computed(() => (episodeIndex.value > 0 ? episodeSequence.value[episodeIndex.value - 1] : null))
const nextEpisode = computed(() => (episodeIndex.value >= 0 && episodeIndex.value < episodeSequence.value.length - 1 ? episodeSequence.value[episodeIndex.value + 1] : null))
function goEpisodeWorkbench(ep) {
  if (!ep) return
  navigateTo(`/drama/${dramaId}/episode/${epNumberOf(ep)}`)
}
// 同路由记录内切集：路由参数先行，集号同步后重载当前集数据（任务轮询按 epId 自动跟随）
watch(() => route.params.episodeNumber, (v) => {
  const n = Number(v)
  if (!n || n === episodeNumber.value) return
  episodeNumber.value = n
  refresh().then(() => { syncExtractStatus(); restorePendingImageTasks() })
})

  return {
    panelRestored, refreshAssets, refreshStoryboardsOnly, refresh, episodeSequence, episodeIndex, prevEpisode, nextEpisode, goEpisodeWorkbench,
  }
}
