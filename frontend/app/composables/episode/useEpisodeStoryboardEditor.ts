/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { storyboardAPI } from '~/composables/useApi'

export function useEpisodeStoryboardEditor(wb: any) {
  const toCamel = (...args: any[]) => wb.toCamel(...args)
  const visualChars = wb.visualChars
  const scenes = wb.scenes
  const propItems = wb.propItems
  const sbs = wb.sbs
  const rawContent = wb.rawContent
  const localRaw = wb.localRaw
  const scriptContent = wb.scriptContent
  const localScript = wb.localScript
  const selectedSb = wb.selectedSb
  const assetImageSrc = (...args: any[]) => wb.assetImageSrc(...args)

function updateField(sb, field, value) {
  const current = sb[field] ?? sb[toCamel(field)]
  if (current === value) return
  sb[field] = value
  const camelField = toCamel(field)
  if (camelField !== field) sb[camelField] = value
  storyboardAPI.update(sb.id, { [field]: value }).catch(e => toast.error(e.message))
}

function getStoryboardCharacterIds(sb) {
  return sb?.character_ids || sb?.characterIds || []
}

function getStoryboardCharacters(sb) {
  const ids = getStoryboardCharacterIds(sb)
  return visualChars.value.filter(char => ids.includes(char.id))
}

function getStoryboardScene(sb) {
  const sceneId = sb?.scene_id || sb?.sceneId
  if (!sceneId) return null
  return scenes.value.find(s => s.id === sceneId) || null
}

function isStoryboardCharacterSelected(sb, charId) {
  return getStoryboardCharacterIds(sb).includes(charId)
}

function toggleStoryboardCharacter(sb, charId) {
  const currentIds = getStoryboardCharacterIds(sb)
  const nextIds = currentIds.includes(charId)
    ? currentIds.filter(id => id !== charId)
    : [...currentIds, charId]
  updateField(sb, 'character_ids', nextIds)
}

function getStoryboardPropIds(sb) {
  return sb?.prop_ids || sb?.propIds || []
}

function getStoryboardProps(sb) {
  const ids = getStoryboardPropIds(sb)
  return propItems.value.filter(p => ids.includes(p.id))
}

function isStoryboardPropSelected(sb, propId) {
  return getStoryboardPropIds(sb).includes(propId)
}

function toggleStoryboardProp(sb, propId) {
  const currentIds = getStoryboardPropIds(sb)
  const nextIds = currentIds.includes(propId)
    ? currentIds.filter(id => id !== propId)
    : [...currentIds, propId]
  updateField(sb, 'prop_ids', nextIds)
}

function getSceneName(sb) {
  const scene = getStoryboardScene(sb)
  if (!scene) return ''
  return `${scene.location} · ${scene.time || '未设时间'}`
}

const sceneOptions = computed(() => [
  { label: '未绑定场景', value: '' },
  ...scenes.value.map(s => ({ label: `${s.location} · ${s.time || '未设时间'}`, value: s.id })),
])


function sceneShotCount(sceneId) {
  return sbs.value.filter(sb => String(sb?.scene_id || sb?.sceneId || '') === String(sceneId)).length
}

watch(rawContent, v => { localRaw.value = v }, { immediate: true })
watch(scriptContent, v => { localScript.value = v }, { immediate: true })

// 轻量刷新：只重新拉取本集素材与分镜（资产图片/提示词轮询用），不重拉项目树与统计接口；保留选中分镜引用与面板初始化逻辑与全量刷新一致
const mentionOptions = computed(() => {
  const sb = selectedSb.value
  if (!sb) return []
  const scene = getStoryboardScene(sb)
  return [
    ...getStoryboardCharacters(sb).map(c => ({
      label: c.name,
      value: c.name,
      group: '角色',
      image: thumbOf(assetImageSrc(c)),
    })),
    ...(scene ? [{
      label: `${scene.location} · ${scene.time || '未设时间'}`,
      value: scene.location,
      group: '场景',
      image: thumbOf(assetImageSrc(scene)),
    }] : []),
    ...getStoryboardProps(sb).map(p => ({
      label: p.name,
      value: p.name,
      group: '道具',
      image: thumbOf(assetImageSrc(p)),
    })),
  ]
})

// 按参考图顺序（场景图在前、角色图居中、道具图在后）为 @名字 建立索引映射，供视频提示词引用替换
  return {
    updateField, getStoryboardCharacterIds, getStoryboardCharacters, getStoryboardScene, isStoryboardCharacterSelected, toggleStoryboardCharacter, getStoryboardPropIds, getStoryboardProps, isStoryboardPropSelected, toggleStoryboardProp, getSceneName, sceneOptions, sceneShotCount, mentionOptions,
  }
}
