/*
 * settings.vue「风格预设」逻辑 composable（拆分超限文件）。
 * 自建风格仅自己可见，系统内置全局共享（仅管理员可改）；停用的风格不出现在创建选项中。
 */
import { toast } from 'vue-sonner'
import { stylePresetAPI } from '~/composables/useApi'

export function useStylePresets() {
  const { isAdmin } = useAuth()
  const stylePresets = ref([])
  const styleDialog = ref(false)
  const styleEditId = ref(null)
  const styleForm = reactive({ name: '', value: '', prompt: '', description: '', sort_order: 0, is_system: false })

  async function loadStylePresets() {
    try { stylePresets.value = await stylePresetAPI.list(true) } catch (e) { toast.error(e.message) }
  }

  async function toggleStyle(p) {
    try {
      await stylePresetAPI.update(p.id, { is_active: !p.is_active })
      loadStylePresets()
    } catch (e) { toast.error(e.message) }
  }

  const styleToDelete = ref(null)
  const deletingStyle = ref(false)

  async function confirmDelStyle() {
    const p = styleToDelete.value
    if (!p) return
    try {
      deletingStyle.value = true
      await stylePresetAPI.del(p.id)
      styleToDelete.value = null
      toast.success('已删除')
      loadStylePresets()
    } catch (e) {
      toast.error(e.message)
    } finally {
      deletingStyle.value = false
    }
  }

  function startAddStyle() {
    styleEditId.value = null
    Object.assign(styleForm, {
      name: '', value: '', prompt: '', description: '',
      sort_order: (stylePresets.value.at(-1)?.sort_order ?? 0) + 1,
      is_system: false,
    })
    styleDialog.value = true
  }

  function startEditStyle(p) {
    styleEditId.value = p.id
    Object.assign(styleForm, {
      name: p.name,
      value: p.value,
      prompt: p.prompt,
      description: p.description || '',
      sort_order: p.sort_order ?? 0,
    })
    styleDialog.value = true
  }

  async function saveStyle() {
    if (!styleForm.name?.trim() || !styleForm.prompt?.trim() || (!styleEditId.value && !styleForm.value?.trim())) {
      toast.warning('名称、key、提示词片段必填')
      return
    }
    try {
      if (styleEditId.value) {
        await stylePresetAPI.update(styleEditId.value, {
          name: styleForm.name,
          prompt: styleForm.prompt,
          description: styleForm.description,
          sort_order: styleForm.sort_order,
        })
      } else {
        // is_system 仅 admin 生效（后端校验），普通用户创建的均为私有风格
        await stylePresetAPI.create({ ...styleForm })
      }
      styleDialog.value = false
      toast.success('已保存')
      loadStylePresets()
    } catch (e) { toast.error(e.message) }
  }

  return {
    isAdmin, stylePresets, styleDialog, styleEditId, styleForm,
    styleToDelete, deletingStyle,
    loadStylePresets, toggleStyle, confirmDelStyle, startAddStyle, startEditStyle, saveStyle,
  }
}
