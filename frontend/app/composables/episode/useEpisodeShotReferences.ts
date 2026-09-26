/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { toast } from 'vue-sonner'
import { uploadAPI } from '~/composables/useApi'

export function useEpisodeShotReferences(wb: any) {
  const getStoryboardScene = (...args: any[]) => wb.getStoryboardScene(...args)
  const getStoryboardCharacters = (...args: any[]) => wb.getStoryboardCharacters(...args)
  const getStoryboardProps = (...args: any[]) => wb.getStoryboardProps(...args)
  const visualChars = wb.visualChars
  const getStoryboardCharacterIds = (...args: any[]) => wb.getStoryboardCharacterIds(...args)
  const scenes = wb.scenes
  const propItems = wb.propItems
  const getStoryboardPropIds = (...args: any[]) => wb.getStoryboardPropIds(...args)
  const selectedSb = wb.selectedSb
  const updateField = (...args: any[]) => wb.updateField(...args)
  const toggleStoryboardCharacter = (...args: any[]) => wb.toggleStoryboardCharacter(...args)
  const toggleStoryboardProp = (...args: any[]) => wb.toggleStoryboardProp(...args)
  const pickFile = (...args: any[]) => wb.pickFile(...args)

const videoRefVideoUrls = ref([])
const videoRefAudioUrls = ref([])
const videoRefImageUrls = ref([])
const videoDuration = ref(10)
const uploadingRefMedia = ref(false)
function getShotReferenceImages(sb) {
  const refs = []
  const pushRef = (value) => {
    if (!value || refs.includes(value) || refs.length >= 9) return
    refs.push(value)
  }
  const scene = getStoryboardScene(sb)
  pushRef(scene?.image_url || scene?.imageUrl)
  for (const char of getStoryboardCharacters(sb)) {
    pushRef(char?.image_url || char?.imageUrl)
  }
  for (const prop of getStoryboardProps(sb)) {
    pushRef(prop?.image_url || prop?.imageUrl)
  }
  // 手动上传的参考图片追加到尾部（总计 ≤9）
  for (const url of videoRefImageUrls.value) pushRef(url)
  return refs
}

function getShotReferenceAssets(sb) {
  const assets = []
  const scene = getStoryboardScene(sb)
  if (scene) {
    const imageUrl = scene.image_url || scene.imageUrl || ''
    assets.push({
      key: `scene-${scene.id}`,
      type: '场景',
      name: scene.location || '未命名场景',
      meta: scene.time || '场景图',
      imageUrl,
      ready: !!imageUrl,
    })
  }
  for (const char of getStoryboardCharacters(sb)) {
    const imageUrl = char.image_url || char.imageUrl || ''
    assets.push({
      key: `character-${char.id}`,
      type: '角色',
      name: char.name || '未命名角色',
      meta: char.role || '角色形象',
      imageUrl,
      ready: !!imageUrl,
    })
  }
  for (const prop of getStoryboardProps(sb)) {
    const imageUrl = prop.image_url || prop.imageUrl || ''
    assets.push({
      key: `prop-${prop.id}`,
      type: '道具',
      name: prop.name || '未命名道具',
      meta: prop.type || '道具单品图',
      imageUrl,
      ready: !!imageUrl,
    })
  }
  return assets.slice(0, 6)
}

// 右侧参考素材面板：本集全部可绑定素材（场景单选、角色/道具多选），bound 标记是否已绑定
function shotBindableAssets(sb) {
  const out = []
  for (const char of visualChars.value) {
    const imageUrl = char.image_url || char.imageUrl || ''
    out.push({
      key: `character-${char.id}`,
      id: char.id,
      type: '角色',
      name: char.name || '未命名角色',
      meta: char.role || '角色形象',
      imageUrl,
      ready: !!imageUrl,
      bound: getStoryboardCharacterIds(sb).includes(char.id),
    })
  }
  for (const scene of scenes.value) {
    const imageUrl = scene.image_url || scene.imageUrl || ''
    out.push({
      key: `scene-${scene.id}`,
      id: scene.id,
      type: '场景',
      name: `${scene.location} · ${scene.time || '未设时间'}`,
      meta: scene.time || '场景图',
      imageUrl,
      ready: !!imageUrl,
      bound: (sb?.scene_id || sb?.sceneId) === scene.id,
    })
  }
  for (const prop of propItems.value) {
    const imageUrl = prop.image_url || prop.imageUrl || ''
    out.push({
      key: `prop-${prop.id}`,
      id: prop.id,
      type: '道具',
      name: prop.name || '未命名道具',
      meta: prop.type || '道具单品图',
      imageUrl,
      ready: !!imageUrl,
      bound: getStoryboardPropIds(sb).includes(prop.id),
    })
  }
  // 固定顺序（角色→场景→道具，按资产原顺序）：点击绑定/解绑不重排，避免跳动
  return out
}

// 右侧参考素材面板渲染用：当前分镜可绑定的全部素材
const refBindableAssets = computed(() => {
  const sb = selectedSb.value
  return sb ? shotBindableAssets(sb) : []
})

// 右侧面板切换绑定：场景单选（切换/解绑），角色/道具多选
function toggleShotBind(sb, asset) {
  if (asset.type === '场景') {
    const current = sb?.scene_id || sb?.sceneId
    updateField(sb, 'scene_id', current === asset.id ? null : asset.id)
    return
  }
  if (asset.type === '角色') {
    toggleStoryboardCharacter(sb, asset.id)
    return
  }
  toggleStoryboardProp(sb, asset.id)
}

// 场景/角色/道具自动绑定占用的参考图片槽位（按素材卡片数，最多 9）
const autoReferenceImageCount = computed(() => {
  const sb = selectedSb.value
  if (!sb) return 0
  let count = 0
  if (getStoryboardScene(sb)) count += 1
  count += getStoryboardCharacters(sb).length
  count += getStoryboardProps(sb).length
  return Math.min(count, 9)
})

// 已占用的参考图片数（场景/角色素材 + 手动上传），展示为 n/9
const refImageUsedCount = computed(() => Math.min(9, autoReferenceImageCount.value + videoRefImageUrls.value.length))
// 是否已达 9 张上限（禁用继续上传）
const refImageFull = computed(() => refImageUsedCount.value >= 9)

// 视频提示词 @ 引用候选：仅当前分镜已绑定的角色与道具（按名字引用）、场景（按地点引用），展示顺序：角色 → 场景 → 道具
function getShotReferenceIndexMap(sb) {
  const ordered = []
  const seen = new Set()
  const push = (name, url) => {
    if (!url || seen.has(url) || ordered.length >= 9) return
    seen.add(url)
    ordered.push({ name, imageUrl: url })
  }
  const scene = getStoryboardScene(sb)
  push(scene?.location || '', scene?.image_url || scene?.imageUrl)
  for (const char of getStoryboardCharacters(sb)) {
    push(char.name || '', char?.image_url || char?.imageUrl)
  }
  for (const prop of getStoryboardProps(sb)) {
    push(prop.name || '', prop?.image_url || prop?.imageUrl)
  }
  const nameToIndex = {}
  ordered.forEach((a, i) => { if (a.name && !(a.name in nameToIndex)) nameToIndex[a.name] = i + 1 })
  return nameToIndex
}

// 将视频提示词里的 @名字 替换为 @图片N名字（N 为参考图序号，1 起），生成时使用
function resolveVideoPromptRefs(sb) {
  const prompt = sb.video_prompt || sb.videoPrompt || ''
  const map = getShotReferenceIndexMap(sb)
  const names = Object.keys(map).sort((a, b) => b.length - a.length)
  if (!names.length) return prompt
  return prompt.replace(/@([^\s@]+)/g, (m, raw) => {
    for (const name of names) {
      if (raw.startsWith(name)) {
        return `@图片${map[name]}${name}${raw.slice(name.length)}`
      }
    }
    return m
  })
}

// 切换选中分镜时重置视频生成面板
watch(selectedSb, (sb) => {
  videoRefVideoUrls.value = []
  videoRefAudioUrls.value = []
  videoRefImageUrls.value = []
  videoDuration.value = Number(sb?.duration || 10)
})

function uploadRefMedia(kind) {
  if (kind === 'image') {
    if (refImageFull.value) { toast.info('参考图片已达上限（含场景/角色素材）'); return }
    pickFile('image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp', async (file) => {
      uploadingRefMedia.value = true
      try {
        const res = await uploadAPI.image(file)
        videoRefImageUrls.value = [...videoRefImageUrls.value, res.url]
        toast.success('参考图片已上传')
      } catch (e) { toast.error(e.message) } finally { uploadingRefMedia.value = false }
    })
    return
  }
  const isVideo = kind === 'video'
  const list = isVideo ? videoRefVideoUrls : videoRefAudioUrls
  const label = isVideo ? '视频' : '音频'
  if (list.value.length >= 3) { toast.info(`参考${label}最多 3 个`); return }
  const accept = isVideo ? 'video/mp4,video/quicktime,video/webm,.m4v' : 'audio/mpeg,audio/wav,audio/mp4,.aac'
  pickFile(accept, async (file) => {
    uploadingRefMedia.value = true
    try {
      const res = isVideo ? await uploadAPI.video(file) : await uploadAPI.audio(file)
      list.value = [...list.value, res.url]
      toast.success(`参考${label}已上传`)
    } catch (e) { toast.error(e.message) } finally { uploadingRefMedia.value = false }
  })
}

function removeRefMedia(kind, index) {
  const list = kind === 'image' ? videoRefImageUrls : kind === 'video' ? videoRefVideoUrls : videoRefAudioUrls
  list.value = list.value.filter((_, i) => i !== index)
}

  return {
    videoRefVideoUrls, videoRefAudioUrls, videoRefImageUrls, videoDuration, uploadingRefMedia, getShotReferenceImages, getShotReferenceAssets, shotBindableAssets, refBindableAssets, toggleShotBind, autoReferenceImageCount, refImageUsedCount, refImageFull, getShotReferenceIndexMap, resolveVideoPromptRefs, uploadRefMedia, removeRefMedia,
  }
}
