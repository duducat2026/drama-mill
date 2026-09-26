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
 * 操作审计中间件 — 记录所有用户/管理员的写操作（POST/PUT/DELETE）
 * 响应完成后异步落库，不阻塞主流程；敏感字段（密码/密钥）脱敏
 */
import type { Context, Next } from 'hono'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

/** 脱敏：api_key / password 等敏感字段一律替换为 *** */
const SENSITIVE_KEY = /api_?key|password|token|secret/i

function redactDetail(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const key of Object.keys(parsed)) {
        if (SENSITIVE_KEY.test(key)) parsed[key] = '***'
        if (typeof parsed[key] === 'string' && parsed[key].length > 500) parsed[key] = parsed[key].slice(0, 500) + '…'
      }
    }
    return JSON.stringify(parsed).slice(0, 2000)
  } catch {
    return raw.slice(0, 2000)
  }
}

export async function auditMiddleware(c: Context, next: Next) {
  await next()

  const method = c.req.method
  if (!['POST', 'PUT', 'DELETE'].includes(method)) return
  const path = c.req.path
  if (!path.startsWith('/api/v1')) return

  // 克隆请求读 body（原件可能已被下游消费）；读取失败不影响审计主体
  let detail: string | null = null
  try {
    const contentType = c.req.header('content-type') || ''
    if (contentType.includes('application/json')) {
      const clone = c.req.raw.clone()
      detail = redactDetail(await clone.text())
    } else if (contentType.includes('multipart/form-data')) {
      detail = '[file upload]'
    }
  } catch { /* body 不可读时仅记录路径 */ }

  const user = c.get('user')
  try {
    await db.insert(schema.auditLogs).values({
      userId: user?.id ?? null,
      username: user?.username ?? null,
      role: user?.role ?? null,
      method,
      path,
      action: `${method} ${path.replace(/^\/api\/v1/, '')}`,
      detail,
      ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || '',
      status: c.res.status,
      createdAt: now(),
    })
  } catch (err) {
    console.warn('[audit] 审计写入失败:', (err as Error).message)
  }
}
