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
  <div ref="root" class="user-menu" :class="{ 'is-sm': size === 'sm' }">
    <button
      type="button"
      class="um-trigger"
      :class="{ open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="um-avatar">{{ userInitial }}</span>
      <span v-if="displayName" class="um-name">{{ displayName }}</span>
      <ChevronDown :size="13" :stroke-width="2" class="um-caret" />
    </button>

    <div v-if="open" class="um-panel" role="menu" @click.stop>
      <div class="um-account">
        <span class="um-account-name">{{ displayName }}</span>
        <span class="um-account-sub">@{{ user?.username || '-' }}</span>
        <span v-if="isAdmin" class="um-account-role">管理员</span>
      </div>
      <button type="button" class="um-item" role="menuitem" @click="openChangePassword">
        <KeyRound :size="14" :stroke-width="1.8" />
        <span>修改密码</span>
      </button>
      <NuxtLink v-if="isAdmin" to="/admin/panel" class="um-item" role="menuitem" @click="close">
        <ShieldCheck :size="14" :stroke-width="1.8" />
        <span>管理后台</span>
      </NuxtLink>
      <div class="um-divider"></div>
      <button type="button" class="um-item is-danger" role="menuitem" @click="onLogout">
        <LogOut :size="14" :stroke-width="1.8" />
        <span>退出登录</span>
      </button>
    </div>

    <ChangePasswordDialog :open="showChangePassword" @close="showChangePassword = false" />
  </div>
</template>

<script setup>
import { ChevronDown, KeyRound, LogOut, ShieldCheck } from 'lucide-vue-next'
import ChangePasswordDialog from '~/components/ChangePasswordDialog.vue'

defineProps({
  // default = 全站顶栏；sm = 工作台顶栏等紧凑场景
  size: { type: String, default: 'default' },
})

const route = useRoute()
const { user, token, isAdmin, fetchMe, logout } = useAuth()
const root = ref(null)
const open = ref(false)
const showChangePassword = ref(false)

// SSR 首帧还没有 user：名称留空只显头像，hydrate 后 fetchMe 补齐，避免闪一下「未登录」
const displayName = computed(() => user.value?.nickname || user.value?.username || '')
const userInitial = computed(() => (displayName.value || '?').trim().charAt(0).toUpperCase())

// 顶栏跨页面复用：刷新后 user 为空时按 token 拉一次当前用户，保证用户名始终可见
onMounted(() => { if (!user.value && token.value) fetchMe() })
watch(() => token.value, (v) => { if (v && !user.value) fetchMe() })

function toggle() { open.value = !open.value }
function close() { open.value = false }

function openChangePassword() {
  close()
  showChangePassword.value = true
}

function onLogout() {
  close()
  logout()
}

function onDocumentClick(e) {
  if (open.value && root.value && !root.value.contains(e.target)) close()
}
function onKeydown(e) {
  if (e.key === 'Escape') close()
}

// 路由切换后收起面板，避免下拉残留到新页面
watch(() => route.fullPath, close)

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.user-menu { position: relative; display: flex; align-items: center; }

.um-trigger {
  display: flex; align-items: center; gap: 8px;
  min-height: 34px; padding: 3px 10px 3px 4px;
  border: 1px solid transparent; border-radius: var(--radius-pill);
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-1); cursor: pointer;
  font: inherit;
  transition: all 0.16s var(--ease-out);
}
.um-trigger:hover { background: rgba(0, 0, 0, 0.07); color: var(--text-0); }
.um-trigger.open { background: #fff; border-color: var(--border); box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
.um-trigger:focus-visible { outline: none; box-shadow: 0 0 0 3.5px var(--button-focus); }

.um-avatar {
  width: 26px; height: 26px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: var(--text-0); color: #fff;
  font-size: 12px; font-weight: 700; line-height: 1;
}
.um-name {
  max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12.5px; font-weight: 600;
}
.um-caret { color: var(--text-3); transition: transform 0.16s var(--ease-out); }
.um-trigger.open .um-caret { transform: rotate(180deg); }

/* 紧凑态：工作台顶栏空间有限，收窄用户名展示宽度 */
.is-sm .um-trigger { min-height: 30px; background: transparent; border-color: var(--border); }
.is-sm .um-avatar { width: 22px; height: 22px; font-size: 11px; }
.is-sm .um-name { max-width: 96px; font-size: 12px; }

.um-panel {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 60;
  width: 208px; display: grid; gap: 2px; padding: 6px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-raised); box-shadow: var(--shadow-lg);
  animation: scaleIn 0.16s var(--ease-out);
}

.um-account {
  display: grid; gap: 2px;
  padding: 8px 10px 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.um-account-name { font-size: 13px; font-weight: 700; color: var(--text-0); }
.um-account-sub { font-size: 11.5px; color: var(--text-3); }
.um-account-role {
  justify-self: start; margin-top: 4px;
  font-size: 10.5px; font-weight: 600;
  color: var(--accent-text); background: var(--accent-bg);
  padding: 2px 8px; border-radius: var(--radius-pill);
}

.um-item {
  display: flex; align-items: center; gap: 8px;
  min-height: 32px; padding: 0 10px;
  border: none; border-radius: 7px;
  background: transparent; color: var(--text-1);
  font: inherit; font-size: 12.5px; font-weight: 600;
  text-align: left; text-decoration: none; cursor: pointer;
  transition: all 0.14s var(--ease-out);
}
.um-item:hover { background: var(--bg-hover); color: var(--text-0); }
.um-item:focus-visible { outline: none; background: var(--bg-hover); box-shadow: 0 0 0 2px var(--button-focus); }
.um-item.is-danger { color: var(--action-danger); }
.um-item.is-danger:hover { background: var(--action-danger-bg); color: var(--action-danger); }

.um-divider { height: 1px; margin: 4px 0; background: var(--border); }

/* 窄屏：仅保留头像，用户名与角色在展开的面板内仍可见 */
@media (max-width: 560px) {
  .um-name, .um-caret { display: none; }
  .um-trigger { padding-right: 4px; }
}
</style>
