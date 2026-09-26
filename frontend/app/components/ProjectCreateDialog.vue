<!--
  ProjectCreateDialog.vue — 项目启动台（index.vue）新建项目对话框，由超限文件拆分外提。
  自持表单与视觉风格/画面比例选项；创建成功经事件回传父页刷新并跳转项目详情页。
  样式：表单内部样式随组件 scoped 挂载（父页 scoped 不穿透子组件内部元素）。
-->
<template>
  <div v-if="open" class="overlay" @click.self="emit('update:open', false)">
    <div class="dialog create-dialog">
      <div class="dialog-head">
        <div class="modal-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </div>
        <div class="dialog-head-copy">
          <h2 class="dialog-title">新建项目</h2>
          <p class="dialog-desc">创建后进入项目页选择集</p>
        </div>
      </div>
      <form @submit.prevent="create" class="dialog-form">
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">项目名称 <span class="required">*</span></span>
            <input v-model="form.title" class="input" placeholder="例如：都市情感短剧《时光邮局》" required autofocus />
          </label>
          <label class="field">
            <span class="field-label">视觉风格</span>
            <BaseSelect v-model="form.style" :options="styleSelectOptions" placeholder="选择风格" searchable />
            <span v-if="selectedStyleDesc" class="field-hint">{{ selectedStyleDesc }}</span>
          </label>
          <label class="field">
            <span class="field-label">画面比例</span>
            <BaseSelect v-model="form.aspect_ratio" :options="aspectRatioOptions" placeholder="选择画面比例" />
            <span class="field-hint">创建后固定，视频生成将统一使用该比例</span>
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="emit('update:open', false)">取消</button>
          <button type="submit" class="btn btn-primary">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            创建项目
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { dramaAPI } from '~/composables/useApi'
import BaseSelect from '~/components/BaseSelect.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  stylePresets: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'created'])

const form = ref({ title: '', style: '', aspect_ratio: '16:9' })
const styleSelectOptions = computed(() => props.stylePresets.map(p => ({ label: p.name, value: p.value })))
const selectedStyleDesc = computed(() => props.stylePresets.find(p => p.value === form.value.style)?.description || '')
const aspectRatioOptions = [
  { label: '16:9 · 横屏', value: '16:9' },
  { label: '9:16 · 竖屏', value: '9:16' },
  { label: '1:1 · 方形', value: '1:1' },
  { label: '自适应', value: 'adaptive' },
]

// 风格预设异步加载完成后，为未选择的表单设置默认风格
watch(() => props.stylePresets, (presets) => {
  if (!form.value.style && presets?.length) form.value.style = presets[0].value
})

async function create() {
  if (!form.value.title?.trim()) return
  try {
    const d = await dramaAPI.create(form.value)
    emit('update:open', false)
    form.value = { title: '', style: form.value.style, aspect_ratio: '16:9' }
    navigateTo(`/drama/${d.id}`)
  } catch (e) {
    toast.error(e.message)
  }
}
</script>

<style scoped src="assets/styles/create-dialog.css"></style>
