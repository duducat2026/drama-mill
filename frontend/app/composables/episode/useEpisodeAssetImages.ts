/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { characterAPI, sceneAPI, propAPI, taskAPI } from '~/composables/useApi'

export function useEpisodeAssetImages(wb: any) {
  const sleepVisible = (...args: any[]) => wb.sleepVisible(...args)
  const refreshAssets = (...args: any[]) => wb.refreshAssets(...args)
  const sleep = (...args: any[]) => wb.sleep(...args)
  const refresh = (...args: any[]) => wb.refresh(...args)
  const failedCharImages = wb.failedCharImages
  const isPendingCharImage = (...args: any[]) => wb.isPendingCharImage(...args)
  const pendingCharImageIds = wb.pendingCharImageIds
  const chars = wb.chars
  const ensureAssetPrompt = (...args: any[]) => wb.ensureAssetPrompt(...args)
  const epId = wb.epId
  const bareModelName = (...args: any[]) => wb.bareModelName(...args)
  const imageModel = wb.imageModel
  const ownerConfigId = (...args: any[]) => wb.ownerConfigId(...args)
  const imageModelOptions = wb.imageModelOptions
  const chatModelOverride = (...args: any[]) => wb.chatModelOverride(...args)
  const chatConfigId = (...args: any[]) => wb.chatConfigId(...args)
  const visualChars = wb.visualChars
  const failedSceneImages = wb.failedSceneImages
  const isPendingSceneImage = (...args: any[]) => wb.isPendingSceneImage(...args)
  const pendingSceneImageIds = wb.pendingSceneImageIds
  const scenes = wb.scenes
  const failedPropImages = wb.failedPropImages
  const isPendingPropImage = (...args: any[]) => wb.isPendingPropImage(...args)
  const pendingPropImageIds = wb.pendingPropImageIds
  const propItems = wb.propItems
  const dramaId = wb.dramaId

function watchAsyncResult(check, attempts = 24, delay = 2500) {
  void (async () => {
    for (let i = 0; i < attempts; i++) {
      await sleepVisible(delay)
      await refreshAssets()
      if (check()) return
    }
  })()
}

// 按任务状态跟踪图片生成：失败即时清掉「生成中」并切失败徽标（替代等图片存在性轮询超时）
function watchImageTasks(pairs, pendingRef, failedRef, attempts = 96) {
  if (!pairs.length) return
  void (async () => {
    let left = [...pairs] // [[assetId, taskId], ...]
    for (let i = 0; i < attempts && left.length; i++) {
      await sleep(2500)
      const states = await Promise.all(left.map(([, tid]) => taskAPI.get(tid).catch(() => null)))
      const finishedIdx = left.map((_, idx) => idx).filter(idx => states[idx] && states[idx].status !== 'processing')
      if (!finishedIdx.length) continue
      let failed = 0
      const doneSet = new Set(finishedIdx)
      finishedIdx.forEach(idx => {
        const [aid] = left[idx]
        const st = states[idx]
        pendingRef.value = pendingRef.value.filter(x => x !== aid)
        if (st.status === 'failed') {
          failed++
          failedRef.value = { ...failedRef.value, [aid]: st.error_msg || st.errorMsg || '生成失败' }
        } else {
          const next = { ...failedRef.value }
          delete next[aid]
          failedRef.value = next
        }
      })
      left = left.filter((_, idx) => !doneSet.has(idx))
      await refreshAssets()
      if (failed) toast.error(`${failed} 个图片生成任务失败，可点击资产「重试」重新生成`)
    }
  })()
}

// 批量提交图片生成并接管后续状态：未入队资产即时标失败，已入队的按任务态跟踪到终态
function startBatchImages(call, ids, pendingRef, failedRef, attempts = 144) {
  pendingRef.value = [...new Set([...pendingRef.value, ...ids])]
  call.then(async res => {
    const items = res?.items || []
    const started = new Set(items.map(it => it.asset_id))
    // 未能提交（提示词阶段失败等）的资产：立即退出「生成中」并标记失败，避免卡死转圈
    const missed = ids.filter(id => !started.has(id))
    if (missed.length) {
      pendingRef.value = pendingRef.value.filter(x => !missed.includes(x))
      const next = { ...failedRef.value }
      missed.forEach(id => { next[id] = '提交失败，请重试' })
      failedRef.value = next
      toast.error(`${missed.length} 个资产提交失败，请点击重试`)
    }
    await refresh()
    watchImageTasks(items.map(it => [it.asset_id, it.task_id]), pendingRef, failedRef, attempts)
  }).catch(e => {
    pendingRef.value = pendingRef.value.filter(x => !ids.includes(x))
    toast.error(e.message)
  })
}

async function genCharImg(id) {
  try {
    if (failedCharImages.value[id]) {
      const next = { ...failedCharImages.value }; delete next[id]; failedCharImages.value = next
    }
    if (!isPendingCharImage(id)) pendingCharImageIds.value.push(id)
    const char = chars.value.find(c => c.id === id)
    if (char && !(char.final_prompt || char.finalPrompt)) {
      toast.info('正在生成最终提示词…')
      try {
        await ensureAssetPrompt('character', id)
      } catch {} // 提示词生成失败不阻断：后端生图前会再兜底生成或回退本地拼接
    }
    const res = await characterAPI.generateImage(id, epId.value, bareModelName(imageModel.value) || undefined, ownerConfigId(imageModelOptions.value, imageModel.value), chatModelOverride(), chatConfigId())
    toast.success('角色图片生成中')
    await refresh()
    if (res?.image_generation_id) {
      watchImageTasks([[id, res.image_generation_id]], pendingCharImageIds, failedCharImages)
    } else {
      watchAsyncResult(() => {
        const c = chars.value.find(x => x.id === id)
        const done = !!(c?.image_url || c?.imageUrl)
        if (done) pendingCharImageIds.value = pendingCharImageIds.value.filter(item => item !== id)
        return done
      })
    }
  } catch (e) {
    pendingCharImageIds.value = pendingCharImageIds.value.filter(item => item !== id)
    failedCharImages.value = { ...failedCharImages.value, [id]: e.message }
    toast.error(e.message)
  }
}
function batchCharImages() {
  const ids = visualChars.value.filter(c => !(c.image_url || c.imageUrl)).map(c => c.id)
  if (!ids.length) { toast.info('所有角色图片已生成'); return }
  startBatchImages(characterAPI.batchImages(ids, epId.value, bareModelName(imageModel.value) || undefined, ownerConfigId(imageModelOptions.value, imageModel.value), chatModelOverride(), chatConfigId()), ids, pendingCharImageIds, failedCharImages)
  toast.success('角色图片批量生成中')
}
async function genSceneImg(id) {
  try {
    if (failedSceneImages.value[id]) {
      const next = { ...failedSceneImages.value }; delete next[id]; failedSceneImages.value = next
    }
    if (!isPendingSceneImage(id)) pendingSceneImageIds.value.push(id)
    const scene = scenes.value.find(s => s.id === id)
    if (scene && !(scene.final_prompt || scene.finalPrompt)) {
      toast.info('正在生成最终提示词…')
      try {
        await ensureAssetPrompt('scene', id)
      } catch {} // 提示词生成失败不阻断：后端生图前会再兜底生成或回退本地拼接
    }
    const res = await sceneAPI.generateImage(id, epId.value, bareModelName(imageModel.value) || undefined, ownerConfigId(imageModelOptions.value, imageModel.value), chatModelOverride(), chatConfigId())
    toast.success('场景图片生成中')
    await refresh()
    if (res?.image_generation_id) {
      watchImageTasks([[id, res.image_generation_id]], pendingSceneImageIds, failedSceneImages)
    } else {
      watchAsyncResult(() => {
        const s = scenes.value.find(x => x.id === id)
        const done = !!(s?.image_url || s?.imageUrl)
        if (done) pendingSceneImageIds.value = pendingSceneImageIds.value.filter(item => item !== id)
        return done
      })
    }
  } catch (e) {
    pendingSceneImageIds.value = pendingSceneImageIds.value.filter(item => item !== id)
    failedSceneImages.value = { ...failedSceneImages.value, [id]: e.message }
    toast.error(e.message)
  }
}
async function genPropImg(id) {
  try {
    if (failedPropImages.value[id]) {
      const next = { ...failedPropImages.value }; delete next[id]; failedPropImages.value = next
    }
    if (!isPendingPropImage(id)) pendingPropImageIds.value.push(id)
    const prop = propItems.value.find(p => p.id === id)
    if (prop && !(prop.final_prompt || prop.finalPrompt)) {
      toast.info('正在生成最终提示词…')
      try {
        await ensureAssetPrompt('prop', id)
      } catch {} // 提示词生成失败不阻断：后端生图前会再兜底生成或回退本地拼接
    }
    const res = await propAPI.generateImage(id, epId.value, bareModelName(imageModel.value) || undefined, ownerConfigId(imageModelOptions.value, imageModel.value), chatModelOverride(), chatConfigId())
    toast.success('道具图片生成中')
    await refresh()
    if (res?.image_generation_id) {
      watchImageTasks([[id, res.image_generation_id]], pendingPropImageIds, failedPropImages)
    } else {
      watchAsyncResult(() => {
        const p = propItems.value.find(x => x.id === id)
        const done = !!(p?.image_url || p?.imageUrl)
        if (done) pendingPropImageIds.value = pendingPropImageIds.value.filter(item => item !== id)
        return done
      })
    }
  } catch (e) {
    pendingPropImageIds.value = pendingPropImageIds.value.filter(item => item !== id)
    failedPropImages.value = { ...failedPropImages.value, [id]: e.message }
    toast.error(e.message)
  }
}
function batchSceneImages() {
  const ids = scenes.value.filter(s => !(s.image_url || s.imageUrl)).map(s => s.id)
  if (!ids.length) { toast.info('所有场景图片已生成'); return }
  startBatchImages(sceneAPI.batchImages(ids, epId.value, bareModelName(imageModel.value) || undefined, ownerConfigId(imageModelOptions.value, imageModel.value), chatModelOverride(), chatConfigId()), ids, pendingSceneImageIds, failedSceneImages)
  toast.success('场景图片批量生成中')
}
function batchPropImages() {
  const ids = propItems.value.filter(p => !(p.image_url || p.imageUrl)).map(p => p.id)
  if (!ids.length) { toast.info('所有道具图片已生成'); return }
  startBatchImages(propAPI.batchImages(ids, epId.value, bareModelName(imageModel.value) || undefined, ownerConfigId(imageModelOptions.value, imageModel.value), chatModelOverride(), chatConfigId()), ids, pendingPropImageIds, failedPropImages)
  toast.success('道具图片批量生成中')
}

// ===== 进行中任务恢复：页面刷新后从后端重建「生成中/失败」状态，提交不作废 =====
async function restorePendingImageTasks() {
  try {
    // /tasks 已改为分页对象响应；只拉进行中/近期失败任务（大页一次取回），不再全量拉取
    const res = await taskAPI.list({ type: 'image', drama_id: dramaId, status: 'failed,processing', page_size: 200 })
    const all = res?.items || []
    const idOf = (t, snake, camel) => t[snake] ?? t[camel]

    // 近 1 小时内的失败任务：恢复「生成失败」徽标，支持一键重试（仅对尚无图片的资产）
    const FAIL_WINDOW = 60 * 60 * 1000
    let failedCount = 0
    for (const t of all) {
      if (t.status !== 'failed') continue
      const updated = Date.parse(t.updated_at || '')
      if (!updated || Date.now() - updated > FAIL_WINDOW) continue
      const msg = t.error_msg || t.errorMsg || '生成失败'
      const mark = (type, list, store) => {
        const aid = idOf(t, `${type}_id`, `${type}Id`)
        if (!aid) return
        const item = list.value.find(x => x.id === aid)
        if (!item || item.image_url || item.imageUrl || store.value[aid]) return
        store.value = { ...store.value, [aid]: msg }
        failedCount++
      }
      mark('character', chars, failedCharImages)
      mark('scene', scenes, failedSceneImages)
      mark('prop', propItems, failedPropImages)
    }
    if (failedCount) toast.warning(`恢复 ${failedCount} 个近期失败的资产生成，点击资产「重试」可重新生成`)

    const running = all.filter(t => t.status === 'processing')
    if (!running.length) return
    const cPairs = [], sPairs = [], pPairs = []
    for (const t of running) {
      const cid = idOf(t, 'character_id', 'characterId'); if (cid) cPairs.push([cid, t.id])
      const sid = idOf(t, 'scene_id', 'sceneId'); if (sid) sPairs.push([sid, t.id])
      const pid = idOf(t, 'prop_id', 'propId'); if (pid) pPairs.push([pid, t.id])
    }
    pendingCharImageIds.value = [...new Set([...pendingCharImageIds.value, ...cPairs.map(p => p[0])])]
    pendingSceneImageIds.value = [...new Set([...pendingSceneImageIds.value, ...sPairs.map(p => p[0])])]
    pendingPropImageIds.value = [...new Set([...pendingPropImageIds.value, ...pPairs.map(p => p[0])])]
    toast.info(`已恢复 ${cPairs.length + sPairs.length + pPairs.length} 个进行中的图片生成任务`)
    // 按任务态跟踪到终态：失败即时清「生成中」并提示，成功刷新展示结果（轮询上限 10 分钟）
    watchImageTasks(cPairs, pendingCharImageIds, failedCharImages, 240)
    watchImageTasks(sPairs, pendingSceneImageIds, failedSceneImages, 240)
    watchImageTasks(pPairs, pendingPropImageIds, failedPropImages, 240)
  } catch (e) {
    console.error('恢复进行中任务失败', e)
  }
}

// ===== 资产批量选择重绘 =====
  return {
    watchAsyncResult, watchImageTasks, startBatchImages, genCharImg, batchCharImages, genSceneImg, genPropImg, batchSceneImages, batchPropImages, restorePendingImageTasks,
  }
}
