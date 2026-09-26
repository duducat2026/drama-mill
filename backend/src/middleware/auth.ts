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
 * 鉴权中间件 — JWT 解析注入 c.set('user')，管理员守卫
 * 白名单：健康检查与登录接口；/static 静态资源不经此中间件（挂载在 api 路由上）
 */
import type { Context, Next } from 'hono'
import { getUserById, verifyToken, type AuthUser } from '../services/auth.js'

const AUTH_WHITELIST = ['/api/v1/health', '/api/v1/auth/login']

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const path = c.req.path
  if (AUTH_WHITELIST.includes(path)) return next()

  const header = c.req.header('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const payload = token ? verifyToken(token) : null
  if (!payload) {
    return c.json({ code: 401, message: '未登录或登录已过期' }, 401)
  }

  // token 有效但账号已被禁用/删除：实时校验数据库状态
  const row = await getUserById(payload.id)
  if (!row || row.status !== 'active') {
    return c.json({ code: 401, message: '账号已被禁用，请联系管理员' }, 401)
  }

  c.set('user', {
    id: row.id,
    username: row.username,
    role: row.role as 'user' | 'admin',
    nickname: row.nickname,
    // 模型调用总开关随请求注入：鉴权已查过用户行，下游判定零额外查询
    aiCallEnabled: row.aiCallEnabled !== false,
  })
  return next()
}

/** 管理员守卫：挂在 /admin 子路由上 */
export async function adminGuard(c: Context, next: Next) {
  const user = c.get('user')
  if (!user || user.role !== 'admin') {
    return c.json({ code: 403, message: '需要管理员权限' }, 403)
  }
  return next()
}
