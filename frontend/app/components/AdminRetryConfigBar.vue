<!--
  Drama Mill — Admin 平台视频页：失败任务自动重提上限配置条
  自管加载/保存（运行时即时生效，无需重启），从 videos.vue 抽离以保持页面聚焦于任务列表。
-->
<template>
  <div class="admin-toolbar retry-config-bar">
    <span class="retry-config-label">失败任务自动重提上限</span>
    <input v-model.number="retryMax" type="number" class="input retry-config-input" min="0" :max="retryHardMax" />
    <button class="btn btn-sm" :disabled="savingRetryMax || retryMax === retryMaxLoaded" @click="saveRetryMax">
      {{ savingRetryMax ? '保存中…' : '保存' }}
    </button>
    <span class="retry-config-hint">0~{{ retryHardMax }} 次（0 = 关闭自动恢复，默认 {{ retryEnvDefault }}）· 无法处理的任务请点“放弃”停止一切重提</span>
  </div>
</template>

<script setup lang="ts">
import { adminAPI } from '~/composables/useApi'
import { toast } from 'vue-sonner'

// 失败任务自动重提上限（运行时可改 0~hard_max）
const retryMax = ref<number>(0)
const retryMaxLoaded = ref<number>(0)
const retryHardMax = ref(9)
const retryEnvDefault = ref(3)
const savingRetryMax = ref(false)

async function loadRetryConfig() {
  try {
    const cfg = await adminAPI.retryConfig()
    retryHardMax.value = cfg.hard_max
    retryEnvDefault.value = cfg.env_default
    retryMax.value = cfg.auto_retry_max
    retryMaxLoaded.value = cfg.auto_retry_max
  } catch { /* 配置加载失败保留默认展示 */ }
}

async function saveRetryMax() {
  const v = Math.floor(Number(retryMax.value))
  if (!Number.isFinite(v) || v < 0 || v > retryHardMax.value) {
    toast.error(`上限须为 0~${retryHardMax.value} 的整数`)
    return
  }
  savingRetryMax.value = true
  try {
    const res = await adminAPI.updateRetryConfig(v)
    retryMax.value = res.auto_retry_max
    retryMaxLoaded.value = res.auto_retry_max
    toast.success(v === 0 ? '已关闭失败任务自动恢复' : `自动重提上限已设为 ${v} 次（即时生效）`)
  } catch (e: any) {
    toast.error(e.message || '保存失败')
  } finally {
    savingRetryMax.value = false
  }
}

onMounted(loadRetryConfig)
</script>

<style scoped>
.retry-config-bar { gap: 8px; }
.retry-config-label { font-size: 12.5px; font-weight: 600; }
.retry-config-input { width: 64px; text-align: center; }
.retry-config-hint { font-size: 11.5px; color: var(--text-3); }
</style>
