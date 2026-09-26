/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { api, episodeAPI } from '~/composables/useApi'

export function useEpisodeVideoPrompts(wb: any) {
  const sbs = wb.sbs
  const selectedSb = wb.selectedSb
  const epId = wb.epId
  const chatModelOverride = (...args: any[]) => wb.chatModelOverride(...args)
  const chatConfigId = (...args: any[]) => wb.chatConfigId(...args)
  const refresh = (...args: any[]) => wb.refresh(...args)
  const refreshStoryboardsOnly = (...args: any[]) => wb.refreshStoryboardsOnly(...args)
  const videoConfigs = wb.videoConfigs
  const lockedVideoConfigId = wb.lockedVideoConfigId
  const getStoryboardCharacters = (...args: any[]) => wb.getStoryboardCharacters(...args)
  const getStoryboardProps = (...args: any[]) => wb.getStoryboardProps(...args)
  const getSceneName = (...args: any[]) => wb.getSceneName(...args)
  const dramaId = wb.dramaId

const videoPromptBatch = ref({ running: false, total: 0, completed: 0, failed: 0, items: [] })
// 任务列表面板：展示每个分镜的生成状态与失败原因
const vpTaskListOpen = ref(false)
const vpFailedItems = computed(() => (videoPromptBatch.value.items || []).filter(it => it.status === 'failed'))
const vpHasItems = computed(() => (videoPromptBatch.value.items || []).length > 0)
function vpItemBySbId(sbId) { return (videoPromptBatch.value.items || []).find(it => it.storyboard_id === sbId) }
function vpStatusBadge(sb) {
  const it = vpItemBySbId(sb.id)
  if (!it) return null
  return it.status
}
// 单个视频提示词生成：按分镜 ID 跟踪，允许不同分镜并行生成（不走全局 rn 锁）
const videoPromptGeneratingIds = ref([])
// 分镜勾选：勾选后批量生成只处理所选（已有提示词也会重新生成）；未勾选时处理全部缺失
const selectedSbIds = ref([])
// 多选模式：进入后点击卡片=勾选/取消，底部操作条确认生成
const sbSelectMode = ref(false)
function isSbSelected(id) { return selectedSbIds.value.includes(id) }
function toggleSbSelect(id) {
  selectedSbIds.value = isSbSelected(id) ? selectedSbIds.value.filter(x => x !== id) : [...selectedSbIds.value, id]
}
function toggleSelectAllSbs() {
  selectedSbIds.value = selectedSbIds.value.length === sbs.value.length ? [] : sbs.value.map(sb => sb.id)
}
function onShotCardClick(sb) {
  if (sbSelectMode.value) toggleSbSelect(sb.id)
  else selectedSb.value = sb
}
// 仅缺失：选中还没有视频提示词的分镜
function selectMissingSbs() {
  selectedSbIds.value = sbs.value.filter(sb => !((sb.video_prompt || sb.videoPrompt || '').trim())).map(sb => sb.id)
}
function exitSbSelectMode() {
  sbSelectMode.value = false
  selectedSbIds.value = []
}
function generateSelectedVideoPrompts() {
  batchVideoPrompts() // 内部同步捕获所选 ids
  exitSbSelectMode()
}

async function batchVideoPrompts() {
  if (videoPromptBatch.value.running || !epId.value) return
  if (!sbs.value.length) { toast.warning('请先拆分分镜'); return }
  const ids = selectedSbIds.value.length ? [...selectedSbIds.value] : undefined
  try {
    const res = await episodeAPI.generateVideoPrompts(epId.value, chatModelOverride(), chatConfigId(), ids)
    if (!res?.total) {
      if (res?.already_running) {
        videoPromptBatch.value = { running: true, total: 0, completed: 0, failed: 0, items: [] }
        vpTaskListOpen.value = true
        pollVideoPromptBatch()
      } else toast.info(ids ? '所选分镜不存在' : '所有分镜已有视频提示词')
      return
    }
    videoPromptBatch.value = { running: true, total: res.total, completed: 0, failed: 0, items: [] }
    vpTaskListOpen.value = true
    toast.info(`开始生成 ${res.total} 个分镜的视频提示词…`)
    pollVideoPromptBatch()
  } catch (e) {
    toast.error(e.message)
  }
}

// 重试失败的提示词分镜：将失败原因作为反馈传给 Agent 优化重新生成
async function retryFailedVideoPrompts() {
  if (videoPromptBatch.value.running || !epId.value) return
  const failedIds = vpFailedItems.value.map(it => it.storyboard_id)
  if (!failedIds.length) { toast.info('没有失败的提示词可重试'); return }
  try {
    const res = await episodeAPI.retryVideoPrompts(epId.value, chatModelOverride(), chatConfigId(), failedIds)
    if (res?.already_running) {
      videoPromptBatch.value = { running: true, total: 0, completed: 0, failed: 0, items: videoPromptBatch.value.items }
      pollVideoPromptBatch()
      return
    }
    if (!res?.total) { toast.info('没有失败的提示词可重试'); return }
    videoPromptBatch.value = { running: true, total: res.total, completed: 0, failed: 0, items: [] }
    toast.info(`开始重试 ${res.total} 个失败的提示词，基于失败原因优化生成…`)
    pollVideoPromptBatch()
  } catch (e) {
    toast.error(e.message)
  }
}

function pollVideoPromptBatch(attempts = 240) {
  const tick = async (left) => {
    try {
      const st = await episodeAPI.videoPromptsStatus(epId.value)
      if (st && st.status !== 'running') {
        videoPromptBatch.value = { running: false, total: 0, completed: 0, failed: st.failed || 0, items: st.items || [] }
        await refresh()
        if (st.status === 'done') {
          if (st.failed) {
            vpTaskListOpen.value = true
            toast.warning(`视频提示词批量生成完成，${st.failed} 个失败，可查看详情并重试`)
          } else {
            toast.success('视频提示词批量生成完成')
          }
        } else {
          toast.error(st.error || '视频提示词批量生成失败')
        }
        return
      }
      if (st) {
        const prev = videoPromptBatch.value.completed
        videoPromptBatch.value = { running: true, total: st.total || 0, completed: st.completed || 0, failed: st.failed || 0, items: st.items || [] }
        if ((st.completed || 0) !== prev) await refreshStoryboardsOnly() // 每完成一条轻量同步分镜即可，提示词逐步出现
      }
    } catch {}
    if (left > 0) setTimeout(() => tick(left - 1), 2500)
    else videoPromptBatch.value = { running: false, total: 0, completed: 0, failed: videoPromptBatch.value.failed, items: videoPromptBatch.value.items }
  }
  setTimeout(() => tick(attempts), 2500)
}
// ===== 异步分镜拆分：提交即返回，Agent 后台执行，刷新页面不中断 =====
async function genVideoPrompt(sb) {
  if (!sb || videoPromptGeneratingIds.value.includes(sb.id)) return
  const idx = sbs.value.indexOf(sb) + 1
  const cfg = videoConfigs.value.find(c => c.id === lockedVideoConfigId.value)
  const label = cfg ? `${cfg.name} (${cfg.provider})` : '默认'
  const charNames = getStoryboardCharacters(sb).map(c => c.name).join('、') || '无'
  const propNames = getStoryboardProps(sb).map(p => p.name).join('、') || '无'
  videoPromptGeneratingIds.value.push(sb.id)
  try {
    await api.post(`/agent/prompt_generator/chat`, {
      message: `请为分镜 #${idx}(ID:${sb.id})生成视频提示词(video_prompt)。视频模型:${label},请根据该模型的特性和时长限制生成。

该分镜信息:时长 ${sb.duration || 10}s;场景:${getSceneName(sb) || '未绑定'};角色:${charNames};道具:${propNames}。

请先调用 read_storyboard_context 获取该分镜的画面描述(含【镜头N】子镜头与台词/旁白)、氛围及时长,据此生成 video_prompt(按 3 秒分段换行、用 @角色名/@场景名/@道具名 引用参考素材；段落内允许多镜头切镜,但不跨场景,切镜点对齐 description 的【镜头N】结构),然后调用 update_storyboard 保存到分镜 ID:${sb.id}。只更新 video_prompt 字段,不要改动其他字段,不要重新拆分整集。`,
      drama_id: dramaId,
      episode_id: epId.value,
      model: chatModelOverride() || undefined,
      config_id: chatConfigId() || undefined,
    })
    toast.success(`分镜 #${idx} 视频提示词已生成`)
    await refresh()
  } catch (e) {
    toast.error(e.message)
  } finally {
    videoPromptGeneratingIds.value = videoPromptGeneratingIds.value.filter(id => id !== sb.id)
  }
}

  return {
    videoPromptBatch, vpTaskListOpen, vpFailedItems, vpHasItems, vpItemBySbId, vpStatusBadge, videoPromptGeneratingIds, selectedSbIds, sbSelectMode, isSbSelected, toggleSbSelect, toggleSelectAllSbs, onShotCardClick, selectMissingSbs, exitSbSelectMode, generateSelectedVideoPrompts, batchVideoPrompts, retryFailedVideoPrompts, pollVideoPromptBatch, genVideoPrompt,
  }
}
