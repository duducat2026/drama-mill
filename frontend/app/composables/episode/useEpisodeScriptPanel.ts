/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { episodeAPI, uploadAPI, rewriterAPI } from '~/composables/useApi'

export function useEpisodeScriptPanel(wb: any) {
  const epId = wb.epId
  const localRaw = wb.localRaw
  const episode = wb.episode
  const localScript = wb.localScript
  const dramaId = wb.dramaId
  const chatModelOverride = (...args: any[]) => wb.chatModelOverride(...args)
  const chatConfigId = (...args: any[]) => wb.chatConfigId(...args)
  const refresh = (...args: any[]) => wb.refresh(...args)
  const rawContent = wb.rawContent
  const panel = wb.panel
  const prodTab = wb.prodTab

const rewriteRunning = ref(false)
const rewriteError = ref(null)

function saveRaw() { episodeAPI.update(epId.value, { content: localRaw.value }); episode.value.content = localRaw.value }
function saveScr() { episodeAPI.update(epId.value, { script_content: localScript.value }); episode.value.script_content = localScript.value }

// ─── 耗时/成本统计（头部药丸 + 详情弹窗） ───
const rawFileInput = ref(null)
const docUploading = ref(false)
async function onUploadDocument(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  docUploading.value = true
  try {
    const { text, filename } = await uploadAPI.document(file)
    localRaw.value = text
    saveRaw()
    toast.success(`已读取 ${filename}，可继续编辑`)
  } catch (err) { toast.error(err.message) } finally { docUploading.value = false }
}
// 剧本改写：异步 fire-and-forget，后台执行，刷新不中断；失败原因持久化供重试反馈
function doRewrite() {
  if (rewriteRunning.value) return
  saveRaw()
  rewriteError.value = null
  rewriteRunning.value = true
  rewriterAPI.run(epId.value, dramaId, undefined, chatModelOverride(), chatConfigId())
    .then(() => pollRewriteStatus())
    .catch(e => { rewriteRunning.value = false; rewriteError.value = e.message; toast.error(e.message) })
}
// 重试失败的改写：将失败原因作为反馈传给 Agent 优化重新改写
function doRetryRewrite() {
  if (rewriteRunning.value) return
  rewriteRunning.value = true
  rewriteError.value = null
  rewriterAPI.retry(epId.value, dramaId, undefined, chatModelOverride(), chatConfigId())
    .then(() => pollRewriteStatus())
    .catch(e => { rewriteRunning.value = false; rewriteError.value = e.message; toast.error(e.message) })
}
function pollRewriteStatus(attempts = 360) {
  const tick = async (left) => {
    if (!epId.value) return
    try {
      const st = await rewriterAPI.status(epId.value)
      if (st && (st.status === 'done' || st.status === 'failed')) {
        rewriteRunning.value = false
        await refresh()
        if (st.status === 'done') { rewriteError.value = null; toast.success('剧本改写完成') }
        else { rewriteError.value = st.error || '剧本改写失败'; toast.error(rewriteError.value) }
        return
      }
    } catch {}
    if (left > 0) setTimeout(() => tick(left - 1), 2500)
    else rewriteRunning.value = false
  }
  setTimeout(() => tick(attempts), 2500)
}
async function restoreRewriteStatus() {
  if (!epId.value) return
  try {
    const st = await rewriterAPI.status(epId.value)
    if (st?.status === 'running') { rewriteRunning.value = true; pollRewriteStatus() }
    else if (st?.status === 'failed') { rewriteError.value = st.error || '剧本改写失败' }
  } catch {}
}
function skipRewrite() {
  const raw = (localRaw.value || rawContent.value || '').trim()
  if (!raw) {
    toast.warning('请先填写原始内容')
    return
  }
  localScript.value = raw
  saveScr()
  toast.success('已跳过 AI 改写，当前将直接使用原始内容')
  panel.value = 'production'
  prodTab.value = 'assets'
}
// 资产提取：按类型独立的异步任务（后端任务表驱动），三类可并行；前端轮询状态直到完成
  return {
    rewriteRunning, rewriteError, rawFileInput, docUploading, onUploadDocument, saveRaw, saveScr, doRewrite, doRetryRewrite, pollRewriteStatus, restoreRewriteStatus, skipRewrite,
  }
}
