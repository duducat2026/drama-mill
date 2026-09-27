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
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">云端排队状态</h1>
        <p class="page-desc">查询视频生成上游的排队情况，了解你的任务还要等多久</p>
      </div>
      <div class="cq-toolbar">
        <input v-model="modelInput" class="input" placeholder="模型名（默认配置模型）" style="width: 200px" @keyup.enter="query" />
        <button class="btn btn-primary" :disabled="loading" @click="query">
          {{ loading ? '查询中…' : '查询云端' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="cq-alert cq-alert-error">{{ error }}</div>
    <CloudQueuePanel v-if="data" :data="data" />
    <div v-else-if="!loading && !error" class="cq-empty-hint">
      点击「查询云端」获取上游排队状态
    </div>

    <div v-if="data?.generated_at" class="cq-footer">
      更新于 {{ fmtTime(data.generated_at) }} · 本地在途仅统计你的任务<template v-if="data?.config"> · 查询配置：{{ data.config.name }}（{{ data.config.api_key }}）<template v-if="modelSummary"> · 模型：{{ modelSummary }}</template></template>
    </div>
  </div>
</template>

<script setup lang="ts">
const data = ref<any>(null)
const loading = ref(false)
const error = ref('')
const modelInput = ref('')
// 查询口径模型清单：多模型分流时展示全部池，单模型/显式指定时退化为单个模型名
const modelSummary = computed(() => (data.value?.models?.length > 1 ? data.value.models.join('、') : data.value?.model || ''))

async function query() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const params: any = {}
    if (modelInput.value.trim()) params.model = modelInput.value.trim()
    data.value = await taskAPI.cloudQueue(params)
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
.page { max-width: 1200px; margin: 0 auto; padding: 24px 20px 60px; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.page-title { font-size: 20px; font-weight: 700; color: var(--text-1); margin: 0; }
.page-desc { font-size: 12.5px; color: var(--text-3); margin: 4px 0 0; }
.cq-toolbar { display: flex; gap: 8px; align-items: center; }

.cq-alert {
  padding: 10px 14px; border-radius: 10px; font-size: 12.5px;
  margin-bottom: 12px;
}
.cq-alert-error { background: rgba(255,59,48,0.08); color: var(--action-danger); }

.cq-empty-hint {
  padding: 60px 0; text-align: center; color: var(--text-3); font-size: 13px;
}
.cq-footer { margin-top: 16px; font-size: 11.5px; color: var(--text-3); }
</style>
