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
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('cancel')">
      <div class="dialog confirm-dialog" role="alertdialog" aria-modal="true" :aria-label="title">
        <div class="confirm-icon" :class="{ 'is-warn': icon === 'warn' }">
          <TriangleAlert v-if="icon === 'warn'" :size="20" :stroke-width="1.8" />
          <Trash2 v-else :size="20" :stroke-width="1.8" />
        </div>
        <h2 class="confirm-title">{{ title }}</h2>
        <p class="confirm-message">{{ message }}</p>
        <div class="confirm-actions">
          <button type="button" class="btn" :disabled="loading" @click="emit('cancel')">取消</button>
          <button type="button" class="btn confirm-danger-btn" :disabled="loading" @click="emit('confirm')">
            <Loader2 v-if="loading" :size="13" class="animate-spin" />
            {{ loading ? loadingText : confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { Trash2, TriangleAlert, Loader2 } from 'lucide-vue-next'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '确认删除' },
  message: { type: String, default: '' },
  confirmText: { type: String, default: '删除' },
  loadingText: { type: String, default: '删除中...' },
  loading: { type: Boolean, default: false },
  // 图标语义：trash = 删除（默认，保持既有调用方不变）；warn = 停用/关闭等非删除类危险操作
  icon: { type: String, default: 'trash' },
})

const emit = defineEmits(['confirm', 'cancel'])

function onKeydown(e) {
  if (e.key === 'Escape') emit('cancel')
  if (e.key === 'Enter') emit('confirm')
}

watch(() => props.open, (v) => {
  if (v) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.confirm-dialog {
  width: 400px;
  max-width: calc(100vw - 48px);
  padding: 28px 24px 20px;
  align-items: center;
  text-align: center;
}
.confirm-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--action-danger-bg);
  color: var(--action-danger);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}
.confirm-icon.is-warn {
  background: var(--warning-bg);
  color: var(--warning);
}
.confirm-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-0);
}
.confirm-message {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-2);
  max-width: 320px;
  word-break: break-word;
}
.confirm-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 22px;
}
.confirm-actions .btn { flex: 1; }
.confirm-danger-btn {
  background: var(--action-danger);
  color: #fff;
}
.confirm-danger-btn:hover { background: #d70015; color: #fff; }
.confirm-danger-btn:disabled { opacity: 0.6; }
</style>
