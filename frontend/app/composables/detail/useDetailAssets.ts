/*
 * Drama Mill — 项目详情「素材库」逻辑（自 views/drama/detail.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 *
 * 素材库以 characters / scenes / props 三张资产表为源；生图为异步任务，轮询轻量素材状态端点局部合并。
 */
import { toast } from 'vue-sonner'
import type { Ref } from 'vue'
import { characterAPI, dramaAPI, propAPI, sceneAPI, uploadAPI } from '~/composables/useApi'

export function useDetailAssets(dramaId: number, drama: Ref<any>, load: () => Promise<void>) {
  const assetTab = ref('all')
  const assetViewer = ref({ open: false, src: '', title: '' })
  const pendingMaterials = ref(new Set<string>())
  const assetTabs = [
    { label: '全部', value: 'all' },
    { label: '角色', value: 'character' },
    { label: '场景', value: 'scene' },
    { label: '道具', value: 'prop' },
  ]
  const KIND_ORDER: Record<string, number> = { character: 0, scene: 1, prop: 2 }

  // 素材库以 characters / scenes / props 三张资产表为源（后端生图会写回其 imageUrl）
  function matImage(m: any) { return m.image_url || m.imageUrl || m.localPath || m.local_path || '' }
  function matHasImage(m: any) { return !!matImage(m) }
  function assetSrc(m: any) {
    const raw = matImage(m)
    if (!raw) return ''
    return /^https?:\/\//i.test(raw) || raw.startsWith('/') ? raw : `/${raw}`
  }
  function matCreatedAt(m: any) { return m.created_at || m.updated_at || m.createdAt || m.updatedAt }
  function matDesc(m: any) {
    if (m.kindKey === 'character') return m.appearance || m.description || ''
    if (m.kindKey === 'scene') return m.prompt || m.description || ''
    return m.description || ''
  }
  function tagClass(kindKey: string) {
    return kindKey === 'character' ? 'is-character' : kindKey === 'scene' ? 'is-scene' : 'is-prop'
  }
  function tabLabel(v: string) { return assetTabs.find(t => t.value === v)?.label || '' }

  const materials = computed(() => {
    const d = drama.value
    if (!d) return []
    const list: any[] = []
    for (const c of d.characters || []) list.push({ ...c, kind: '角色', kindKey: 'character' })
    for (const s of d.scenes || []) list.push({ ...s, kind: '场景', kindKey: 'scene' })
    for (const p of d.props || []) list.push({ ...p, kind: '道具', kindKey: 'prop' })
    return list.sort((a, b) => (KIND_ORDER[a.kindKey] - KIND_ORDER[b.kindKey]) || (a.id - b.id))
  })
  const visibleAssets = computed(() =>
    assetTab.value === 'all' ? materials.value : materials.value.filter(m => m.kindKey === assetTab.value),
  )
  const assetTotal = computed(() => materials.value.length)
  // 按类型分组：全部模式下分成 角色 / 场景 / 道具 三个分区；筛选单类时只保留该类
  const assetGroups = computed(() => {
    const groups = [
      { kindKey: 'character', label: '角色', items: materials.value.filter(m => m.kindKey === 'character') },
      { kindKey: 'scene', label: '场景', items: materials.value.filter(m => m.kindKey === 'scene') },
      { kindKey: 'prop', label: '道具', items: materials.value.filter(m => m.kindKey === 'prop') },
    ]
    return assetTab.value === 'all'
      ? groups
      : groups.filter(g => g.kindKey === assetTab.value)
  })

  function pendingKey(m: any) { return `${m.kindKey}:${m.id}` }
  function isPending(m: any) { return pendingMaterials.value.has(pendingKey(m)) }

  function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

  async function generateMaterial(m: any) {
    const epId = drama.value?.episodes?.[0]?.id
    if (!epId) { toast.error('请先在「剧集列表」创建至少一集，才能生成素材图'); return }
    const key = pendingKey(m)
    if (pendingMaterials.value.has(key)) return
    pendingMaterials.value = new Set(pendingMaterials.value).add(key)
    try {
      if (m.kindKey === 'character') await characterAPI.generateImage(m.id, epId)
      else if (m.kindKey === 'scene') await sceneAPI.generateImage(m.id, epId)
      else await propAPI.generateImage(m.id, epId)
      toast.success(`${m.kind}「${m.name}」图片生成中`)
      pollMaterial(m)
    } catch (e: any) {
      pendingMaterials.value = new Set([...pendingMaterials.value].filter(k => k !== key))
      toast.error(e.message)
    }
  }

  // 生图为异步任务：轮询轻量素材状态端点（仅图片字段），局部合并回 drama，避免重复拉全量项目树；间隔梯度递增 3s→10s
  async function pollMaterial(m: any) {
    const key = pendingKey(m)
    const finish = () => { pendingMaterials.value = new Set([...pendingMaterials.value].filter(k => k !== key)) }
    for (let i = 0, interval = 3000; i < 30; i++) {
      await sleep(interval)
      interval = Math.min(interval + 1000, 10000)
      try {
        const st = await dramaAPI.assetsStatus(dramaId)
        const applyList = (list: any, src: any) => {
          for (const row of src || []) {
            const img = row.image_url || row.local_path
            if (img) { const t = list?.find((x: any) => x.id === row.id); if (t) { t.image_url = img; t.local_path = row.local_path || t.local_path } }
          }
        }
        const d = drama.value
        if (d) {
          applyList(d.characters, st.characters)
          applyList(d.scenes, st.scenes)
          applyList(d.props, st.props)
        }
        const list = m.kindKey === 'character' ? st.characters : m.kindKey === 'scene' ? st.scenes : st.props
        const rec = list?.find((x: any) => x.id === m.id)
        if (rec && (rec.image_url || rec.local_path)) { finish(); return }
      } catch {}
    }
    finish()
    toast.info(`${m.kind}「${m.name}」生成超时，可稍后刷新查看`)
  }

  /* ===== 素材图片手动上传（角色形象 / 场景图 / 道具图） ===== */
  const uploadingMaterials = ref(new Set<string>())
  function isUploading(m: any) { return uploadingMaterials.value.has(pendingKey(m)) }

  function uploadMaterial(m: any) {
    const key = pendingKey(m)
    if (uploadingMaterials.value.has(key)) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      uploadingMaterials.value = new Set(uploadingMaterials.value).add(key)
      try {
        const res = await uploadAPI.image(file)
        // 与生图回写保持一致：存相对路径（static/...），展示时补前导斜杠
        const payload = { image_url: res.path, local_path: res.path }
        if (m.kindKey === 'character') await characterAPI.update(m.id, payload)
        else if (m.kindKey === 'scene') await sceneAPI.update(m.id, payload)
        else await propAPI.update(m.id, payload)
        toast.success(`${m.kind}「${m.name}」图片已上传`)
        await load()
        // 详情弹窗打开时同步刷新预览
        if (editTarget.value && editTarget.value.kindKey === m.kindKey && editTarget.value.id === m.id) {
          editTarget.value = { ...editTarget.value, image_url: res.path, local_path: res.path }
        }
      } catch (e: any) {
        toast.error(e.message)
      } finally {
        uploadingMaterials.value = new Set([...uploadingMaterials.value].filter(k => k !== key))
      }
    }
    input.click()
  }

  function openAssetViewer(m: any) {
    assetViewer.value = { open: true, src: assetSrc(m), title: `${m.kind} · ${m.name}` }
  }
  function closeAssetViewer() {
    assetViewer.value = { open: false, src: '', title: '' }
  }

  function fmtDate(s: any) {
    if (!s) return ''
    const d = new Date(s)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  /* ===== 素材信息编辑 ===== */
  const editDialog = ref(false)
  const editSaving = ref(false)
  const editTarget = ref<any>(null)
  const editDraft = reactive<Record<string, any>>({})

  function openEdit(m: any) {
    editTarget.value = m
    // 按类型初始化 draft
    Object.keys(editDraft).forEach(k => delete editDraft[k])
    if (m.kindKey === 'character') {
      Object.assign(editDraft, { name: m.name || '', role: m.role || '', appearance: m.appearance || '', description: m.description || '', styling: m.styling || '' })
    } else if (m.kindKey === 'scene') {
      Object.assign(editDraft, { location: m.location || '', time: m.time || '', prompt: m.prompt || '', lighting: m.lighting || '' })
    } else {
      Object.assign(editDraft, { name: m.name || '', type: m.type || '', description: m.description || '' })
    }
    editDraft.finalPrompt = m.finalPrompt || m.final_prompt || ''
    editDialog.value = true
  }

  // 生成/重新生成最终提示词（不生图）：调用各类型 generate-prompt 接口，结果写回 draft
  const finalPromptGen = ref(false)
  const firstEpisodeId = computed(() => drama.value?.episodes?.[0]?.id || null)
  async function generateFinalPrompt(m: any) {
    const epId = firstEpisodeId.value
    if (!epId) { toast.error('请先在「剧集列表」创建至少一集，才能生成最终提示词'); return }
    finalPromptGen.value = true
    try {
      let res
      if (m.kindKey === 'character') res = await characterAPI.generatePrompt(m.id, epId, true)
      else if (m.kindKey === 'scene') res = await sceneAPI.generatePrompt(m.id, epId, true)
      else res = await propAPI.generatePrompt(m.id, epId, true)
      const fp = res?.final_prompt || res?.finalPrompt
      if (!fp) throw new Error('最终提示词生成失败，请重试')
      editTarget.value = { ...m, finalPrompt: fp }
      editDraft.finalPrompt = fp
      toast.success('最终提示词已生成')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      finalPromptGen.value = false
    }
  }

  function closeEdit() {
    editDialog.value = false
    editTarget.value = null
  }

  async function saveEdit() {
    const t = editTarget.value
    if (!t) return
    // 必填校验
    if (t.kindKey === 'character' && !String(editDraft.name ?? '').trim()) { toast.error('请填写名称'); return }
    if (t.kindKey === 'scene' && !String(editDraft.location ?? '').trim()) { toast.error('请填写地点'); return }
    if (t.kindKey === 'prop' && !String(editDraft.name ?? '').trim()) { toast.error('请填写名称'); return }
    editSaving.value = true
    try {
      const fp = editDraft.finalPrompt || null
      if (t.kindKey === 'character') await characterAPI.update(t.id, { name: editDraft.name, role: editDraft.role, appearance: editDraft.appearance, description: editDraft.description, styling: editDraft.styling, finalPrompt: fp })
      else if (t.kindKey === 'scene') await sceneAPI.update(t.id, { location: editDraft.location, time: editDraft.time, prompt: editDraft.prompt, lighting: editDraft.lighting, finalPrompt: fp })
      else await propAPI.update(t.id, { name: editDraft.name, type: editDraft.type, description: editDraft.description, finalPrompt: fp })
      toast.success('已保存')
      closeEdit()
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      editSaving.value = false
    }
  }

  return {
    assetTab,
    assetViewer,
    assetTabs,
    matHasImage,
    assetSrc,
    matDesc,
    tagClass,
    tabLabel,
    visibleAssets,
    assetTotal,
    assetGroups,
    materials,
    isPending,
    isUploading,
    generateMaterial,
    uploadMaterial,
    openAssetViewer,
    closeAssetViewer,
    fmtDate,
    editDialog,
    editSaving,
    editTarget,
    editDraft,
    openEdit,
    closeEdit,
    saveEdit,
    finalPromptGen,
    firstEpisodeId,
    generateFinalPrompt,
  }
}
