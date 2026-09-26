/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */

export function useEpisodeIdentity(wb: any) {
const route = useRoute()
const dramaId = Number(route.params.id)
// 集号响应式：上下集切换走同一路由记录复用本组件，需跟随路由参数刷新数据
const episodeNumber = ref(Number(route.params.episodeNumber))

const drama = ref(null), episode = ref(null), chars = ref([]), scenes = ref([]), propItems = ref([]), sbs = ref([]), mergeData = ref(null)
// 工作台面板位置记忆（按剧集隔离）：仅页面刷新(reload)时恢复到上次所在步骤；
// 从列表/详情页点击进入时始终默认「剧本」面板
// 面板位置按「项目+集」隔离，集号响应式故用 computed 键，切集后自动落到新集的键上
const PANEL_STORE_KEY = computed(() => `drama-mill:workbench:panel:${dramaId}:${episodeNumber.value}`)
const isPageReload = (() => {
  try { return performance.getEntriesByType('navigation')[0]?.type === 'reload' } catch { return false }
})()
const storedPanel = (() => {
  if (!isPageReload) return null
  try { return JSON.parse(localStorage.getItem(PANEL_STORE_KEY.value) || 'null') } catch { return null }
})()
// 首个 refresh 时若已恢复面板位置，跳过按内容自动重置 scriptStep
const panel = ref(['production', 'export'].includes(storedPanel?.panel) ? storedPanel.panel : 'script')
const localRaw = ref(''), localScript = ref('')
const rawContent = computed(() => episode.value?.content || '')
const scriptContent = computed(() => episode.value?.script_content || episode.value?.scriptContent || '')
const epId = computed(() => episode.value?.id || 0)
const rawLen = computed(() => localRaw.value.replace(/\s/g, '').length || 0)
const scriptLen = computed(() => localScript.value.replace(/\s/g, '').length || 0)
const mergeUrl = computed(() => mergeData.value?.merged_url || mergeData.value?.mergedUrl || null)

// ===== 拼接导出:镜头选择 + 成片列表 =====
const scriptStep = ref(storedPanel ? (storedPanel.scriptStep === 0 ? 0 : 1) : 0)
const prodTab = ref(['assets', 'storyboard', 'videos'].includes(storedPanel?.prodTab) ? storedPanel.prodTab : 'assets')
// 面板位置变化即持久化
watch([panel, scriptStep, prodTab], ([p, s, t]) => {
  try { localStorage.setItem(PANEL_STORE_KEY.value, JSON.stringify({ panel: p, scriptStep: s, prodTab: t })) } catch { /* 静默 */ }
})
const activeExtractTab = ref('characters')
function isNarratorCharacter(char) {
  const text = `${char?.name || ''} ${char?.role || ''}`.toLowerCase()
  return text.includes('旁白') || text.includes('narrator') || text.includes('画外音')
}

const visualChars = computed(() => chars.value.filter(c => !isNarratorCharacter(c)))
const totalDuration = computed(() => sbs.value.reduce((s, sb) => s + (sb.duration || 10), 0))
const selectedSb = ref(null)
  return {
    route, dramaId, episodeNumber, drama, episode, chars, scenes, propItems, sbs, mergeData, PANEL_STORE_KEY, isPageReload, storedPanel, panel, scriptStep, prodTab, activeExtractTab, epId, rawContent, scriptContent, localRaw, localScript, rawLen, scriptLen, mergeUrl, selectedSb, totalDuration, isNarratorCharacter, visualChars,
  }
}
