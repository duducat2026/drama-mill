/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { timingAPI, costAPI } from '~/composables/useApi'

export function useEpisodeStats(wb: any) {
  const epId = wb.epId
  const dramaId = wb.dramaId

const epTimings = ref(null)
const epCostData = ref(null)
const showTimings = ref(false)
const showCost = ref(false)
const epCostDetails = computed(() => (epCostData.value?.details || []).filter(r => r.episode_id === epId.value).slice(0, 50))

async function loadEpStats() {
  if (!epId.value) return
  try { epTimings.value = await timingAPI.episode(epId.value) } catch {}
  try {
    const agg = await costAPI.my({ drama_id: dramaId, limit: 200 })
    const epEntry = (agg.by_episode || []).find(e => e.episode_id === epId.value)
    epCostData.value = { ...agg, episode_cost: epEntry?.cost ?? 0 }
  } catch {}
}

// ─── 原始内容文件上传（.txt/.md/.docx）：提取文本后填入文本域可继续编辑 ───
  return {
    epTimings, epCostData, showTimings, showCost, epCostDetails, loadEpStats,
  }
}
