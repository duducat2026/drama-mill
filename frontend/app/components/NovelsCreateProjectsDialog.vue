<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/your-org/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->

<template>
  <div v-if="open" class="overlay" @click.self="$emit('close')">
    <form class="dialog create-projects-dialog" @submit.prevent="submitCreateProjects">
      <div class="dialog-head">
        <h2 class="dialog-title">创建项目并生产</h2>
        <p class="dialog-desc">已选 {{ selectedCount }} 部小说 · 每部自动建剧并入批次生产（已有项目的小说直接复用）</p>
      </div>
      <div class="dialog-body dialog-form-col">
        <label class="field">
          <span class="field-label">视觉风格</span>
          <BaseSelect v-model="createForm.style" :options="styleSelectOptions" placeholder="选择风格" searchable />
        </label>
        <label class="field">
          <span class="field-label">画面比例</span>
          <BaseSelect v-model="createForm.aspect_ratio" :options="aspectRatioOptions" placeholder="选择画面比例" />
        </label>
        <label class="field">
          <span class="field-label">拆分提示词模版</span>
          <BaseSelect v-model="createForm.split_template_id" :options="splitTemplateOptions" placeholder="选择拆分模版" />
          <span v-if="createTplIsParagraphs" class="field-hint">该模版按段落数量拆分（每集 {{ createTplParagraphs }} 段，空行分隔的一段即一首/一则），下方字数不生效</span>
          <span v-else class="field-hint">基于模版提示词指导 AI 拆分，不选则用默认规则</span>
        </label>
        <label v-if="!createTplIsParagraphs" class="field">
          <span class="field-label">每集目标字数</span>
          <input v-model.number="createForm.target_chars" class="input target-input" type="number" min="1" step="500" />
        </label>
        <label class="field">
          <span class="field-label">执行方式</span>
          <div class="mode-picker">
            <label class="mode-option" :class="{ on: createForm.mode === 'split_only' }">
              <input v-model="createForm.mode" type="radio" value="split_only" />
              <span class="mode-copy">
                <span class="mode-name">先拆分，确认后再生产 <span class="mode-rec">推荐</span></span>
                <span class="mode-desc">自动拆分成多份入库，拆分完成即停；确认分集结果后再启动创作生产</span>
              </span>
            </label>
            <label class="mode-option" :class="{ on: createForm.mode === 'full' }">
              <input v-model="createForm.mode" type="radio" value="full" />
              <span class="mode-copy">
                <span class="mode-name">拆分并直接生产</span>
                <span class="mode-desc">拆分后自动续接图片/视频生产（将真实消耗生成额度），可随时暂停</span>
              </span>
            </label>
          </div>
        </label>
      </div>
      <div class="dialog-foot">
        <button type="button" class="btn" @click="$emit('close')">取消</button>
        <button type="submit" class="btn btn-primary" :disabled="creatingProjects">
          <Loader2 v-if="creatingProjects" :size="13" class="animate-spin" />
          创建项目
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { Loader2 } from 'lucide-vue-next'
import { novelAPI } from '~/composables/useApi'
import BaseSelect from '~/components/BaseSelect.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  novelIds: { type: Array, default: () => [] },
  selectedCount: { type: Number, default: 0 },
  templates: { type: Array, default: () => [] },
  stylePresets: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'submitted'])

const creatingProjects = ref(false)
const createForm = ref({ style: '', aspect_ratio: '16:9', target_chars: 15000, split_template_id: 0, mode: 'split_only' })
const styleSelectOptions = computed(() => props.stylePresets.map(p => ({ label: p.name, value: p.value })))
const aspectRatioOptions = [
  { label: '16:9 · 横屏', value: '16:9' },
  { label: '9:16 · 竖屏', value: '9:16' },
  { label: '1:1 · 方形', value: '1:1' },
  { label: '自适应', value: 'adaptive' },
]
const splitTemplateOptions = computed(() => [
  { label: '默认 · 规则拆分', value: 0 },
  ...props.templates.filter(t => t.is_active).map(t => ({ label: t.is_system ? `${t.name}（系统）` : t.name, value: t.id })),
])
// 段落拆分模版（如诗词/幽默笑话）选中时隐藏字数输入，改按模版的每集段落数切分
const createTplIsParagraphs = computed(() => props.templates.find(t => t.id === createForm.value.split_template_id)?.split_mode === 'paragraphs')
const createTplParagraphs = computed(() => props.templates.find(t => t.id === createForm.value.split_template_id)?.default_paragraphs || 20)

// 打开时若未选风格则用默认首个
watch(() => props.open, (v) => {
  if (v && !createForm.value.style && props.stylePresets.length) createForm.value.style = props.stylePresets[0].value
})

watch(() => createForm.value.split_template_id, (id) => {
  const tpl = props.templates.find(t => t.id === id)
  // 段落拆分模版不依赖目标字数，不预填
  if (tpl?.split_mode === 'paragraphs') return
  if (tpl?.default_target_chars) createForm.value.target_chars = tpl.default_target_chars
  else if (!id) createForm.value.target_chars = 15000
})

async function submitCreateProjects() {
  creatingProjects.value = true
  try {
    const res = await novelAPI.createProjects({
      novel_ids: props.novelIds,
      style: createForm.value.style || undefined,
      aspect_ratio: createForm.value.aspect_ratio,
      target_chars: createForm.value.target_chars || undefined,
      split_template_id: createForm.value.split_template_id || undefined,
      mode: createForm.value.mode,
      auto_start: createForm.value.mode === 'full',
    })
    if (res.errors?.length) toast.warning(`${res.errors.length} 部创建失败：${res.errors.map(e => `#${e.novel_id}`).join('、')}`)
    toast.success(createForm.value.mode === 'split_only'
      ? `已创建 ${res.created.length} 个项目并启动拆分，拆分完成后在面板确认并启动生产`
      : `已创建 ${res.created.length} 个项目并启动批量生产`)
    emit('submitted')
  } catch (e) {
    toast.error(e.message)
  } finally {
    creatingProjects.value = false
  }
}
</script>

<style scoped src="~/assets/styles/novels.css"></style>
