/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/your-org/drama-mill)
 * Copyright (C) 2026 Drama Mill <52859273@qq.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 认证状态管理 — token 存 localStorage，useApi 统一注入 Authorization
 * 401 由 useApi 统一跳转登录页；禁用账号登录时后端返回提示信息
 */
import { api, accountAPI } from './useApi'

const TOKEN_KEY = 'drama_mill_token'

export interface AuthUser {
  id: number
  username: string
  role: 'user' | 'admin'
  nickname: string | null
  /** 模型调用总开关（用户侧）：false = 已关闭，后端拒绝一切新发起的 AI 调用 */
  aiCallEnabled?: boolean
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function useAuth() {
  const token = useState<string | null>('auth_token', () => getToken())
  const user = useState<AuthUser | null>('auth_user', () => null)

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  async function login(username: string, password: string) {
    const data = await api.post<{ token: string; user: AuthUser }>('/auth/login', { username, password })
    token.value = data.token
    user.value = data.user
    localStorage.setItem(TOKEN_KEY, data.token)
    return data.user
  }

  async function fetchMe() {
    if (!token.value) return null
    try {
      user.value = await api.get<AuthUser>('/auth/me')
      return user.value
    } catch {
      // token 失效/账号被禁用：清空本地状态
      logoutLocal()
      return null
    }
  }

  /** 修改本人密码：后端校验原密码并落新哈希；无状态 JWT 不失效，改完无需重新登录 */
  async function changePassword(oldPassword: string, newPassword: string, confirmPassword: string) {
    await accountAPI.changePassword({ oldPassword, newPassword, confirmPassword })
  }

  function logoutLocal() {
    token.value = null
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
  }

  async function logout() {
    try { await api.post('/auth/logout') } catch { /* 前端清 token 即可 */ }
    logoutLocal()
    navigateTo('/login')
  }

  return { token, user, isLoggedIn, isAdmin, login, fetchMe, logout, changePassword }
}
