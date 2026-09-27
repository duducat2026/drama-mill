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
  <div class="admin-shell">
    <aside class="admin-side">
      <button class="admin-brand" @click="navigateTo('/')">
        <div class="admin-brand-mark">剧</div>
        <div class="admin-brand-text">
          <span class="admin-brand-name">管理后台</span>
          <span class="admin-brand-sub">Drama Mill Admin</span>
        </div>
      </button>

      <nav class="admin-nav">
        <NuxtLink v-for="item in NAV_ITEMS" :key="item.path" :to="item.path" class="admin-nav-link" :class="{ active: route.path === item.path }">
          <component :is="item.icon" :size="15" :stroke-width="1.8" />
          <span>{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <div class="admin-side-foot">
        <div class="admin-user">
          <span class="admin-user-name">{{ user?.nickname || user?.username }}</span>
          <span class="admin-user-role">管理员</span>
        </div>
        <button class="btn btn-sm" @click="logout()">退出登录</button>
      </div>
    </aside>

    <main class="admin-main">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import {
  Users, Image, Cpu, ScrollText, BookOpen, Clapperboard,
  Video, Film, Activity, Coins, HardDrive, Gauge, Bot, ListOrdered, Library, Tags,
} from 'lucide-vue-next'

const NAV_ITEMS = [
  { path: '/admin/panel', label: '生产面板', icon: Activity },
  { path: '/admin/monitor', label: '运行监控', icon: Gauge },
  { path: '/admin/cloud-queue', label: '云端队列', icon: ListOrdered },
  { path: '/admin/storage', label: '存储监控', icon: HardDrive },
  { path: '/admin/users', label: '用户管理', icon: Users },
  { path: '/admin/gateways', label: 'AI 网关', icon: Cpu },
  { path: '/admin/model-catalog', label: '模型目录价', icon: Tags },
  { path: '/admin/agents', label: 'Agent 配置', icon: Bot },
  { path: '/admin/assets', label: '资产管理', icon: Image },
  { path: '/admin/scripts', label: '平台剧本', icon: BookOpen },
  { path: '/admin/novels', label: '小说管理', icon: Library },
  { path: '/admin/storyboards', label: '平台分镜', icon: Clapperboard },
  { path: '/admin/videos', label: '平台视频', icon: Video },
  { path: '/admin/merges', label: '拼接成片', icon: Film },
  { path: '/admin/costs', label: 'AI 成本', icon: Coins },
  { path: '/admin/audit', label: '操作审计', icon: ScrollText },
]

const route = useRoute()
const { user, fetchMe, logout } = useAuth()

onMounted(async () => {
  // 未登录/非管理员拦截到登录页
  const me = user.value || await fetchMe()
  if (!me) return navigateTo('/login')
  if (me.role !== 'admin') return navigateTo('/')
})
</script>

<style scoped>
.admin-shell { display: flex; height: 100vh; overflow: hidden; background: var(--bg-base); }

.admin-side {
  width: 210px; flex-shrink: 0;
  display: flex; flex-direction: column;
  background: rgba(251,251,253,0.85);
  border-right: 1px solid var(--border);
  padding: 14px 10px;
}
.admin-brand {
  display: flex; align-items: center; gap: 10px;
  background: transparent; border: none; cursor: pointer;
  padding: 6px 8px; border-radius: var(--radius);
  margin-bottom: 14px;
}
.admin-brand:hover { background: var(--bg-hover); }
.admin-brand-mark {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: var(--text-0); color: #fff;
  font-size: 15px; font-weight: 700;
  border-radius: 9px;
}
.admin-brand-text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15; }
.admin-brand-name { font-size: 14px; font-weight: 700; color: var(--text-0); }
.admin-brand-sub { font-size: 10px; color: var(--text-3); letter-spacing: 0.04em; }

.admin-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; overflow-y: auto; }
.admin-nav-link {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px; border-radius: var(--radius);
  font-size: 13px; font-weight: 500;
  color: var(--text-2); text-decoration: none;
  transition: all 0.15s var(--ease-out);
}
.admin-nav-link:hover { background: var(--bg-hover); color: var(--text-0); }
.admin-nav-link.active { background: var(--accent-bg); color: var(--accent-text); font-weight: 600; }

.admin-side-foot { border-top: 1px solid var(--border); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.admin-user { display: flex; align-items: center; justify-content: space-between; padding: 0 8px; }
.admin-user-name { font-size: 12.5px; font-weight: 600; color: var(--text-1); }
.admin-user-role {
  font-size: 10.5px; color: var(--accent-text);
  background: var(--accent-bg);
  padding: 2px 8px; border-radius: var(--radius-pill);
}

.admin-main { flex: 1; overflow-y: auto; padding: 22px 26px; }
</style>

<!-- 管理后台各页面共用的表格/工具栏/分页样式 -->
<style>
.admin-page-title { font-size: 16px; font-weight: 700; color: var(--text-0); margin-bottom: 4px; }
.admin-page-desc { font-size: 12px; color: var(--text-3); margin-bottom: 16px; }

.admin-toolbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 14px;
}
.admin-toolbar .input, .admin-toolbar select.input { min-height: 32px; font-size: 12.5px; width: auto; }

.admin-table-wrap {
  background: #fff; border: 1px solid var(--border);
  border-radius: 12px; overflow: auto;
}
.admin-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.admin-table th {
  text-align: left; padding: 9px 12px;
  font-size: 11.5px; font-weight: 600; color: var(--text-3);
  background: rgba(0,0,0,0.02);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.admin-table td {
  padding: 9px 12px; color: var(--text-1);
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.admin-table tr:last-child td { border-bottom: none; }
.admin-table tr:hover td { background: rgba(0,0,0,0.015); }

.admin-empty { padding: 40px 0; text-align: center; color: var(--text-3); font-size: 12.5px; }

.admin-pager {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  margin-top: 12px; font-size: 12px; color: var(--text-2);
}

.admin-tag {
  display: inline-block; padding: 2px 8px;
  font-size: 11px; font-weight: 600;
  border-radius: var(--radius-pill);
  background: rgba(0,0,0,0.05); color: var(--text-2);
}
.admin-tag-green { background: rgba(52,199,89,0.12); color: #1a7f37; }
.admin-tag-red { background: rgba(255,59,48,0.1); color: var(--action-danger); }
.admin-tag-gray { background: rgba(0,0,0,0.07); color: var(--text-2); }
.admin-tag-blue { background: var(--accent-bg); color: var(--accent-text); }

.admin-cells-sub { font-size: 11.5px; color: var(--text-3); margin-top: 2px; }
.admin-cell-text { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.admin-preview { max-width: 140px; max-height: 80px; border-radius: 6px; border: 1px solid var(--border); display: block; }

.admin-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 18px; }
.admin-stat {
  background: #fff; border: 1px solid var(--border); border-radius: 12px;
  padding: 12px 14px;
}
.admin-stat-label { font-size: 11.5px; color: var(--text-3); }
.admin-stat-value { font-size: 20px; font-weight: 700; color: var(--text-0); margin-top: 4px; }
</style>
