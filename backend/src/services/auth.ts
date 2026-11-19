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
 * 认证服务 — 密码哈希、JWT 签发/校验、用户查询
 */
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

// 密钥只允许外部注入：缺失或仍是公开默认值时拒绝启动，避免开源默认值可用于伪造任意用户 token
const JWT_SECRET = process.env.JWT_SECRET
const KNOWN_DEFAULTS = ['drama-mill-jwt-secret-change-me']
if (!JWT_SECRET || KNOWN_DEFAULTS.includes(JWT_SECRET)) {
  console.error('[FATAL] JWT_SECRET 未配置或使用了公开默认值，拒绝启动。请设置强随机密钥: openssl rand -base64 32')
  process.exit(1)
}
const TOKEN_TTL = process.env.JWT_TTL || '7d'

export interface AuthUser {
  id: number
  username: string
  role: 'user' | 'admin'
  nickname: string | null
  /** 模型调用总开关（用户侧）：实时取自 users.ai_call_enabled，token 内不存，关闭后即时生效无需重登 */
  aiCallEnabled: boolean
  /** token 版本号：改密/登出/管理员重置口令时递增，使旧 token 立即失效 */
  tokenVersion?: number
}

export type UserRow = typeof schema.users.$inferSelect

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10)
}

export function verifyPassword(password: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(password, hash)
  } catch {
    return false
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, tv: user.tokenVersion || 0 },
    JWT_SECRET as string,
    { expiresIn: TOKEN_TTL, algorithm: 'HS256' } as jwt.SignOptions,
  )
}

export function verifyToken(token: string): AuthUser | null {
  try {
    // 只接受 HS256：阻断 alg=none / 非对称算法混淆类伪造
    const payload = jwt.verify(token, JWT_SECRET as string, { algorithms: ['HS256'] }) as {
      id: number
      username: string
      role: 'user' | 'admin'
      tv?: number
    }
    // 开关状态不入 token：鉴权中间件随后按用户行实时覆盖，关闭即时生效无需重新登录
    return {
      id: payload.id,
      username: payload.username,
      role: payload.role,
      nickname: null,
      aiCallEnabled: true,
      tokenVersion: payload.tv || 0,
    }
  } catch {
    return null
  }
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.username, username))
  return row || null
}

export async function getUserById(id: number): Promise<UserRow | null> {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id))
  return row || null
}

/** 对外输出时剔除密码哈希 */
export function toPublicUser(row: UserRow) {
  const { passwordHash, ...rest } = row
  return rest
}
