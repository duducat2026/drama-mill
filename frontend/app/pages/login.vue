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
  <div class="login-shell">
    <div class="login-card">
      <div class="login-brand">
        <div class="login-mark">
          <img v-if="showBrandImage" :src="brandLogo" alt="短剧工坊" class="login-logo" @error="showBrandImage = false" />
          <span v-else>剧</span>
        </div>
        <div>
          <div class="login-title">短剧工坊</div>
          <div class="login-sub">AI 短剧自动化生产平台</div>
        </div>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <label class="login-label">用户名</label>
        <input v-model="username" class="input" type="text" placeholder="请输入用户名" autocomplete="username" required />
        <label class="login-label">密码</label>
        <div class="login-pwd">
          <input
            v-model="password"
            class="input"
            :type="showPassword ? 'text' : 'password'"
            placeholder="请输入密码" autocomplete="current-password" required
          />
          <button
            type="button" class="login-pwd-toggle"
            :title="showPassword ? '隐藏密码' : '显示密码'"
            :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword"
          >
            <EyeOff v-if="showPassword" :size="15" />
            <Eye v-else :size="15" />
          </button>
        </div>
        <div v-if="error" class="login-error">{{ error }}</div>
        <button class="btn btn-primary login-btn" type="submit" :disabled="loading">
          {{ loading ? '登录中…' : '登 录' }}
        </button>
      </form>

      <!-- 首次部署默认账号提示（种子账号，登录后应立即改密） -->
      <div class="login-hint">
        <div class="login-hint-title">首次部署默认账号</div>
        <div class="login-hint-row"><span>管理员</span><code>drama-mill</code><span>/</span><code>drama-mill</code></div>
        <div class="login-hint-row"><span>普通用户</span><code>test</code><span>/</span><code>drama-mill</code></div>
        <div class="login-hint-note">请在「右上角账号区 → 修改密码」中及时更换默认口令。</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import brandLogo from '~/assets/drama-mill-logo-128.png'
import { Eye, EyeOff } from 'lucide-vue-next'

definePageMeta({ layout: false })

const showBrandImage = ref(true)
const { login, isLoggedIn } = useAuth()
const username = ref('')
const password = ref('')
// 密码明文/密文切换（仅影响输入框显示，不改变提交值）
const showPassword = ref(false)
const error = ref('')
const loading = ref(false)

// 已登录直接进首页
onMounted(() => {
  if (isLoggedIn.value) navigateTo('/')
})

async function submit() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    await login(username.value.trim(), password.value)
    navigateTo('/')
  } catch (e: any) {
    error.value = e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-shell {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-base);
  padding: 24px;
}
.login-card {
  width: 380px; max-width: 100%;
  padding: 36px 32px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.08);
}
.login-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
.login-mark {
  width: 42px; height: 42px;
  display: flex; align-items: center; justify-content: center;
  background: var(--text-0); color: #fff;
  font-size: 19px; font-weight: 700;
  border-radius: 12px;
  overflow: hidden;
}
.login-logo {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.login-title { font-size: 17px; font-weight: 700; color: var(--text-0); }
.login-sub { font-size: 12px; color: var(--text-3); margin-top: 2px; }
.login-form { display: flex; flex-direction: column; }
.login-label { font-size: 12.5px; font-weight: 600; color: var(--text-1); margin: 12px 0 6px; }
/* 密码显示/隐藏切换 */
.login-pwd { position: relative; }
.login-pwd .input { padding-right: 34px; }
.login-pwd-toggle {
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border: none; border-radius: var(--radius);
  background: transparent; color: var(--text-3); cursor: pointer;
  transition: background 0.14s var(--ease-out), color 0.14s var(--ease-out);
}
.login-pwd-toggle:hover { background: var(--bg-2); color: var(--text-0); }
.login-pwd-toggle:focus-visible { outline: none; box-shadow: 0 0 0 3.5px var(--button-focus); }
.login-error {
  margin-top: 12px; padding: 8px 12px;
  font-size: 12.5px; color: var(--action-danger);
  background: var(--action-danger-bg);
  border-radius: var(--radius);
}
.login-btn { margin-top: 20px; min-height: 40px; width: 100%; }
/* 默认账号提示 */
.login-hint {
  margin-top: 20px; padding: 10px 12px;
  font-size: 12px; color: var(--text-3);
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.login-hint-title { font-weight: 600; color: var(--text-1); margin-bottom: 4px; }
.login-hint-row { display: flex; align-items: center; gap: 6px; line-height: 2; }
.login-hint-row code {
  padding: 1px 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--text-1);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.login-hint-note { margin-top: 4px; color: var(--text-3); }
</style>
