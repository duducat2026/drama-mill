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
    <div class="admin-page-title">用户管理</div>
    <div class="admin-page-desc">账号检索、新增账号、启用/禁用与重置密码</div>

    <div class="admin-toolbar">
      <input v-model="filters.keyword" class="input" placeholder="搜索用户名/昵称" @keyup.enter="load(1)" />
      <select v-model="filters.status" class="input" @change="load(1)">
        <option value="">全部状态</option>
        <option value="active">启用</option>
        <option value="disabled">禁用</option>
      </select>
      <button class="btn btn-sm" @click="load(1)">查询</button>
      <div style="flex:1"></div>
      <button class="btn btn-sm btn-primary" @click="showCreate = true">新增账号</button>
    </div>

    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>用户名</th><th>昵称</th><th>角色</th><th>状态</th><th>存储用量</th><th>最近登录</th><th>创建时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in rows" :key="u.id">
            <td>{{ u.id }}</td>
            <td>{{ u.username }}</td>
            <td>{{ u.nickname || '-' }}</td>
            <td><span class="admin-tag" :class="u.role === 'admin' ? 'admin-tag-blue' : ''">{{ u.role === 'admin' ? '管理员' : '用户' }}</span></td>
            <td><span class="admin-tag" :class="u.status === 'active' ? 'admin-tag-green' : 'admin-tag-red'">{{ u.status === 'active' ? '启用' : '禁用' }}</span></td>
            <td>
              <div :style="u.storage_exceeded ? { color: 'var(--action-danger, #d70015)', fontWeight: 600 } : {}">
                {{ fmtSize(u.storage_usage_bytes) }} / {{ fmtSize(u.storage_quota_bytes) }}
              </div>
              <div class="admin-cells-sub">
                <template v-if="u.storage_quota_custom">自定义配额</template>
                <template v-else>全局默认</template>
                <template v-if="u.storage_exceeded"> · 超额</template>
              </div>
            </td>
            <td>{{ fmt(u.last_login_at) }}</td>
            <td>{{ fmt(u.created_at) }}</td>
            <td>
              <div style="display:flex;gap:6px">
                <button class="btn btn-sm" @click="toggleStatus(u)">{{ u.status === 'active' ? '禁用' : '启用' }}</button>
                <button class="btn btn-sm" @click="setQuota(u)">配额</button>
                <button class="btn btn-sm" @click="resetPwd(u)">重置密码</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="admin-empty">暂无用户</div>
    </div>

    <div class="admin-pager">
      <span>共 {{ total }} 条 · 第 {{ page }} 页</span>
      <button class="btn btn-sm" :disabled="page <= 1" @click="load(page - 1)">上一页</button>
      <button class="btn btn-sm" :disabled="rows.length < pageSize" @click="load(page + 1)">下一页</button>
    </div>

    <!-- 新增账号弹窗 -->
    <div v-if="showCreate" class="admin-modal-mask" @click.self="showCreate = false">
      <div class="admin-modal">
        <div class="admin-page-title">新增账号</div>
        <label class="admin-label">用户名</label>
        <input v-model="createForm.username" class="input" />
        <label class="admin-label">密码</label>
        <input v-model="createForm.password" class="input" type="password" />
        <label class="admin-label">昵称（可选）</label>
        <input v-model="createForm.nickname" class="input" />
        <label class="admin-label">角色</label>
        <select v-model="createForm.role" class="input">
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
        <div class="admin-modal-actions">
          <button class="btn btn-sm" @click="showCreate = false">取消</button>
          <button class="btn btn-sm btn-primary" :disabled="creating" @click="createUser">{{ creating ? '创建中…' : '创建' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { adminAPI } from '~/composables/useApi'
definePageMeta({ layout: 'admin' })

const filters = reactive({ keyword: '', status: '' })
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const showCreate = ref(false)
const creating = ref(false)
const createForm = reactive({ username: '', password: '', nickname: '', role: 'user' })

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-'
}

function fmtSize(bytes?: number | null) {
  if (bytes == null) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`
}

// 设置存储配额（GB）：留空或 0 恢复全局默认（后端 STORAGE_QUOTA_GB，默认 1GB）
async function setQuota(u: any) {
  const cur = u.storage_quota_custom ? fmtSize(u.storage_quota_bytes) : '全局默认'
  const input = prompt(`为用户 ${u.username} 设置存储配额（单位 GB）：\n当前：${cur}\n留空或填 0 恢复全局默认`, '')
  if (input === null) return
  try {
    await adminAPI.updateUser(u.id, { storage_quota_gb: input.trim() })
    toast.success('配额已更新')
    load(page.value)
  } catch (e: any) { toast.error(e.message) }
}

async function load(p = 1) {
  page.value = p
  const data = await adminAPI.users({ keyword: filters.keyword, status: filters.status, page: p, page_size: pageSize.value })
  rows.value = data.items
  total.value = data.total
}

async function toggleStatus(u: any) {
  try {
    await adminAPI.updateUser(u.id, { status: u.status === 'active' ? 'disabled' : 'active' })
    toast.success(u.status === 'active' ? '已禁用' : '已启用')
    load(page.value)
  } catch (e: any) { toast.error(e.message) }
}

async function resetPwd(u: any) {
  const pwd = prompt(`为用户 ${u.username} 设置新密码（至少 4 位）：`)
  if (!pwd) return
  try {
    await adminAPI.updateUser(u.id, { password: pwd })
    toast.success('密码已重置')
  } catch (e: any) { toast.error(e.message) }
}

async function createUser() {
  creating.value = true
  try {
    await adminAPI.createUser({ ...createForm })
    toast.success('账号已创建')
    showCreate.value = false
    createForm.username = createForm.password = createForm.nickname = ''
    createForm.role = 'user'
    load(1)
  } catch (e: any) { toast.error(e.message) } finally { creating.value = false }
}

onMounted(() => load(1))
</script>

<style scoped>
.admin-modal-mask {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
}
.admin-modal {
  width: 360px; background: #fff; border-radius: 14px;
  padding: 22px; display: flex; flex-direction: column;
  box-shadow: 0 16px 48px rgba(0,0,0,0.18);
}
.admin-label { font-size: 12px; font-weight: 600; color: var(--text-1); margin: 12px 0 6px; }
.admin-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
