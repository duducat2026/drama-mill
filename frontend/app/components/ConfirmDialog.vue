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

<!--
  危险操作确认框：遮罩 + 居中卡片（复用 studio.css 的 overlay/dialog 骨架）
  Esc 取消、Enter 确认；loading 期间双钮锁死并显示进度文案
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
import { onUnmounted, watch } from 'vue'
import { Loader2, Trash2, TriangleAlert } from 'lucide-vue-next'

const props = defineProps({
  open: { type: Boolean, default: false },
  // 文案三件套：标题 / 说明 / 确认钮（默认按删除语义给词）
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

// 打开期间才挂全局键盘监听，关闭与卸载对称摘除
watch(() => props.open, active => {
  const fn = active ? window.addEventListener : window.removeEventListener
  fn('keydown', onKeydown)
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.confirm-dialog { width: 400px; max-width: calc(100vw - 48px); padding: 28px 24px 20px; align-items: center; text-align: center; }
.confirm-icon {
  display: flex; align-items: center; justify-content: center;
  width: 52px; height: 52px; margin-bottom: 14px; border-radius: 50%;
  color: var(--action-danger); background: var(--action-danger-bg);
}
.confirm-icon.is-warn { color: var(--warning); background: var(--warning-bg); }
.confirm-title { font: 700 16px var(--font-body); letter-spacing: -0.01em; color: var(--text-0); }
.confirm-message {
  margin-top: 8px; max-width: 320px; font-size: 13px; line-height: 1.65;
  color: var(--text-2); word-break: break-word;
}
.confirm-actions { display: flex; gap: 10px; width: 100%; margin-top: 22px; }
.confirm-actions .btn { flex: 1; }
.confirm-danger-btn { background: var(--action-danger); color: #fff; }
.confirm-danger-btn:hover { background: #d70015; color: #fff; }
.confirm-danger-btn:disabled { opacity: 0.6; }
</style>
