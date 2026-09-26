<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/your-org/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->

<template>
  <div v-if="novel" class="overlay" @click.self="$emit('close')">
    <form class="dialog pre-split-dialog" @submit.prevent="submitPreSplit">
      <div class="dialog-head">
        <h2 class="dialog-title">文档拆分</h2>
      </div>
      <div class="dialog-body dialog-form-col">
        <div class="novel-meta">
          <span class="tag tag-accent">{{ (novel.char_count || 0).toLocaleString() }} 字</span>
          <span class="tag">{{ novel.chapter_count || 0 }} 章</span>
        </div>
        <p class="dialog-desc">按提示词模版或手动参数把大文档拆成多份独立文档，拆分后每份仍留入库中，可分别创建项目生产</p>
        <label class="field">
          <span class="field-label">拆分提示词模版</span>
          <BaseSelect v-model="preSplitForm.split_template_id" :options="splitTemplateOptions" placeholder="选择拆分模版（可选）" />
          <span v-if="preSplitTplIsParagraphs" class="field-hint">该模版按段落数量拆分（每份 {{ preSplitTplParagraphs }} 段），下方字数不生效</span>
          <span v-else-if="preSplitForm.split_template_id" class="field-hint">该模版按目标字数归组，建议每份 {{ preSplitTplTargetChars }} 字</span>
          <span v-else class="field-hint">选择模版后自动填充拆分参数，也可手动指定</span>
        </label>
        <label v-if="preSplitForm.split_mode === 'chars'" class="field">
          <span class="field-label">每份目标字数</span>
          <input v-model.number="preSplitForm.target_chars" class="input target-input" type="number" min="1" step="500" />
          <span class="field-hint">识别章节并贪心归组到目标字数，适合小说/长文</span>
        </label>
        <template v-else>
          <label class="field">
            <span class="field-label">切分方式</span>
            <div class="mode-picker">
              <label class="mode-option" :class="{ on: preSplitForm.mode === 'paragraphs' }">
                <input v-model="preSplitForm.mode" type="radio" value="paragraphs" />
                <span class="mode-copy">
                  <span class="mode-name">按每份段落数</span>
                  <span class="mode-desc">每 N 首/则编为一份（推荐）</span>
                </span>
              </label>
              <label class="mode-option" :class="{ on: preSplitForm.mode === 'target' }">
                <input v-model="preSplitForm.mode" type="radio" value="target" />
                <span class="mode-copy">
                  <span class="mode-name">按目标份数</span>
                  <span class="mode-desc">均分到 N 份，每份段落数自动计算</span>
                </span>
              </label>
            </div>
          </label>
          <label v-if="preSplitForm.mode === 'paragraphs'" class="field">
            <span class="field-label">每份段落数</span>
            <input v-model.number="preSplitForm.paragraphs_per_novel" class="input target-input" type="number" min="1" step="1" />
            <span class="field-hint">每个空行分隔的段落视为一首/一则，每 N 段编为一份</span>
          </label>
          <label v-else class="field">
            <span class="field-label">目标份数</span>
            <input v-model.number="preSplitForm.target_novels" class="input target-input" type="number" min="2" step="1" />
            <span class="field-hint">均分到 N 份，每份段落数 = 总段落数 ÷ N</span>
          </label>
        </template>
        <label class="field">
          <span class="field-label">标题前缀</span>
          <input v-model.trim="preSplitForm.title_prefix" class="input" maxlength="50" />
          <span class="field-hint">拆分后每份标题为“前缀-01”“前缀-02”…，留空用原标题</span>
        </label>
        <label class="check-row">
          <input v-model="preSplitForm.delete_source" type="checkbox" />
          <span>拆分后删除原文档（软删除，拆分后原始大文档不再需要单独管理）</span>
        </label>
      </div>
      <div class="dialog-foot">
        <button type="button" class="btn" @click="$emit('close')">取消</button>
        <button type="submit" class="btn btn-primary" :disabled="preSplitting">
          <Loader2 v-if="preSplitting" :size="13" class="animate-spin" />
          {{ preSplitting ? '拆分中…' : '开始拆分' }}
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
  novel: { type: Object, default: null },
  templates: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'success'])

const preSplitting = ref(false)
const preSplitForm = ref({ mode: 'paragraphs', paragraphs_per_novel: 200, target_novels: 10, title_prefix: '', delete_source: true, split_template_id: 0, split_mode: 'paragraphs', target_chars: 15000 })

const splitTemplateOptions = computed(() => [
  { label: '默认 · 规则拆分', value: 0 },
  ...props.templates.filter(t => t.is_active).map(t => ({ label: t.is_system ? `${t.name}（系统）` : t.name, value: t.id })),
])
const preSplitTplIsParagraphs = computed(() => props.templates.find(t => t.id === preSplitForm.value.split_template_id)?.split_mode === 'paragraphs')
const preSplitTplParagraphs = computed(() => props.templates.find(t => t.id === preSplitForm.value.split_template_id)?.default_paragraphs || 20)
const preSplitTplTargetChars = computed(() => props.templates.find(t => t.id === preSplitForm.value.split_template_id)?.default_target_chars || 15000)

// 打开时重置表单（标题前缀取原文档名）
watch(() => props.novel, (n) => {
  if (!n) return
  preSplitForm.value = { mode: 'paragraphs', paragraphs_per_novel: 200, target_novels: 10, title_prefix: n.title, delete_source: true, split_template_id: 0, split_mode: 'paragraphs', target_chars: 15000 }
})

// 选中模版时自动填充拆分方式与参数
watch(() => preSplitForm.value.split_template_id, (id) => {
  if (!id) {
    preSplitForm.value.split_mode = 'paragraphs'
    return
  }
  const tpl = props.templates.find(t => t.id === id)
  if (!tpl) return
  preSplitForm.value.split_mode = tpl.split_mode === 'paragraphs' ? 'paragraphs' : 'chars'
  if (tpl.split_mode !== 'paragraphs' && tpl.default_target_chars) preSplitForm.value.target_chars = tpl.default_target_chars
  if (tpl.split_mode === 'paragraphs' && tpl.default_paragraphs) preSplitForm.value.paragraphs_per_novel = tpl.default_paragraphs
})

async function submitPreSplit() {
  const n = props.novel
  if (!n) return
  const f = preSplitForm.value
  if (f.split_mode === 'paragraphs') {
    if (f.mode === 'paragraphs' && (!f.paragraphs_per_novel || f.paragraphs_per_novel < 1)) { toast.warning('每份段落数不能小于 1'); return }
    if (f.mode === 'target' && (!f.target_novels || f.target_novels < 2)) { toast.warning('目标份数不能小于 2'); return }
  } else {
    if (!f.target_chars || f.target_chars < 1) { toast.warning('每份目标字数不能小于 1'); return }
  }
  preSplitting.value = true
  try {
    const res = await novelAPI.preSplit(n.id, {
      paragraphs_per_novel: f.split_mode === 'paragraphs' && f.mode === 'paragraphs' ? f.paragraphs_per_novel : undefined,
      target_novels: f.split_mode === 'paragraphs' && f.mode === 'target' ? f.target_novels : undefined,
      title_prefix: f.title_prefix || undefined,
      delete_source: f.delete_source,
      split_template_id: f.split_template_id || undefined,
      split_mode: f.split_mode,
      target_chars: f.split_mode === 'chars' ? f.target_chars : undefined,
    })
    toast.success(`拆分完成：${res.created.length} 份独立文档已入库，可在列表勾选后批量创建项目`)
    emit('success')
  } catch (e) {
    toast.error(e.message)
  } finally {
    preSplitting.value = false
  }
}
</script>

<style scoped src="~/assets/styles/novels.css"></style>
