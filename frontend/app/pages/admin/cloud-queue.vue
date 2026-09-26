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
  <div>
    <div class="admin-page-title">云端队列状态</div>
    <div class="admin-page-desc">
      调用百炼批量任务接口查询上游排队（PENDING）/在途（RUNNING）任务，与本地生成任务比对，了解云端真实排队情况；
      可选指定用户，加载该用户的视频配置（模型 + API-KEY）查询，本地比对也限定该用户的任务
    </div>

    <div class="admin-toolbar">
      <select v-model="userIdInput" class="input" style="width: 200px">
        <option :value="0">全部用户（默认配置）</option>
        <option v-for="u in users" :key="u.id" :value="u.id">
          {{ u.nickname || u.username }}（{{ u.username }}）
        </option>
      </select>
      <select v-model="modelInput" class="input" style="width: 220px">
        <option value="">模型（默认配置模型）</option>
        <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
      </select>
      <button class="btn btn-sm btn-primary" :disabled="loading" @click="query">
        {{ loading ? '查询中…' : '查询云端' }}
      </button>
      <span v-if="data?.generated_at" class="cq-updated">更新于 {{ fmtTime(data.generated_at) }}</span>
      <span v-if="data?.user" class="cq-updated">
        用户：{{ data.user.nickname || data.user.username }}
      </span>
      <span v-if="data?.config" class="cq-updated">
        网关：{{ data.config.name }}（{{ data.config.api_key }}）
      </span>
      <span v-if="modelSummary" class="cq-updated">模型：{{ modelSummary }}</span>
    </div>

    <div v-if="error" class="cq-alert cq-alert-error">{{ error }}</div>
    <CloudQueuePanel v-if="data" :data="data" show-cloud-only />
    <div v-else-if="!loading && !error" class="admin-empty" style="margin-top:40px">
      点击「查询云端」获取上游排队状态
    </div>
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
definePageMeta({ layout: 'admin' })

const data = ref<any>(null)
const loading = ref(false)
const error = ref('')
const modelInput = ref('')
const userIdInput = ref(0)
const users = ref<any[]>([])
const modelOptions = ref<string[]>([])
// 查询口径模型清单：多模型分流时展示全部池，单模型/显式指定时退化为单个模型名
const modelSummary = computed(() => (data.value?.models?.length > 1 ? data.value.models.join('、') : data.value?.model || ''))

// 用户下拉：选用户后后端加载其视频配置（模型 + API-KEY）查询；模型清单随所选账号自动带出
onMounted(async () => {
  loadModelOptions()
  try {
    const res: any = await adminAPI.users({ page: 1, page_size: 200 })
    users.value = res?.items || []
  } catch { /* 用户列表加载失败不阻断默认查询 */ }
})

// 切换账号：拉取该账号启用的视频配置模型清单（全部用户时为默认配置），并重置已选模型
watch(userIdInput, () => {
  modelInput.value = ''
  loadModelOptions()
})

async function loadModelOptions() {
  try {
    const params: any = { service_type: 'video', page: 1, page_size: 50 }
    if (userIdInput.value) params.user_id = userIdInput.value
    const res: any = await adminAPI.aiConfigs(params)
    const models: string[] = []
    for (const r of res?.items || []) {
      if (!r.is_active) continue
      const raw = (r.model || '').trim()
      let arr: string[] = []
      if (raw.startsWith('[')) {
        try { arr = JSON.parse(raw).filter((m: any) => typeof m === 'string' && m.trim()) } catch { /* 非法 JSON 跳过 */ }
      } else if (raw) {
        arr = [raw]
      }
      for (const m of arr) if (!models.includes(m)) models.push(m)
    }
    modelOptions.value = models
  } catch { /* 模型清单加载失败不阻断查询 */ }
}

async function query() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const params: any = {}
    if (modelInput.value.trim()) params.model = modelInput.value.trim()
    if (userIdInput.value) params.user_id = userIdInput.value
    data.value = await adminAPI.cloudQueue(params)
  } catch (err: any) {
    error.value = err?.message || '查询失败'
  } finally {
    loading.value = false
  }
}

function fmtTime(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}
</script>

<style scoped>
.cq-updated { font-size: 12px; color: var(--text-3); }
.cq-alert {
  padding: 10px 14px; border-radius: 10px; font-size: 12.5px;
  margin-bottom: 12px;
}
.cq-alert-error { background: rgba(255,59,48,0.08); color: var(--action-danger); }
</style>
