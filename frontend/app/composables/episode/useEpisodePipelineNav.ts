/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { Users, Video, FileText, FolderKanban, Clapperboard, Download } from 'lucide-vue-next'

export function useEpisodePipelineNav(wb: any) {
  const prodTab = wb.prodTab
  const scriptContent = wb.scriptContent
  const panel = wb.panel
  const scriptStep = wb.scriptStep
  const rawContent = wb.rawContent
  const sbs = wb.sbs
  const localRaw = wb.localRaw
  const localScript = wb.localScript
  const saveRaw = (...args: any[]) => wb.saveRaw(...args)
  const saveScr = (...args: any[]) => wb.saveScr(...args)
  const visualChars = wb.visualChars
  const scenes = wb.scenes
  const propItems = wb.propItems
  const chars = wb.chars
  const mergeUrl = wb.mergeUrl

const prodTabIdx = computed({
  get: () => prodTabDefs.value.findIndex(t => t.id === prodTab.value),
  set: (v) => { prodTab.value = prodTabDefs.value[v]?.id || 'assets' },
})
const productionBlockMessage = computed(() => {
  if (!scriptContent.value) return '请先完成剧本编写'
  return ''
})
const productionBlockActionLabel = computed(() => {
  if (!scriptContent.value) return '前往剧本'
  return '返回处理'
})
function goProductionBlockTarget() {
  if (!scriptContent.value) {
    panel.value = 'script'
    scriptStep.value = rawContent.value ? 1 : 0
    return
  }
  panel.value = 'production'
  prodTab.value = 'assets'
}
const canExport = computed(() => !!sbs.value.length && shotVidCount.value === sbs.value.length)
function goNextProd() {
  if (prodTab.value === 'assets') {
    prodTab.value = 'storyboard'
    return
  }
  if (prodTab.value === 'storyboard') {
    prodTab.value = 'videos'
    return
  }
  if (prodTabIdx.value < prodTabDefs.value.length - 1) {
    prodTabIdx.value++
  } else {
    panel.value = 'export'
  }
}

// Script step navigation
const stepLabels = ['原始内容', 'AI 改写']
const prevStepLabel = computed(() => scriptStep.value > 0 ? stepLabels[scriptStep.value - 1] : '')
const nextStepLabel = computed(() => {
  if (scriptStep.value === 1) return '资产'
  return stepLabels[scriptStep.value + 1] || ''
})
const canGoNext = computed(() => {
  if (scriptStep.value === 0) return !!localRaw.value.trim()
  if (scriptStep.value === 1) return !!localScript.value.trim() || !!scriptContent.value
  return false
})
function goPrevStep() { if (scriptStep.value > 0) scriptStep.value-- }
function goNextStep() {
  if (scriptStep.value === 0 && localRaw.value.trim()) {
    saveRaw()
    scriptStep.value = 1
    return
  }
  if (scriptStep.value === 1 && canGoNext.value) {
    if (localScript.value.trim()) saveScr()
    panel.value = 'production'
    prodTab.value = 'assets'
  }
}

const charImgCount = computed(() => visualChars.value.filter(c => c.image_url || c.imageUrl).length)
const sceneImgCount = computed(() => scenes.value.filter(s => s.image_url || s.imageUrl).length)
const propImgCount = computed(() => propItems.value.filter(p => p.image_url || p.imageUrl).length)
const shotVidCount = computed(() => sbs.value.filter(s => s.video_url || s.videoUrl).length)
const visualCharTotal = computed(() => visualChars.value.length)
const pendingCharacterImageCount = computed(() => Math.max(visualCharTotal.value - charImgCount.value, 0))
const pendingSceneImageCount = computed(() => Math.max(scenes.value.length - sceneImgCount.value, 0))
const pendingAssetImageCount = computed(() => pendingCharacterImageCount.value + pendingSceneImageCount.value)
const assetTotalCount = computed(() => visualCharTotal.value + scenes.value.length + propItems.value.length)
const assetReadyCount = computed(() => charImgCount.value + sceneImgCount.value + propImgCount.value)

const prodTabDefs = computed(() => [
  { id: 'assets', label: '资产', icon: FolderKanban, badge: assetTotalCount.value ? `${assetReadyCount.value}/${assetTotalCount.value}` : '' },
  { id: 'storyboard', label: '分镜拆分', icon: Clapperboard, badge: sbs.value.length ? `${sbs.value.length}` : '' },
  { id: 'videos', label: '视频生成', icon: Video, badge: shotVidCount.value ? `${shotVidCount.value}/${sbs.value.length}` : '' },
])

const mainStageDefs = [
  { id: 'script', label: '剧本', desc: '内容改写与整理', icon: FileText },
  { id: 'assets', label: '资产', desc: '角色 / 场景 / 道具', icon: FolderKanban },
  { id: 'storyboard', label: '分镜', desc: '分镜拆分与提示词', icon: Clapperboard },
  { id: 'videos', label: '视频', desc: '视频任务与生成', icon: Video },
  { id: 'export', label: '导出', desc: '拼接与成片输出', icon: Download },
]

const sidebarSections = computed(() => ([
  {
    id: 'script',
    label: '剧本',
    items: [
      { key: 'script:raw', label: '原始内容', desc: '', icon: FileText },
      { key: 'script:rewrite', label: 'AI 改写', desc: '', icon: FileText },
    ],
  },
  {
    id: 'production',
    label: '制作',
    items: [
      { key: 'prod:assets', label: '资产', desc: '', icon: Users },
      { key: 'prod:storyboard', label: '分镜拆分', desc: '', icon: Clapperboard },
      { key: 'prod:videos', label: '视频生成', desc: '', icon: Video },
    ],
  },
  {
    id: 'export',
    label: '导出',
    items: [
      { key: 'export:merge', label: '拼接导出', desc: '', icon: Download },
    ],
  },
]))

// 大环节状态:pending(未开始)/ active(进行中)/ done(已完成)/ none(不显示状态,导出用)
// 进行中 = 环节内有任意进度但未全部完成,或当前正处于该环节
function sectionState(sectionId) {
  if (sectionId === 'export') return 'none'
  const done = sectionId === 'script'
    ? mainStageDone('script')
    : mainStageDone('assets') && mainStageDone('storyboard') && mainStageDone('videos')
  if (done) return 'done'

  const hasProgress = sectionId === 'script'
    ? !!(rawContent.value || scriptContent.value)
    : !!(chars.value.length || scenes.value.length || propItems.value.length || sbs.value.length || shotVidCount.value)
  const isCurrent = sectionId === 'script'
    ? panel.value === 'script'
    : panel.value === 'production'
  return (hasProgress || isCurrent) ? 'active' : 'pending'
}

const activeMainStage = computed(() => {
  if (panel.value === 'export') return 'export'
  if (panel.value === 'production') {
    if (prodTab.value === 'assets') return 'assets'
    if (prodTab.value === 'storyboard') return 'storyboard'
    return 'videos'
  }
  return 'script'
})

function mainStageDone(stageId) {
  if (stageId === 'script') return !!scriptContent.value
  if (stageId === 'assets') return assetTotalCount.value > 0 && assetReadyCount.value === assetTotalCount.value
  if (stageId === 'videos') {
    return !!sbs.value.length && shotVidCount.value === sbs.value.length
  }
  if (stageId === 'storyboard') return !!sbs.value.length
  if (stageId === 'export') return !!mergeUrl.value
  return false
}

function goMainStage(stageId) {
  if (stageId === 'script') {
    panel.value = 'script'
    scriptStep.value = Math.min(scriptStep.value, 1)
    return
  }
  if (stageId === 'assets') {
    panel.value = 'production'
    prodTab.value = 'assets'
    return
  }
  if (stageId === 'videos') {
    panel.value = 'production'
    prodTab.value = 'videos'
    return
  }
  if (stageId === 'storyboard') {
    panel.value = 'production'
    prodTab.value = 'storyboard'
    return
  }
  panel.value = 'export'
}

const activeSubStepKey = computed(() => {
  if (panel.value === 'script') {
    if (scriptStep.value === 0) return 'script:raw'
    return 'script:rewrite'
  }
  if (panel.value === 'production') return `prod:${prodTab.value}`
  return 'export:merge'
})

const sidebarJumpSteps = computed(() => {
  const section = sidebarSections.value.find((item) => item.items.some(step => step.key === activeSubStepKey.value))
  return section?.items || []
})

const bubbleSteps = computed(() => {
  if (panel.value === 'script') {
    return [
      { key: 'script:raw', label: '原始内容' },
      { key: 'script:rewrite', label: 'AI 改写' },
    ]
  }
  if (panel.value === 'production') {
    return prodTabDefs.value.map(step => ({
      key: `prod:${step.id}`,
      label: step.label,
    }))
  }
  return []
})

const activeBubbleKey = computed(() => {
  if (panel.value === 'script') return activeSubStepKey.value
  if (panel.value === 'production') return `prod:${prodTab.value}`
  return ''
})

const showBottomBubble = computed(() => panel.value === 'script' || panel.value === 'production')

function goSubStep(key) {
  if (key.startsWith('script:')) {
    panel.value = 'script'
    const stepMap = {
      'script:raw': 0,
      'script:rewrite': 1,
    }
    scriptStep.value = stepMap[key] ?? 0
    return
  }
  if (key.startsWith('prod:')) {
    panel.value = 'production'
    prodTab.value = key.replace('prod:', '')
    return
  }
  panel.value = 'export'
}

const pipelineTotal = 2
const pipelineProgress = computed(() =>
  ['script', 'production'].filter(id => sectionState(id) === 'done').length
)

const currentStageLabel = computed(() => {
  if (panel.value === 'script') return `剧本阶段 · ${stepLabels[scriptStep.value]}`
  if (panel.value === 'production') return `制作阶段 · ${prodTabDefs.value[prodTabIdx.value]?.label || '制作'}`
  return mergeUrl.value ? '导出阶段 · 成片已生成' : '导出阶段 · 等待拼接'
})

const currentMainStageLabel = computed(() => {
  const current = mainStageDefs.find(stage => stage.id === activeMainStage.value)
  return current?.label || '工作台'
})

const currentSubStageLabel = computed(() => currentStageLabel.value)

  return {
    productionBlockMessage, productionBlockActionLabel, goProductionBlockTarget, canExport, goNextProd, stepLabels, prevStepLabel, nextStepLabel, canGoNext, goPrevStep, goNextStep, charImgCount, sceneImgCount, propImgCount, shotVidCount, visualCharTotal, pendingCharacterImageCount, pendingSceneImageCount, pendingAssetImageCount, assetTotalCount, assetReadyCount, prodTabDefs, mainStageDefs, sidebarSections, sectionState, activeMainStage, mainStageDone, goMainStage, activeSubStepKey, sidebarJumpSteps, bubbleSteps, activeBubbleKey, showBottomBubble, goSubStep, pipelineTotal, pipelineProgress, currentStageLabel, currentMainStageLabel, currentSubStageLabel, prodTabIdx,
  }
}
