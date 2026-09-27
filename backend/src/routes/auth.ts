/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
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
 * 认证路由 — 登录 / 当前用户 / 修改密码 / 登出
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest } from '../utils/response.js'
import { getUserByUsername, getUserById, hashPassword, signToken, toPublicUser, verifyPassword } from '../services/auth.js'
import { getUserQuotaStatus } from '../services/storage-quota.js'
import { isAiCallEnabled, setAiCallEnabled } from '../services/ai-switch.js'
import { getWatchdogSwitches, isWatchdogKind, setWatchdogSwitch, type WatchdogKind } from '../services/watchdog-switch.js'
import { now } from '../utils/response.js'

const app = new Hono()

/** 用户侧自助改密的新密码最小长度（管理员建号/重置仍沿用 4 位下限） */
const MIN_PASSWORD_LEN = 6

// POST /auth/login — 账号密码登录，签发 JWT
app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  if (!username || !password) return badRequest(c, '用户名和密码不能为空')

  const user = await getUserByUsername(username)
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return c.json({ code: 401, message: '用户名或密码错误' }, 401)
  }
  if (user.status !== 'active') {
    return c.json({ code: 403, message: '账号已被禁用，请联系管理员' }, 403)
  }

  await db.update(schema.users)
    .set({ lastLoginAt: now(), updatedAt: now() })
    .where(eq(schema.users.id, user.id))

  const token = signToken({ id: user.id, username: user.username, role: user.role as 'user' | 'admin', nickname: user.nickname, aiCallEnabled: user.aiCallEnabled !== false })
  return success(c, { token, user: toPublicUser(user) })
})

// GET /auth/me — 当前登录用户信息（含模型调用总开关状态）
app.get('/me', async (c) => {
  const user = c.get('user')
  return success(c, user)
})

// POST /auth/change-password — 用户侧修改本人密码：校验原密码后落 bcrypt 新哈希
// 已签发的 JWT 仍在新有效期内（无状态令牌无黑名单），如需立即失效需重新登录
app.post('/change-password', async (c) => {
  const me = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const oldPassword = String(body?.oldPassword || '')
  const newPassword = String(body?.newPassword || '')
  const confirmPassword = String(body?.confirmPassword ?? newPassword)

  if (!oldPassword || !newPassword) return badRequest(c, '原密码和新密码不能为空')
  if (newPassword.length < MIN_PASSWORD_LEN) return badRequest(c, `新密码至少 ${MIN_PASSWORD_LEN} 位`)
  if (newPassword !== confirmPassword) return badRequest(c, '两次输入的新密码不一致')
  if (newPassword === oldPassword) return badRequest(c, '新密码不能与原密码相同')

  // 原密码校验失败统一按 400 返回：避免 401 触发前端「登录态失效」跳转逻辑
  const row = await getUserById(me.id)
  if (!row || !verifyPassword(oldPassword, row.passwordHash)) return badRequest(c, '原密码不正确')

  await db.update(schema.users)
    .set({ passwordHash: hashPassword(newPassword), updatedAt: now() })
    .where(eq(schema.users.id, me.id))

  return success(c, { changed: true, user_id: me.id })
})

// GET /auth/ai-call — 模型调用总开关状态（用户侧读取，默认开启）
app.get('/ai-call', async (c) => {
  const user = c.get('user')
  return success(c, { enabled: await isAiCallEnabled(user.id), user_id: user.id })
})

// PUT /auth/ai-call — 用户侧直接打开/关闭本人的模型调用（关闭后所有 AI 调用被后端拦截）
app.put('/ai-call', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  if (typeof body?.enabled !== 'boolean') return badRequest(c, 'enabled 必须为布尔值')
  const enabled = await setAiCallEnabled(user.id, body.enabled)
  return success(c, { enabled })
})

// GET /auth/watchdogs — 两个后台看门狗的用户侧授权状态（默认均为不启动）
app.get('/watchdogs', async (c) => {
  const user = c.get('user')
  return success(c, await getWatchdogSwitches(user.id))
})

// PUT /auth/watchdogs — 开启/关闭本人某个看门狗（自动重提 / 缺图补生成），返回写入后的全部状态
app.put('/watchdogs', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const kind = body?.kind
  if (!isWatchdogKind(kind)) return badRequest(c, 'kind 必须为 retry 或 asset')
  if (typeof body?.enabled !== 'boolean') return badRequest(c, 'enabled 必须为布尔值')
  return success(c, await setWatchdogSwitch(user.id, kind as WatchdogKind, body.enabled))
})

// GET /auth/storage-quota — 当前用户存储配额状态（用量/生效配额/是否超额），超额时用户侧展示告警
app.get('/storage-quota', async (c) => {
  const user = c.get('user')
  return success(c, await getUserQuotaStatus(user.id))
})

// POST /auth/logout — 无状态 JWT：前端清除 token 即可，这里仅返回成功
app.post('/logout', (c) => success(c))

export default app
