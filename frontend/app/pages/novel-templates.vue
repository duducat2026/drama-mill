<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/your-org/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <https://www.gnu.org/licenses/>.
-->

<template>
  <div class="page templates-page">
    <div class="templates-inner">
      <div class="page-head">
        <div class="head-left">
          <h1 class="page-title">拆分提示词模版</h1>
          <p class="page-sub">系统内置模版全局可用 · 创建个人私有模版引导 AI 按风格拆分命名</p>
        </div>
        <div class="head-actions">
          <button class="btn" @click="navigateTo('/novels')">返回文档库</button>
          <button class="btn btn-primary" @click="openTplForm()">新建私有模版</button>
        </div>
      </div>

      <div class="card tpl-grid">
        <div v-if="loading" class="list-loading">加载中…</div>
        <template v-else>
          <div v-for="t in templates" :key="t.id" class="tpl-card">
            <div class="tpl-head">
              <span class="tpl-name truncate">{{ t.name }}</span>
              <span class="tag" :class="t.is_system ? 'tag-accent' : ''">{{ t.is_system ? '系统内置' : '私有' }}</span>
              <span v-if="!t.is_active" class="tag">已停用</span>
            </div>
            <p class="tpl-desc">{{ t.description || '（无描述）' }}</p>
            <div class="tpl-meta">
              <span class="tag">key：{{ t.value }}</span>
              <span v-if="t.split_mode === 'paragraphs'" class="tag tag-accent">按段落拆分 · 每集 {{ t.default_paragraphs || 20 }} 段</span>
              <span v-else-if="t.default_target_chars" class="tag">建议每集 {{ Number(t.default_target_chars).toLocaleString() }} 字</span>
            </div>
            <div class="tpl-actions">
              <button class="btn btn-sm btn-ghost" @click="previewTpl = t">查看提示词</button>
              <template v-if="!t.is_system">
                <button class="btn btn-sm btn-ghost" @click="openTplForm(t)">编辑</button>
                <button class="btn btn-sm btn-ghost is-danger" @click="tplToDelete = t">删除</button>
              </template>
            </div>
          </div>
          <div v-if="!templates.length" class="empty-block">
            <p class="empty-title">暂无可用模版</p>
            <p class="empty-desc">系统内置模版将在首次启动时自动创建</p>
          </div>
        </template>
      </div>

      <!-- 查看提示词 -->
      <div v-if="previewTpl" class="overlay" @click.self="previewTpl = null">
        <div class="dialog tpl-preview-dialog">
          <div class="dialog-head">
            <h2 class="dialog-title truncate">{{ previewTpl.name }} · 拆分提示词</h2>
          </div>
          <div class="dialog-body preview-body">{{ previewTpl.prompt }}</div>
          <div class="dialog-foot">
            <button class="btn" @click="previewTpl = null">关闭</button>
          </div>
        </div>
      </div>

      <!-- 新建/编辑模版 -->
      <div v-if="tplForm" class="overlay" @click.self="tplForm = null">
        <form class="dialog tpl-form-dialog" @submit.prevent="saveTpl">
          <div class="dialog-head">
            <h2 class="dialog-title">{{ tplForm.id ? '编辑模版' : '新建私有模版' }}</h2>
          </div>
          <div class="dialog-body dialog-form-col">
            <label class="field">
              <span class="field-label">模版名称 <span class="required">*</span></span>
              <input v-model="tplForm.name" class="input" placeholder="例如：网文爽文" required />
            </label>
            <label class="field">
              <span class="field-label">模版 key <span class="required">*</span></span>
              <input v-model="tplForm.value" class="input" placeholder="小写字母/数字/中划线，如 web-novel" :disabled="!!tplForm.id" required />
              <span class="field-hint">创建后不可修改</span>
            </label>
            <label class="field">
              <span class="field-label">描述</span>
              <input v-model="tplForm.description" class="input" placeholder="模版适用场景说明" />
            </label>
            <label class="field">
              <span class="field-label">拆分方式</span>
              <div class="split-mode-row">
                <label class="check-row">
                  <input type="radio" value="chars" v-model="tplForm.split_mode" />
                  <span>按目标字数归组</span>
                </label>
                <label class="check-row">
                  <input type="radio" value="paragraphs" v-model="tplForm.split_mode" />
                  <span>按段落数量拆分（适合诗词/笑话，空行分隔的一段即一首/一则）</span>
                </label>
              </div>
            </label>
            <label v-if="tplForm.split_mode !== 'paragraphs'" class="field">
              <span class="field-label">建议每集字数</span>
              <input v-model.number="tplForm.default_target_chars" class="input target-input" type="number" min="0" step="500" />
            </label>
            <label v-else class="field">
              <span class="field-label">每集段落数</span>
              <input v-model.number="tplForm.default_paragraphs" class="input target-input" type="number" min="1" step="1" />
              <span class="field-hint">每个空行分隔的段落视为一篇独立内容，每 N 段编为一集</span>
            </label>
            <label class="field">
              <span class="field-label">拆分提示词 <span class="required">*</span></span>
              <textarea v-model="tplForm.prompt" class="textarea prompt-textarea" placeholder="描述拆分规则，例如：按诗词的首/阙拆分，每首为一集…" required></textarea>
            </label>
            <label class="check-row">
              <input v-model="tplForm.is_active" type="checkbox" />
              <span>启用（停用后不出现在拆分选项中）</span>
            </label>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" @click="tplForm = null">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="savingTpl">
              <Loader2 v-if="savingTpl" :size="13" class="animate-spin" />
              保存
            </button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        :open="!!tplToDelete"
        title="删除模版"
        :message="`确定删除模版「${tplToDelete?.name}」？已使用该模版的拆分记录保留快照，不受影响。`"
        :loading="deleting"
        @confirm="confirmDeleteTpl"
        @cancel="tplToDelete = null"
      />
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { Loader2 } from 'lucide-vue-next'
import { novelSplitTemplateAPI } from '~/composables/useApi'
import ConfirmDialog from '~/components/ConfirmDialog.vue'

const { user, fetchMe } = useAuth()

const templates = ref([])
const loading = ref(false)
const tplForm = ref(null)
const savingTpl = ref(false)
const previewTpl = ref(null)
const tplToDelete = ref(null)
const deleting = ref(false)

async function loadTemplates() {
  loading.value = true
  try {
    templates.value = await novelSplitTemplateAPI.list(true)
  } catch (e) {
    toast.error(e.message)
  } finally {
    loading.value = false
  }
}

function openTplForm(t) {
  tplForm.value = t
    ? { id: t.id, name: t.name, value: t.value, description: t.description || '', default_target_chars: t.default_target_chars || null, split_mode: t.split_mode || 'chars', default_paragraphs: t.default_paragraphs || 20, prompt: t.prompt, is_active: !!t.is_active }
    : { id: null, name: '', value: '', description: '', default_target_chars: null, split_mode: 'chars', default_paragraphs: 20, prompt: '', is_active: true }
}

async function saveTpl() {
  savingTpl.value = true
  try {
    const payload = {
      name: tplForm.value.name,
      value: tplForm.value.value,
      description: tplForm.value.description,
      default_target_chars: tplForm.value.split_mode === 'paragraphs' ? null : (tplForm.value.default_target_chars || null),
      split_mode: tplForm.value.split_mode,
      default_paragraphs: tplForm.value.split_mode === 'paragraphs' ? (tplForm.value.default_paragraphs || 20) : null,
      prompt: tplForm.value.prompt,
      is_active: tplForm.value.is_active,
    }
    if (tplForm.value.id) await novelSplitTemplateAPI.update(tplForm.value.id, payload)
    else await novelSplitTemplateAPI.create(payload)
    toast.success('已保存')
    tplForm.value = null
    loadTemplates()
  } catch (e) {
    toast.error(e.message)
  } finally {
    savingTpl.value = false
  }
}

async function confirmDeleteTpl() {
  const t = tplToDelete.value
  if (!t) return
  deleting.value = true
  try {
    await novelSplitTemplateAPI.del(t.id)
    toast.success('已删除')
    tplToDelete.value = null
    loadTemplates()
  } catch (e) {
    toast.error(e.message)
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  const me = user.value || await fetchMe()
  if (!me) return navigateTo('/login')
  loadTemplates()
})
</script>

<style scoped>
.templates-page { height: 100%; overflow-y: auto; }
.templates-inner { max-width: 1180px; margin: 0 auto; padding: 28px 24px 64px; display: flex; flex-direction: column; gap: 18px; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.page-title { font-size: 22px; font-weight: 700; color: var(--text-1); margin: 0; }
.page-sub { font-size: 12.5px; color: var(--text-3); margin: 4px 0 0; }
.head-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.tpl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; padding: 16px; }
.list-loading { padding: 40px; text-align: center; color: var(--text-3); font-size: 13px; }
.tpl-card { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; background: var(--surface-raised); }
.tpl-head { display: flex; align-items: center; gap: 8px; }
.tpl-name { font-size: 13.5px; font-weight: 700; color: var(--text-1); flex: 1; }
.tpl-desc { font-size: 12px; color: var(--text-2); line-height: 1.6; margin: 0; min-height: 19px; }
.tpl-meta { display: flex; gap: 6px; flex-wrap: wrap; }
.tpl-actions { display: flex; gap: 4px; justify-content: flex-end; }

.empty-block { grid-column: 1 / -1; padding: 48px 24px; text-align: center; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-1); margin: 0 0 6px; }
.empty-desc { font-size: 12.5px; color: var(--text-3); margin: 0; }

.tpl-preview-dialog { width: 720px; max-width: calc(100vw - 32px); }
.preview-body { white-space: pre-wrap; font-size: 13px; line-height: 1.9; color: var(--text-1); max-height: 60vh; overflow-y: auto; }
.dialog-head .tag { margin-left: auto; }

.tpl-form-dialog { width: 640px; max-width: calc(100vw - 32px); }
.dialog-form-col { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.required { color: var(--error); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.prompt-textarea { min-height: 140px; font-size: 12.5px; line-height: 1.7; }
.target-input { width: 180px; }
.check-row { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; color: var(--text-1); line-height: 1.5; }
.check-row input { margin-top: 3px; }
.split-mode-row { display: flex; flex-direction: column; gap: 6px; }
.is-danger { color: var(--action-danger); }
</style>
