/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { storyboardAPI } from '~/composables/useApi'

export function useEpisodeStoryboardSplit(wb: any) {
  const chars = wb.chars
  const scenes = wb.scenes
  const propItems = wb.propItems
  const epId = wb.epId
  const dramaId = wb.dramaId
  const chatModelOverride = (...args: any[]) => wb.chatModelOverride(...args)
  const chatConfigId = (...args: any[]) => wb.chatConfigId(...args)
  const refresh = (...args: any[]) => wb.refresh(...args)
  const refreshStoryboardsOnly = (...args: any[]) => wb.refreshStoryboardsOnly(...args)

const sbSplit = ref({ running: false, saved: 0, error: null })

function buildBreakdownMessage() {
  const charList = chars.value.length
    ? chars.value.map(c => `${c.name}(ID:${c.id})`).join('、')
    : '（当前集还没有角色）'
  const sceneList = scenes.value.length
    ? scenes.value.map(s => `${s.location} · ${s.time || '未设时间'}(ID:${s.id})`).join('、')
    : '（当前集还没有场景）'
  const propList = propItems.value.length
    ? propItems.value.map(p => `${p.name}(ID:${p.id})`).join('、')
    : '（当前集还没有道具）'
  return `请基于当前集剧本拆分分镜（不需要生成视频提示词，video_prompt 在视频生成阶段按需生成）。

当前集已有角色：${charList}
当前集已有场景：${sceneList}
当前集已有道具：${propList}

绑定要求：
- 每个镜头必须根据剧本内容，从上述当前集已有角色中选出出场的角色绑定 character_ids（ID 必须来自上述列表；有角色出场就必须绑定，不要遗漏）
- 每个镜头尽量匹配上述已有场景填写 scene_id（ID 必须来自上述列表），不要凭空创造新场景
- 每个镜头出现关键道具（被使用、交接、特写或在画面中明显可见）时，从上述当前集已有道具中绑定 prop_ids（ID 必须来自上述列表）；没有道具出现可传空数组\n- 只有纯环境空镜头才可以不绑定角色`
}
async function doBreakdown() {
  if (sbSplit.value.running) { toast.warning('分镜拆分进行中'); return }
  try {
    const res = await storyboardAPI.split(epId.value, dramaId, buildBreakdownMessage(), chatModelOverride(), chatConfigId())
    if (res?.already_running) {
      toast.info('分镜拆分已在进行中')
      sbSplit.value = { running: true, saved: sbSplit.value.saved, error: null }
      pollStoryboardSplit()
      return
    }
    sbSplit.value = { running: true, saved: 0, error: null }
    toast.info('分镜拆分已提交，后台执行中，可自由切换页面或刷新')
    pollStoryboardSplit()
  } catch (e) {
    toast.error(e.message)
  }
}
// 重试失败的拆分：将失败原因作为反馈传给 Agent 优化重新拆分
async function doRetryBreakdown() {
  if (sbSplit.value.running) { toast.warning('分镜拆分进行中'); return }
  try {
    const res = await storyboardAPI.retry(epId.value, dramaId, buildBreakdownMessage(), chatModelOverride(), chatConfigId())
    if (res?.already_running) {
      toast.info('分镜拆分已在进行中')
      sbSplit.value = { running: true, saved: sbSplit.value.saved, error: null }
      pollStoryboardSplit()
      return
    }
    sbSplit.value = { running: true, saved: sbSplit.value.saved, error: null }
    toast.info('分镜拆分重试已提交，后台执行中')
    pollStoryboardSplit()
  } catch (e) {
    toast.error(e.message)
  }
}

function pollStoryboardSplit(attempts = 360) {
  const tick = async (left) => {
    if (!epId.value) return
    try {
      const st = await storyboardAPI.splitStatus(epId.value)
      if (st && (st.status === 'done' || st.status === 'failed')) {
        sbSplit.value = { running: false, saved: st.storyboard_count || 0, error: st.status === 'failed' ? (st.error || '分镜拆分失败') : null }
        await refresh()
        if (st.status === 'done') toast.success(`分镜拆分完成，共 ${st.storyboard_count || 0} 段`)
        else toast.error(st.error || '分镜拆分失败')
        return
      }
      if (st?.status === 'running') {
        const saved = st.storyboard_count || 0
        if (saved !== sbSplit.value.saved) {
          sbSplit.value = { running: true, saved }
          await refreshStoryboardsOnly() // 分段逐步保存，只轻量同步分镜列表实时出现
        } else if (!sbSplit.value.running) {
          sbSplit.value = { running: true, saved }
        }
      }
    } catch {}
    if (left > 0) setTimeout(() => tick(left - 1), 2500)
    else sbSplit.value = { running: false, saved: sbSplit.value.saved }
  }
  setTimeout(() => tick(attempts), 2500)
}

// 页面加载时查询后台拆分进度，恢复「拆分中」状态（刷新不作废）
async function restoreStoryboardSplit() {
  if (!epId.value) return
  try {
    const st = await storyboardAPI.splitStatus(epId.value)
    if (st?.status === 'running') {
      sbSplit.value = { running: true, saved: st.storyboard_count || 0, error: null }
      pollStoryboardSplit()
    } else if (st?.status === 'failed') {
      sbSplit.value = { running: false, saved: st.storyboard_count || 0, error: st.error || '分镜拆分失败' }
    }
  } catch {}
}

// 按需为单个分镜生成视频提示词：由 prompt_generator 读取分镜字段生成并保存到 video_prompt
  return {
    sbSplit, buildBreakdownMessage, doBreakdown, doRetryBreakdown, pollStoryboardSplit, restoreStoryboardSplit,
  }
}
