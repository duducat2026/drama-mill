<!--
  Drama Mill — Admin Agent Skills 面板
  从 pages/admin/agents.vue 抽离：Agent 左侧列表 + Skill 增删改查（skillsAPI）
  作为 Agent 配置页的「Skills」标签内容，自管选中态与 CRUD，父页仅需传入 agentDefs。
-->
<template>
  <div class="skills-layout">
    <!-- Agent 左侧列表 -->
    <aside class="skills-agent-list">
      <div class="skills-agent-title">Agent 列表</div>
      <button
        v-for="a in agentDefs"
        :key="a.type"
        :class="['skills-agent-item', { active: selectedAgent === a.type }]"
        @click="selectAgent(a.type)"
      >
        <span class="agent-type-badge">{{ a.icon }}</span>
        <span class="skills-agent-label">{{ a.label }}</span>
        <span v-if="agentSkillCount(a.type) > 0" class="skill-count-badge">{{ agentSkillCount(a.type) }}</span>
      </button>
    </aside>

    <!-- Skill 管理右侧主区域 -->
    <div class="settings-scroll skills-main">
      <div class="settings-head skills-head">
        <span class="agent-type-badge skills-head-badge">{{ selectedAgentIcon }}</span>
        <div class="skills-head-copy">
          <h2 class="settings-title">{{ selectedAgentLabel }}</h2>
          <div class="dim" style="font-size:12px;margin-top:2px">{{ selectedAgentType }} — Skills</div>
          <p class="settings-desc">Skills 作为 Agent 的提示词规范层注入，保存后对该 Agent 的所有调用立即生效。</p>
        </div>
        <button class="btn btn-primary btn-sm ml-auto" @click="startAddSkill">
          <Plus :size="13" /> 新增 Skill
        </button>
      </div>

      <!-- 无 skill 提示 -->
      <div v-if="!currentSkills.length" class="card skills-empty">
        <div class="skills-empty-icon">
          <FileText :size="24" />
        </div>
        <div class="skills-empty-title">暂无 Skill</div>
        <div class="skills-empty-desc">点击右上角「新增 Skill」创建第一个提示词文件</div>
      </div>

      <!-- Skill 列表 -->
      <div class="skill-list" v-else>
        <div v-for="s in currentSkills" :key="s.id" class="card skill-card">
          <div class="skill-card-head" @click="toggleSkillEdit(s.id)">
            <FileText :size="14" style="color:var(--accent);flex-shrink:0" />
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:13px">{{ s.name }}</div>
              <div class="dim" style="font-size:11px">{{ s.description }}</div>
            </div>
            <button class="btn btn-danger btn-icon btn-sm" style="margin-right:4px" @click.stop="skillToDelete = s.id">
              <Trash2 :size="13" />
            </button>
            <ChevronDown :size="14" :style="{ transform: editingSkill === s.id ? 'rotate(180deg)' : '', transition: '0.2s' }" />
          </div>
          <div v-if="editingSkill === s.id" class="skill-card-body">
            <textarea
              v-model="skillContent"
              class="textarea mono"
              rows="20"
              style="font-size:12px;line-height:1.6"
              placeholder="编写 SKILL.md 内容..."
            />
            <div class="skill-card-foot">
              <span class="dim" style="font-size:11px">skills/{{ s.id }}/SKILL.md</span>
              <span v-if="skillSaved === s.id" class="admin-tag admin-tag-green" style="margin-left:8px">
                <Check :size="10" /> 已保存
              </span>
              <button class="btn btn-primary btn-sm ml-auto" :disabled="skillSaving" @click="saveSkill(s.id)">
                <Loader2 v-if="skillSaving" :size="12" class="animate-spin" />
                保存
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Skill Dialog -->
    <div v-if="addSkillDialog" class="overlay" @click.self="addSkillDialog = false">
      <form class="dialog skill-dialog" @submit.prevent="confirmAddSkill">
        <div class="dialog-head">
          <div class="dialog-title">新增 Skill — {{ selectedAgentLabel }}</div>
        </div>
        <div class="dialog-body skill-dialog-body">
          <label class="field">
            <span class="field-label">Skill 目录名 <span class="dim">(英文，唯一)</span></span>
            <input v-model="newSkillForm.id" class="input" placeholder="如 custom-extraction" />
          </label>
          <label class="field">
            <span class="field-label">名称</span>
            <input v-model="newSkillForm.name" class="input" placeholder="如 自定义提取规则" />
          </label>
          <label class="field">
            <span class="field-label">描述</span>
            <input v-model="newSkillForm.description" class="input" placeholder="简短描述此 Skill 的用途" />
          </label>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" @click="addSkillDialog = false">取消</button>
          <button type="submit" class="btn btn-primary" :disabled="!newSkillForm.id">创建</button>
        </div>
      </form>
    </div>

    <ConfirmDialog
      :open="!!skillToDelete"
      title="删除 Skill"
      :message="`确定删除 Skill「${skillToDelete}」？删除后对应 Agent 将回退到内置默认提示词。`"
      :loading="deletingSkill"
      @confirm="confirmDelSkill"
      @cancel="skillToDelete = null"
    />
  </div>
</template>

<script setup>
import { Plus, Trash2, FileText, ChevronDown, Check, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { skillsAPI } from '~/composables/useApi'

const props = defineProps({
  agentDefs: { type: Array, default: () => [] },
})

const selectedAgent = ref('script_rewriter')
const allSkills = ref([])   // { id, name, description }[]
const editingSkill = ref(null)
const skillContent = ref('')
const skillSaving = ref(false)
const skillSaved = ref(null)
const addSkillDialog = ref(false)
const newSkillForm = reactive({ id: '', name: '', description: '' })

const selectedAgentType = computed(() => selectedAgent.value)
const selectedAgentLabel = computed(() => props.agentDefs.find(a => a.type === selectedAgent.value)?.label || '')
const selectedAgentIcon = computed(() => props.agentDefs.find(a => a.type === selectedAgent.value)?.icon || '')

// agent type 用下划线（script_rewriter），skill 目录按 Mastra 规范用连字符（script-rewriter）
const skillDirOf = (type) => type.replace(/_/g, '-')
const skillBelongsTo = (skillId, type) => {
  const dir = skillDirOf(type)
  return skillId === dir || skillId.startsWith(dir + '/')
}

function agentSkillCount(type) {
  return allSkills.value.filter(s => skillBelongsTo(s.id, type)).length
}

const currentSkills = computed(() =>
  allSkills.value.filter(s => skillBelongsTo(s.id, selectedAgent.value))
)

async function loadAllSkills() {
  try { allSkills.value = await skillsAPI.list() }
  catch (e) { toast.error(e.message) }
}

function selectAgent(type) {
  selectedAgent.value = type
  editingSkill.value = null
}

function startAddSkill() {
  newSkillForm.id = ''
  newSkillForm.name = ''
  newSkillForm.description = ''
  addSkillDialog.value = true
}

async function confirmAddSkill() {
  if (!newSkillForm.id) return
  const skillId = `${skillDirOf(selectedAgent.value)}/${newSkillForm.id}`
  try {
    await skillsAPI.create({ id: skillId, name: newSkillForm.name, description: newSkillForm.description })
    addSkillDialog.value = false
    await loadAllSkills()
    toast.success('Skill 创建成功')
  } catch (e) {
    toast.error(e.message)
  }
}

const skillToDelete = ref(null)
const deletingSkill = ref(false)

async function confirmDelSkill() {
  const id = skillToDelete.value
  if (!id) return
  try {
    deletingSkill.value = true
    await skillsAPI.del(id)
    if (editingSkill.value === id) editingSkill.value = null
    await loadAllSkills()
    skillToDelete.value = null
    toast.success('已删除')
  } catch (e) {
    toast.error(e.message)
  } finally {
    deletingSkill.value = false
  }
}

async function toggleSkillEdit(id) {
  if (editingSkill.value === id) { editingSkill.value = null; return }
  try {
    const res = await skillsAPI.get(id)
    skillContent.value = res.content
    skillSaved.value = null
    editingSkill.value = id
  } catch (e) { toast.error(e.message) }
}

async function saveSkill(id) {
  skillSaving.value = true
  skillSaved.value = null
  try {
    await skillsAPI.update(id, skillContent.value)
    await loadAllSkills()
    skillSaved.value = id
    toast.success(`已保存`)
    setTimeout(() => { if (skillSaved.value === id) skillSaved.value = null }, 3000)
  } catch (e) {
    toast.error(e.message)
  } finally {
    skillSaving.value = false
  }
}

onMounted(loadAllSkills)
</script>

<!-- 复用设置中心的 Skills 布局样式 -->
<style scoped src="~/assets/styles/settings.css"></style>
