<!--
  Drama Mill — AI 短剧生成平台
  AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
-->
<!--
  AdminNovelSplitTemplates.vue — 小说管理页（admin/novels.vue）「拆分提示词模版」标签，由超限文件拆分外提。
  自持模版检索/新建/编辑/删除与预览；作为独立标签在挂载时拉取模版列表。
-->
<template>
  <div>
    <div class="admin-toolbar">
      <input v-model.trim="tplKeyword" class="input" placeholder="搜索名称 / key / 提示词" style="width:220px" @keyup.enter="loadTemplates" />
      <label class="dim" style="display:flex;align-items:center;gap:5px;font-size:12.5px">
        <input v-model="systemOnly" type="checkbox" @change="loadTemplates" /> 仅系统内置
      </label>
      <button class="btn btn-sm" @click="loadTemplates">
        <Search :size="12" /> 检索
      </button>
      <button class="btn btn-primary btn-sm ml-auto" @click="openTplForm()">
        <Plus :size="13" /> 新建系统模版
      </button>
    </div>

    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>模版名称</th>
            <th>key</th>
            <th>描述</th>
            <th>拆分方式</th>
            <th>排序</th>
            <th>状态</th>
            <th>归属</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!templates.length">
            <td colspan="9" class="admin-empty">没有匹配的模版</td>
          </tr>
          <tr v-for="t in templates" v-else :key="t.id">
            <td>{{ t.id }}</td>
            <td style="font-weight:600">{{ t.name }}</td>
            <td class="dim">{{ t.value }}</td>
            <td><div class="admin-cell-text">{{ t.description || '—' }}</div></td>
            <td>
              <template v-if="t.split_mode === 'paragraphs'">按段落 · 每集 {{ t.default_paragraphs || 20 }} 段</template>
              <template v-else>按字数 · 每集 {{ t.default_target_chars ? Number(t.default_target_chars).toLocaleString() : '—' }} 字</template>
            </td>
            <td>{{ t.sort_order || 0 }}</td>
            <td><span class="admin-tag" :class="t.is_active ? 'admin-tag-green' : 'admin-tag-gray'">{{ t.is_active ? '启用' : '停用' }}</span></td>
            <td>
              <span v-if="t.is_system" class="admin-tag admin-tag-blue">系统内置</span>
              <span v-else class="admin-tag">私有（{{ t.creator || '—' }}）</span>
            </td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-ghost btn-sm" @click="previewTpl = t">查看</button>
              <button class="btn btn-ghost btn-sm" @click="openTplForm(t)">编辑</button>
              <button class="btn btn-danger btn-sm" @click="tplToDelete = t">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 模版查看 -->
    <div v-if="previewTpl" class="overlay" @click.self="previewTpl = null">
      <div class="dialog novel-preview-dialog">
        <div class="dialog-head">
          <h2 class="dialog-title">{{ previewTpl.name }} · 拆分提示词</h2>
        </div>
        <div class="dialog-body novel-preview-body">{{ previewTpl.prompt }}</div>
        <div class="dialog-foot">
          <button class="btn" @click="previewTpl = null">关闭</button>
        </div>
      </div>
    </div>

    <!-- 模版新建/编辑 -->
    <div v-if="tplForm" class="overlay" @click.self="tplForm = null">
      <form class="dialog tpl-form-dialog" @submit.prevent="saveTpl">
        <div class="dialog-head">
          <h2 class="dialog-title">{{ tplForm.id ? '编辑模版' : '新建模版' }}</h2>
        </div>
        <div class="dialog-body tpl-form-body">
          <label class="field">
            <span class="field-label">模版名称 <span class="required">*</span></span>
            <input v-model="tplForm.name" class="input" placeholder="例如：小说 / 诗词 / 幽默笑话" required />
          </label>
          <label class="field">
            <span class="field-label">模版 key <span class="required">*</span></span>
            <input v-model="tplForm.value" class="input" placeholder="小写字母/数字/中划线，如 poetry" :disabled="!!tplForm.id" required />
          </label>
          <label class="field">
            <span class="field-label">描述</span>
            <input v-model="tplForm.description" class="input" placeholder="模版适用场景说明" />
          </label>
          <label class="field">
            <span class="field-label">拆分方式</span>
            <div class="tpl-form-row">
              <label class="check-row">
                <input type="radio" value="chars" v-model="tplForm.split_mode" />
                <span>按目标字数归组</span>
              </label>
              <label class="check-row">
                <input type="radio" value="paragraphs" v-model="tplForm.split_mode" />
                <span>按段落数量拆分（适合诗词/笑话）</span>
              </label>
            </div>
            <span v-if="tplForm.split_mode === 'paragraphs'" class="dim" style="font-size:11.5px">空行分隔的一段视为一首/一则，每 N 段编为一集</span>
          </label>
          <div class="tpl-form-row">
            <label v-if="tplForm.split_mode !== 'paragraphs'" class="field" style="flex:1">
              <span class="field-label">建议每集字数</span>
              <input v-model.number="tplForm.default_target_chars" class="input" type="number" min="0" step="500" />
            </label>
            <label v-else class="field" style="flex:1">
              <span class="field-label">每集段落数</span>
              <input v-model.number="tplForm.default_paragraphs" class="input" type="number" min="1" step="1" />
            </label>
            <label class="field" style="flex:1">
              <span class="field-label">排序</span>
              <input v-model.number="tplForm.sort_order" class="input" type="number" step="1" />
            </label>
          </div>
          <label class="field">
            <span class="field-label">拆分提示词 <span class="required">*</span></span>
            <textarea v-model="tplForm.prompt" class="textarea" rows="10" placeholder="描述拆分规则，例如：按诗词的首/阙拆分，每首为一集…" required />
          </label>
          <label class="check-row">
            <input v-model="tplForm.is_active" type="checkbox" />
            <span>启用（停用后用户拆分选项中不出现）</span>
          </label>
          <label v-if="!tplForm.id" class="check-row">
            <input v-model="tplForm.is_system" type="checkbox" />
            <span>系统内置（对所有用户可见；取消勾选则仅创建者私有）</span>
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
      :message="`确定删除模版「${tplToDelete?.name}」？用户拆分选项将不再出现该模版，已拆分记录保留快照不受影响。`"
      :loading="deleting"
      @confirm="confirmDeleteTpl"
      @cancel="tplToDelete = null"
    />
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { Search, Plus, Loader2 } from 'lucide-vue-next'
import { adminAPI } from '~/composables/useApi'
import ConfirmDialog from '~/components/ConfirmDialog.vue'

const tplKeyword = ref('')
const systemOnly = ref(false)
const templates = ref([])
const previewTpl = ref(null)
const tplForm = ref(null)
const tplToDelete = ref(null)
const savingTpl = ref(false)
const deleting = ref(false)

async function loadTemplates() {
  try {
    templates.value = await adminAPI.novelSplitTemplates({
      keyword: tplKeyword.value || undefined,
      system_only: systemOnly.value ? 1 : undefined,
    })
  } catch (e) {
    toast.error(e.message)
  }
}

function openTplForm(t) {
  tplForm.value = t
    ? { id: t.id, name: t.name, value: t.value, description: t.description || '', default_target_chars: t.default_target_chars || null, split_mode: t.split_mode || 'chars', default_paragraphs: t.default_paragraphs || 20, sort_order: t.sort_order || 0, prompt: t.prompt, is_active: !!t.is_active }
    : { id: null, name: '', value: '', description: '', default_target_chars: null, split_mode: 'chars', default_paragraphs: 20, sort_order: 0, prompt: '', is_active: true, is_system: true }
}

async function saveTpl() {
  savingTpl.value = true
  try {
    const f = tplForm.value
    const payload = {
      name: f.name,
      value: f.value,
      description: f.description,
      default_target_chars: f.split_mode === 'paragraphs' ? null : (f.default_target_chars || null),
      split_mode: f.split_mode,
      default_paragraphs: f.split_mode === 'paragraphs' ? (f.default_paragraphs || 20) : null,
      sort_order: f.sort_order || 0,
      prompt: f.prompt,
      is_active: f.is_active,
    }
    if (f.id) await adminAPI.updateNovelSplitTemplate(f.id, payload)
    else await adminAPI.createNovelSplitTemplate({ ...payload, is_system: f.is_system ? 1 : 0 })
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
    await adminAPI.deleteNovelSplitTemplate(t.id)
    toast.success('已删除')
    tplToDelete.value = null
    loadTemplates()
  } catch (e) {
    toast.error(e.message)
  } finally {
    deleting.value = false
  }
}

onMounted(loadTemplates)
</script>

<style scoped src="~/assets/styles/admin-novels.css"></style>
