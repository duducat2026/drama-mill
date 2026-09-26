// useNovelWizard — 导入文档向导（NovelImportWizard.vue）的全部步骤状态与逻辑，由超限文件拆分外提。
// 组件仅保留模板与薄封装（解构本 composable 返回值），emit 经参数注入，navigateTo/onMounted 等由 Nuxt 自动导入。
import { toast } from 'vue-sonner'
import { dramaAPI, novelAPI, novelSplitTemplateAPI, productionAPI, productionBatchAPI, stylePresetAPI } from '~/composables/useApi'

export const STEP_TITLES = ['创建项目并上传小说', 'AI 自动分集', '启动自动化生产']

export function useNovelWizard(emit) {
  const step = ref(1)
  const busy = ref(false)
  const file = ref(null)
  const files = ref([])
  const isBatch = computed(() => files.value.length > 1)
  const form = ref({ title: '', style: '', aspect_ratio: '16:9' })
  const stylePresets = ref([])
  const styleSelectOptions = computed(() => stylePresets.value.map(p => ({ label: p.name, value: p.value })))
  const selectedStyleDesc = computed(() => stylePresets.value.find(p => p.value === form.value.style)?.description || '')
  const aspectRatioOptions = [
    { label: '16:9 · 横屏', value: '16:9' },
    { label: '9:16 · 竖屏', value: '9:16' },
    { label: '1:1 · 方形', value: '1:1' },
    { label: '自适应', value: 'adaptive' },
  ]

  const dramaId = ref(null)
  const novel = ref(null)
  const existingEpisodes = ref(0)
  const targetChars = ref(15000)
  const splitTemplates = ref([])
  const splitTemplateId = ref(0)
  const splitTemplateOptions = computed(() => [
    { label: '默认 · 规则拆分', value: 0 },
    ...splitTemplates.value.filter(t => t.is_active).map(t => ({ label: t.is_system ? `${t.name}（系统）` : t.name, value: t.id })),
  ])
  // 选模版时未改过字数则预填模版建议值；切回默认恢复 15000；段落模式模版（诗词/笑话）不预填字数
  watch(splitTemplateId, (id) => {
    const tpl = splitTemplates.value.find(t => t.id === id)
    if (tpl?.split_mode === 'paragraphs') return // 段落模式按段落数归组，字数不生效
    if (tpl?.default_target_chars) targetChars.value = tpl.default_target_chars
    else if (!id) targetChars.value = 15000
  })
  // 当前选中模版是否按段落数量拆分（诗词一首/笑话一则即一段）；批量与单部共用同一模版选择
  const splitting = ref(false)
  const splitProgress = ref('')
  const splitError = ref('')
  const preview = ref([])
  const autoStart = ref(true)
  // 批量模式两步走：split_only 先拆分入库停下待确认，再经批次面板启动生产；默认推荐两步走
  const fromEpisodeNumber = ref(1)
  let pollTimer = null
  const batchMode = ref('split_only')
  const selectedSplitTpl = computed(() => splitTemplates.value.find(t => t.id === splitTemplateId.value) || null)
  const batchTplIsParagraphs = computed(() => isBatch.value && selectedSplitTpl.value?.split_mode === 'paragraphs')
  const batchTplParagraphs = computed(() => selectedSplitTpl.value?.default_paragraphs || 20)
  const singleTplIsParagraphs = computed(() => !isBatch.value && selectedSplitTpl.value?.split_mode === 'paragraphs')
  const singleTplParagraphs = computed(() => selectedSplitTpl.value?.default_paragraphs || 20)

  const estimatedEpisodes = computed(() => {
    const chars = novel.value?.char_count || 0
    return targetChars.value > 0 ? Math.max(1, Math.ceil(chars / targetChars.value)) : 0
  })

  function onPickFile(e) {
    files.value = Array.from(e.target.files || [])
    file.value = files.value[0] || null
    if (file.value && !form.value.title) {
      form.value.title = file.value.name.replace(/\.[^.]+$/, '')
    }
  }

  // 批量模式：多文件一次提交，后端逐个建剧入库组成批次；
  // 两步走（默认）：先拆分入库停下待确认，生产由用户在批次面板确认后启动
  async function createBatch() {
    if (!files.value.length) { toast.warning('请选择小说文件'); return }
    busy.value = true
    try {
      const res = await productionBatchAPI.upload(files.value, {
        style: form.value.style,
        aspect_ratio: form.value.aspect_ratio,
        target_chars: targetChars.value,
        split_template_id: splitTemplateId.value || undefined,
        mode: batchMode.value,
        auto_start: batchMode.value === 'full',
      })
      emit('created')
      emit('batch-created', res.batch_id)
      if (res.errors?.length) toast.warning(`${res.errors.length} 个文件上传失败：${res.errors.map(e => e.file_name).join('、')}`)
      if (batchMode.value === 'split_only') {
        toast.success(`批次已创建并开始拆分：${res.uploaded.length} 部小说拆分完成后停下，请在批量生产面板确认并启动生产`)
      } else {
        toast.success(`批次已创建并启动：${res.uploaded.length} 部小说将按顺序拆分并生产`)
      }
      emit('close')
    } catch (e) {
      toast.error(e.message)
    } finally {
      busy.value = false
    }
  }

  async function createAndUpload() {
    if (!file.value) { toast.warning('请选择小说文件'); return }
    busy.value = true
    try {
      const drama = await dramaAPI.create({ title: form.value.title, style: form.value.style, aspect_ratio: form.value.aspect_ratio })
      dramaId.value = drama.id
      emit('created', drama)
      novel.value = await novelAPI.upload(file.value, drama.id, form.value.title)
      const detail = await dramaAPI.get(drama.id)
      existingEpisodes.value = detail?.episodes?.length || 0
      fromEpisodeNumber.value = (existingEpisodes.value || 0) + 1
      step.value = 2
      toast.success(`已上传：${(novel.value.char_count || 0).toLocaleString()} 字 · ${novel.value.chapter_count || 0} 章`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      busy.value = false
    }
  }

  async function startSplit() {
    splitting.value = true
    splitError.value = ''
    try {
      await novelAPI.split(novel.value.id, targetChars.value, splitTemplateId.value || undefined)
      pollSplit()
    } catch (e) {
      splitting.value = false
      splitError.value = e.message
    }
  }

  function pollSplit() {
    clearTimeout(pollTimer)
    const tick = async () => {
      try {
        const st = await novelAPI.splitStatus(novel.value.id)
        splitProgress.value = st.progress || ''
        if (st.status === 'split') {
          splitting.value = false
          preview.value = st.created_episodes || []
          fromEpisodeNumber.value = preview.value[0]?.episode_number || 1
          toast.success(`拆分完成：${preview.value.length} 集`)
          return
        }
        if (st.status === 'failed') {
          splitting.value = false
          splitError.value = st.error || '拆分失败'
          return
        }
        pollTimer = setTimeout(tick, 2500)
      } catch (e) {
        pollTimer = setTimeout(tick, 4000)
      }
    }
    pollTimer = setTimeout(tick, 1500)
  }

  function goDetail() {
    navigateTo(`/drama/${dramaId.value}`)
    emit('close')
  }

  async function finish() {
    busy.value = true
    try {
      if (autoStart.value) {
        await productionAPI.start(dramaId.value, fromEpisodeNumber.value)
        toast.success('自动生产已启动，可在项目页查看进度')
      }
      navigateTo(`/drama/${dramaId.value}`)
      emit('close')
    } catch (e) {
      toast.error(e.message)
      busy.value = false
    }
  }

  function close() {
    emit('close')
  }

  onMounted(async () => {
    try {
      stylePresets.value = await stylePresetAPI.list()
      if (stylePresets.value.length) form.value.style = stylePresets.value[0].value
    } catch {}
    try {
      splitTemplates.value = await novelSplitTemplateAPI.list()
    } catch {}
  })

  onBeforeUnmount(() => clearTimeout(pollTimer))

  return {
    step, busy, file, files, isBatch, form, stylePresets, styleSelectOptions, selectedStyleDesc, aspectRatioOptions,
    dramaId, novel, existingEpisodes, targetChars, splitTemplates, splitTemplateId, splitTemplateOptions,
    splitting, splitProgress, splitError, preview, autoStart, fromEpisodeNumber, batchMode,
    selectedSplitTpl, batchTplIsParagraphs, batchTplParagraphs, singleTplIsParagraphs, singleTplParagraphs, estimatedEpisodes,
    onPickFile, createBatch, createAndUpload, startSplit, goDetail, finish, close,
  }
}
