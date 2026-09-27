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
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="close">
      <div class="dialog pwd-dialog" role="dialog" aria-modal="true" aria-label="修改密码">
        <div class="pwd-head">
          <div class="pwd-head-icon">
            <KeyRound :size="18" :stroke-width="1.8" />
          </div>
          <div class="pwd-head-copy">
            <h2 class="dialog-title">修改密码</h2>
            <p class="pwd-desc">{{ user?.nickname || user?.username }} · 校验原密码后生效，当前登录状态保持不变</p>
          </div>
          <button type="button" class="pwd-close" aria-label="关闭" @click="close">
            <X :size="16" :stroke-width="1.9" />
          </button>
        </div>

        <form class="pwd-form" @submit.prevent="submit">
          <div class="pwd-body">
            <label class="pwd-field">
              <span class="pwd-label">原密码 <span class="pwd-required">*</span></span>
              <input v-model="form.oldPassword" class="input" type="password" autocomplete="current-password" placeholder="请输入当前密码" required />
            </label>
            <label class="pwd-field">
              <span class="pwd-label">新密码 <span class="pwd-required">*</span></span>
              <input v-model="form.newPassword" class="input" type="password" autocomplete="new-password" :placeholder="`至少 ${MIN_PWD_LEN} 位`" required />
            </label>
            <label class="pwd-field">
              <span class="pwd-label">确认新密码 <span class="pwd-required">*</span></span>
              <input v-model="form.confirmPassword" class="input" type="password" autocomplete="new-password" placeholder="再次输入新密码" required />
            </label>
            <div v-if="error" class="pwd-error">{{ error }}</div>
          </div>
          <div class="pwd-foot">
            <button type="button" class="btn" :disabled="submitting" @click="close">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="submitting">
              <Loader2 v-if="submitting" :size="13" class="animate-spin" />
              {{ submitting ? '提交中…' : '确认修改' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { KeyRound, Loader2, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const MIN_PWD_LEN = 6

const { user, changePassword } = useAuth()
const form = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const error = ref('')
const submitting = ref(false)

// 每次打开都从空白开始，避免残留上一次的输入
watch(() => props.open, (v) => {
  if (!v) return
  form.oldPassword = ''
  form.newPassword = ''
  form.confirmPassword = ''
  error.value = ''
})

function close() {
  if (submitting.value) return
  emit('close')
}

/** 前端先挡一轮，减少无效请求；后端仍按同规则二次校验 */
function validate() {
  if (!form.oldPassword || !form.newPassword || !form.confirmPassword) return '请填写完整的原密码与新密码'
  if (form.newPassword.length < MIN_PWD_LEN) return `新密码至少 ${MIN_PWD_LEN} 位`
  if (form.newPassword !== form.confirmPassword) return '两次输入的新密码不一致'
  if (form.newPassword === form.oldPassword) return '新密码不能与原密码相同'
  return ''
}

async function submit() {
  if (submitting.value) return
  error.value = validate()
  if (error.value) return

  submitting.value = true
  try {
    await changePassword(form.oldPassword, form.newPassword, form.confirmPassword)
    toast.success('密码已修改')
    emit('close')
  } catch (e) {
    error.value = e?.message || '修改失败，请稍后再试'
  } finally {
    submitting.value = false
  }
}

function onKeydown(e) {
  if (e.key === 'Escape' && props.open) emit('close')
}

watch(() => props.open, (v) => {
  if (v) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.pwd-dialog { width: 420px; max-width: calc(100vw - 32px); }

.pwd-head {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border);
}
.pwd-head-icon {
  width: 38px; height: 38px; flex: 0 0 auto;
  border-radius: var(--radius);
  background: var(--accent-bg); color: var(--accent);
  display: flex; align-items: center; justify-content: center;
}
.pwd-head-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pwd-desc { font-size: 12px; color: var(--text-3); line-height: 1.5; }
.pwd-close {
  margin-left: auto; flex-shrink: 0;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 7px;
  background: transparent; color: var(--text-2); cursor: pointer;
  transition: all 0.15s var(--ease-out);
}
.pwd-close:hover { background: var(--bg-hover); color: var(--text-0); }

.pwd-form { display: flex; flex-direction: column; min-height: 0; }
.pwd-body { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px 4px; }
.pwd-field { display: flex; flex-direction: column; gap: 6px; }
.pwd-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.pwd-required { color: var(--error); }
.pwd-error {
  padding: 8px 12px;
  font-size: 12.5px; color: var(--action-danger);
  background: var(--action-danger-bg);
  border-radius: var(--radius);
}
.pwd-foot {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 20px 18px;
}
</style>
