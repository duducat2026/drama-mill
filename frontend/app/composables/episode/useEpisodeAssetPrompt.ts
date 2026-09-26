/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { characterAPI, sceneAPI, propAPI } from '~/composables/useApi'

export function useEpisodeAssetPrompt(wb: any) {
  const assetPromptDraft = wb.assetPromptDraft
  const assetPromptDirty = wb.assetPromptDirty
  const assetDetail = wb.assetDetail
  const chars = wb.chars
  const scenes = wb.scenes
  const propItems = wb.propItems
  const isPendingCharImage = (...args: any[]) => wb.isPendingCharImage(...args)
  const isPendingSceneImage = (...args: any[]) => wb.isPendingSceneImage(...args)
  const isPendingPropImage = (...args: any[]) => wb.isPendingPropImage(...args)
  const epId = wb.epId
  const chatModelOverride = (...args: any[]) => wb.chatModelOverride(...args)
  const chatConfigId = (...args: any[]) => wb.chatConfigId(...args)

function onAssetPromptInput(event) {
  assetPromptDraft.value = event.target.value
  assetPromptDirty.value = true
}

const assetFinalPrompt = computed(() => {
  const item = assetDetail.value?.item
  return item?.final_prompt || item?.finalPrompt || ''
})

/** 把生成好的最终提示词同步到列表项与弹窗项 */
function applyFinalPrompt(type, id, fp) {
  const patch = { final_prompt: fp, finalPrompt: fp }
  const list = type === 'character' ? chars.value : type === 'scene' ? scenes.value : propItems.value
  const target = list.find(x => x.id === id)
  if (target) Object.assign(target, patch)
  if (assetDetail.value.open && assetDetail.value.type === type && assetDetail.value.item?.id === id) {
    Object.assign(assetDetail.value.item, patch)
  }
}

const generatingPromptKeys = ref([])

function isGeneratingPrompt(type, id) {
  return generatingPromptKeys.value.includes(`${type}:${id}`)
}

/** 该资产图片是否在外层「生成」流程中（含提示词阶段与生图阶段） */
function isAssetImagePending(type, id) {
  return type === 'character' ? isPendingCharImage(id) : type === 'scene' ? isPendingSceneImage(id) : isPendingPropImage(id)
}

/**
 * 生成最终提示词（弹窗按钮与外层两段式生图共用同一 key 状态，避免重复触发）
 * force=true 时忽略已有提示词强制重新生成
 * 返回最终提示词；生成失败由接口抛错，Agent 返回空时返回 ''
 */
async function ensureAssetPrompt(type, id, force = false) {
  const key = `${type}:${id}`
  if (generatingPromptKeys.value.includes(key)) return ''
  generatingPromptKeys.value.push(key)
  try {
    const res = type === 'character'
      ? await characterAPI.generatePrompt(id, epId.value, force, chatModelOverride(), chatConfigId())
      : type === 'scene'
        ? await sceneAPI.generatePrompt(id, epId.value, force, chatModelOverride(), chatConfigId())
        : await propAPI.generatePrompt(id, epId.value, force, chatModelOverride(), chatConfigId())
    const fp = res?.final_prompt || res?.finalPrompt || ''
    if (fp) applyFinalPrompt(type, id, fp)
    return fp
  } finally {
    generatingPromptKeys.value = generatingPromptKeys.value.filter(k => k !== key)
  }
}

/** 弹窗内生成最终提示词（不生图）；已有最终提示词时重新生成（force） */
async function genAssetFinalPrompt() {
  const detail = assetDetail.value
  if (!detail.open || !detail.item?.id) return
  const force = !!assetFinalPrompt.value
  try {
    const fp = await ensureAssetPrompt(detail.type, detail.item.id, force)
    if (!fp) throw new Error('最终提示词生成失败，请重试')
    assetPromptDraft.value = fp
    assetPromptDirty.value = false
    toast.success(force ? '最终提示词已重新生成' : '最终提示词已生成')
  } catch (e) {
    toast.error(e.message || '最终提示词生成失败')
  }
}

async function copyAssetFinalPrompt() {
  const text = assetPromptDraft.value || assetFinalPrompt.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success('最终提示词已复制')
  } catch {
    toast.error('复制失败，请手动选择文本复制')
  }
}

  return {
    assetFinalPrompt, applyFinalPrompt, generatingPromptKeys, isGeneratingPrompt, isAssetImagePending, ensureAssetPrompt, genAssetFinalPrompt, copyAssetFinalPrompt, onAssetPromptInput,
  }
}
