<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
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
  <div class="admin-agents-page">
    <h1 class="admin-page-title">Agent 配置</h1>
    <p class="admin-page-desc">平台级 Agent 运行配置（模型、提示词与 Skills），仅管理员可见，保存后立即对所有用户生效。</p>

    <div class="admin-toolbar">
      <button
        v-for="t in tabs" :key="t.id"
        :class="['admin-tab', { active: tab === t.id }]"
        @click="tab = t.id"
      >
        <component :is="t.icon" :size="14" />
        {{ t.label }}
      </button>
    </div>

    <!-- ===== Agent 配置 ===== -->
    <div v-if="tab === 'agents'">
      <div class="agent-list">
        <div v-for="a in agentDefs" :key="a.type" class="card agent-card">
          <div class="agent-card-head" @click="toggleAgentEdit(a.type)">
            <div class="agent-type-badge">{{ a.icon }}</div>
            <div class="agent-card-heading">
              <div class="agent-card-title">{{ a.label }}</div>
              <div class="agent-card-type dim">{{ a.type }}</div>
            </div>
            <span v-if="getAgentCfg(a.type) && !getAgentCfg(a.type).is_default" class="admin-tag admin-tag-green">自定义</span>
            <span v-else class="admin-tag">默认</span>
            <ChevronDown :size="14" :style="{ transform: editingAgent === a.type ? 'rotate(180deg)' : '', transition: '0.2s' }" />
          </div>
          <div v-if="editingAgent === a.type" class="agent-card-body">
            <label class="field">
              <span class="field-label">模型 <span class="dim">(留空使用 AI 服务默认)</span></span>
              <BaseSelect v-model="agentForm.model" :options="textModelSelectOptions" placeholder="— 使用 AI 服务默认 —" searchable />
            </label>
            <label class="field">
              <span class="field-label">System Prompt <span class="dim">(保存为 workspace/prompts/{{ a.type }}.md)</span></span>
              <textarea v-model="agentForm.system_prompt" class="textarea" rows="12" placeholder="Agent 系统提示词..." />
            </label>
            <div class="agent-card-foot">
              <button class="btn btn-ghost btn-sm" @click="resetAgentPrompt(a.type)">恢复默认</button>
              <span v-if="agentSaved === a.type" class="admin-tag admin-tag-green" style="margin-left:8px">
                <Check :size="10" /> 已保存
              </span>
              <button class="btn btn-primary btn-sm ml-auto" :disabled="agentSaving" @click="saveAgentCfg(a.type)">
                <Loader2 v-if="agentSaving" :size="12" class="animate-spin" />
                保存
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== Skills 编辑（抽离为子组件） ===== -->
    <AdminAgentSkillsPanel v-else :agent-defs="agentDefs" />
  </div>
</template>

<script setup>
definePageMeta({ layout: 'admin' })

import { FileText, ChevronDown, Check, Loader2, Bot } from 'lucide-vue-next'
import BaseSelect from '~/components/BaseSelect.vue'
import { toast } from 'vue-sonner'
import { aiConfigAPI, promptAPI } from '~/composables/useApi'

const tab = ref('agents')
const tabs = [
  { id: 'agents', label: 'Agent 配置', icon: Bot },
  { id: 'skills', label: 'Skills', icon: FileText },
]

const agentDefs = [
  { type: 'script_rewriter', label: '剧本改写', icon: '📝' },
  { type: 'extractor', label: '角色场景提取', icon: '🔍' },
  { type: 'storyboard_breaker', label: '分镜拆解', icon: '🎬' },
  { type: 'prompt_generator', label: '提示词', icon: '🖼' },
  { type: 'novel_splitter', label: '小说分集', icon: '📚' },
]

// ===== Agent Configs =====
const agentCfgs = ref([])
const editingAgent = ref(null)
const agentSaving = ref(false)
const agentSaved = ref(null)
const agentForm = reactive({ model: '', system_prompt: '' })

function getAgentCfg(type) {
  return agentCfgs.value.find(a => a.agent_type === type)
}

// 模型下拉数据来自平台 AI 网关（管理员可见全部启用配置，无需 api_key 过滤）
const cfgs = ref([])
async function loadCfgs() { try { cfgs.value = await aiConfigAPI.list() } catch (e) { toast.error(e.message) } }

const textModelSelectOptions = computed(() =>
  cfgs.value
    .filter(c => c.service_type === 'text' && c.is_active)
    .map(c => ({
      label: `${c.provider} — ${c.name || c.service_type}`,
      options: (Array.isArray(c.model) ? c.model : (c.model ? [c.model] : [])).map(m => ({ label: m, value: m })),
    }))
    .filter(g => g.options.length > 0)
)

async function loadAgents() {
  try { agentCfgs.value = await promptAPI.list() }
  catch (e) { toast.error(e.message) }
}

async function toggleAgentEdit(type) {
  if (editingAgent.value === type) { editingAgent.value = null; return }
  try {
    const cfg = await promptAPI.get(type)
    agentForm.model = cfg.model || ''
    agentForm.system_prompt = cfg.system_prompt || ''
    agentSaved.value = null
    editingAgent.value = type
  } catch (e) { toast.error(e.message) }
}

async function resetAgentPrompt(type) {
  try {
    await promptAPI.reset(type)
    await loadAgents()
    const cfg = await promptAPI.get(type)
    agentForm.model = cfg.model || ''
    agentForm.system_prompt = cfg.system_prompt || ''
    toast.success('已恢复默认提示词（prompt 文件已删除）')
  } catch (e) { toast.error(e.message) }
}

async function saveAgentCfg(type) {
  agentSaving.value = true
  agentSaved.value = null
  try {
    await promptAPI.update(type, {
      name: agentDefs.find(a => a.type === type)?.label || type,
      model: agentForm.model,
      system_prompt: agentForm.system_prompt,
    })
    await loadAgents()
    agentSaved.value = type
    toast.success(`${agentDefs.find(a => a.type === type)?.label} 配置已保存`)
    setTimeout(() => { if (agentSaved.value === type) agentSaved.value = null }, 3000)
  } catch (e) {
    toast.error(e.message)
  } finally {
    agentSaving.value = false
  }
}

// ===== Skills =====
// Skills 标签页逻辑已抽离至 AdminAgentSkillsPanel.vue（仅需 agentDefs）

onMounted(() => { loadCfgs(); loadAgents() })
</script>

<!-- 复用设置中心的 Agent 卡片 / Skills 布局样式 -->
<style scoped src="assets/styles/settings.css"></style>

<style scoped>
.admin-agents-page { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.skills-layout { flex: 1; min-height: 0; margin-top: 10px; }
.admin-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: var(--radius-pill);
  border: 1px solid var(--border); background: #fff;
  font-size: 12.5px; font-weight: 600; color: var(--text-2);
  cursor: pointer; transition: all 0.15s var(--ease-out);
}
.admin-tab:hover { color: var(--text-0); }
.admin-tab.active { background: var(--text-0); border-color: var(--text-0); color: #fff; }
</style>
