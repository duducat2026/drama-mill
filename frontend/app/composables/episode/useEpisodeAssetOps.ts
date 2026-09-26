/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { characterAPI, sceneAPI, propAPI, uploadAPI } from '~/composables/useApi'

export function useEpisodeAssetOps(wb: any) {
  const visualChars = wb.visualChars
  const isPendingCharImage = (...args: any[]) => wb.isPendingCharImage(...args)
  const isFailedCharImage = (...args: any[]) => wb.isFailedCharImage(...args)
  const failedCharImages = wb.failedCharImages
  const scenes = wb.scenes
  const isPendingSceneImage = (...args: any[]) => wb.isPendingSceneImage(...args)
  const isFailedSceneImage = (...args: any[]) => wb.isFailedSceneImage(...args)
  const failedSceneImages = wb.failedSceneImages
  const propItems = wb.propItems
  const isPendingPropImage = (...args: any[]) => wb.isPendingPropImage(...args)
  const isFailedPropImage = (...args: any[]) => wb.isFailedPropImage(...args)
  const failedPropImages = wb.failedPropImages
  const genCharImg = (...args: any[]) => wb.genCharImg(...args)
  const genSceneImg = (...args: any[]) => wb.genSceneImg(...args)
  const genPropImg = (...args: any[]) => wb.genPropImg(...args)
  const openAssetDetail = (...args: any[]) => wb.openAssetDetail(...args)
  const bareModelName = (...args: any[]) => wb.bareModelName(...args)
  const imageModel = wb.imageModel
  const ownerConfigId = (...args: any[]) => wb.ownerConfigId(...args)
  const imageModelOptions = wb.imageModelOptions
  const chatModelOverride = (...args: any[]) => wb.chatModelOverride(...args)
  const chatConfigId = (...args: any[]) => wb.chatConfigId(...args)
  const startBatchImages = (...args: any[]) => wb.startBatchImages(...args)
  const epId = wb.epId
  const pendingCharImageIds = wb.pendingCharImageIds
  const pendingSceneImageIds = wb.pendingSceneImageIds
  const pendingPropImageIds = wb.pendingPropImageIds
  const pickFile = (...args: any[]) => wb.pickFile(...args)
  const refresh = (...args: any[]) => wb.refresh(...args)

const aiTaskListOpen = ref(false)
// 统一资产图片状态列表：按角色→场景→道具顺序聚合
const aiAllItems = computed(() => {
  const items = []
  for (const c of visualChars.value) {
    const has = !!(c.image_url || c.imageUrl)
    items.push({
      id: c.id, type: '角色', name: c.name,
      status: has ? 'done' : (isPendingCharImage(c.id) ? 'running' : (isFailedCharImage(c.id) ? 'failed' : 'pending')),
      error: failedCharImages.value[c.id] || undefined,
    })
  }
  for (const s of scenes.value) {
    const has = !!(s.image_url || s.imageUrl)
    items.push({
      id: s.id, type: '场景', name: s.location || s.time || `场景${s.id}`,
      status: has ? 'done' : (isPendingSceneImage(s.id) ? 'running' : (isFailedSceneImage(s.id) ? 'failed' : 'pending')),
      error: failedSceneImages.value[s.id] || undefined,
    })
  }
  for (const p of propItems.value) {
    const has = !!(p.image_url || p.imageUrl)
    items.push({
      id: p.id, type: '道具', name: p.name,
      status: has ? 'done' : (isPendingPropImage(p.id) ? 'running' : (isFailedPropImage(p.id) ? 'failed' : 'pending')),
      error: failedPropImages.value[p.id] || undefined,
    })
  }
  return items
})
const aiFailedItems = computed(() => aiAllItems.value.filter(it => it.status === 'failed'))
const aiPendingCount = computed(() => aiAllItems.value.filter(it => it.status === 'running' || it.status === 'pending').length)
const aiDoneCount = computed(() => aiAllItems.value.filter(it => it.status === 'done').length)
// 一键重试所有失败的资产图片
async function retryAllFailedImages() {
  const failed = aiFailedItems.value
  if (!failed.length) { toast.info('没有失败的图片可重试'); return }
  for (const item of failed) {
    if (item.type === '角色') genCharImg(item.id)
    else if (item.type === '场景') genSceneImg(item.id)
    else if (item.type === '道具') genPropImg(item.id)
  }
  toast.info(`开始重试 ${failed.length} 个失败的图片…`)
}

const assetSelectMode = ref(false)
const selectedCharIds = ref([])
const selectedSceneIds = ref([])
const selectedPropIds = ref([])
const assetSelectTotal = computed(() => selectedCharIds.value.length + selectedSceneIds.value.length + selectedPropIds.value.length)
const ASSET_SELECT_REF = { character: selectedCharIds, scene: selectedSceneIds, prop: selectedPropIds }

function isAssetSelected(type, id) {
  return ASSET_SELECT_REF[type].value.includes(id)
}
function toggleSelectAsset(type, id) {
  const cur = ASSET_SELECT_REF[type].value
  ASSET_SELECT_REF[type].value = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
}
function onAssetCardClick(type, item) {
  if (assetSelectMode.value) toggleSelectAsset(type, item.id)
  else openAssetDetail(type, item)
}
function selectAllAssets() {
  const allChars = visualChars.value.map(c => c.id)
  const allScenes = scenes.value.map(s => s.id)
  const allProps = propItems.value.map(p => p.id)
  const total = allChars.length + allScenes.length + allProps.length
  if (assetSelectTotal.value === total) {
    selectedCharIds.value = []; selectedSceneIds.value = []; selectedPropIds.value = []
  } else {
    selectedCharIds.value = allChars
    selectedSceneIds.value = allScenes
    selectedPropIds.value = allProps
  }
}
function exitAssetSelectMode() {
  assetSelectMode.value = false
  selectedCharIds.value = []; selectedSceneIds.value = []; selectedPropIds.value = []
}
function redrawSelectedAssets() {
  const cIds = [...selectedCharIds.value]
  const sIds = [...selectedSceneIds.value]
  const pIds = [...selectedPropIds.value]
  if (!cIds.length && !sIds.length && !pIds.length) { toast.info('请先勾选需要重绘的资产'); return }
  exitAssetSelectMode()
  const model = bareModelName(imageModel.value) || undefined
  const configId = ownerConfigId(imageModelOptions.value, imageModel.value)
  const tm = chatModelOverride(), tc = chatConfigId()

  if (cIds.length) {
    startBatchImages(characterAPI.batchImages(cIds, epId.value, model, configId, tm, tc), cIds, pendingCharImageIds, failedCharImages)
  }
  if (sIds.length) {
    startBatchImages(sceneAPI.batchImages(sIds, epId.value, model, configId, tm, tc), sIds, pendingSceneImageIds, failedSceneImages)
  }
  if (pIds.length) {
    startBatchImages(propAPI.batchImages(pIds, epId.value, model, configId, tm, tc), pIds, pendingPropImageIds, failedPropImages)
  }
  toast.success(`已提交 ${cIds.length + sIds.length + pIds.length} 个资产重绘任务`)
}
const ASSET_UPLOAD_LABELS = { character: '角色形象', scene: '场景图', prop: '道具图' }
const uploadingAssetKeys = ref([])
function isUploadingAsset(kind, id) { return uploadingAssetKeys.value.includes(`${kind}:${id}`) }
function uploadAssetImage(kind, id) {
  pickFile('image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp', async (file) => {
    const key = `${kind}:${id}`
    if (!uploadingAssetKeys.value.includes(key)) uploadingAssetKeys.value.push(key)
    try {
      const res = await uploadAPI.image(file)
      // 与生图回写保持一致：存相对路径（static/...），前端展示时补前导斜杠
      const payload = { image_url: res.path, local_path: res.path }
      if (kind === 'character') await characterAPI.update(id, payload)
      else if (kind === 'scene') await sceneAPI.update(id, payload)
      else await propAPI.update(id, payload)
      toast.success(`${ASSET_UPLOAD_LABELS[kind]}已上传`)
      await refresh()
    } catch (e) {
      toast.error(e.message)
    } finally {
      uploadingAssetKeys.value = uploadingAssetKeys.value.filter(k => k !== key)
    }
  })
}

  return {
    aiTaskListOpen, aiAllItems, aiFailedItems, aiPendingCount, aiDoneCount, retryAllFailedImages, assetSelectMode, selectedCharIds, selectedSceneIds, selectedPropIds, assetSelectTotal, ASSET_SELECT_REF, isAssetSelected, toggleSelectAsset, onAssetCardClick, selectAllAssets, exitAssetSelectMode, redrawSelectedAssets, ASSET_UPLOAD_LABELS, uploadingAssetKeys, isUploadingAsset, uploadAssetImage,
  }
}
