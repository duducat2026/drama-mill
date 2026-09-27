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

// useApi 核心：请求底层 + 鉴权 + 列表缓存 + 管理端 query，经门面 ~/composables/useApi 汇总导出
export const BASE = '/api/v1'
const TOKEN_KEY = 'drama_mill_token'

/** 统一注入 Authorization；未登录/凭证失效时跳转登录页（登录接口自身除外） */
export function authHeaders(): Record<string, string> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function redirectToLogin(path: string) {
  if (path.startsWith('/auth/')) return
  try { localStorage.removeItem(TOKEN_KEY) } catch {}
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login'
  }
}

/** 解析响应体：非 JSON 响应（如网关/框架默认错误页）降级为文本，避免 JSON.parse 抛 Unexpected token */
async function parseBody(resp: Response): Promise<any> {
  const ct = resp.headers.get('content-type') || ''
  if (ct.includes('application/json')) return resp.json()
  const text = (await resp.text()).slice(0, 300)
  try { return JSON.parse(text) } catch { return { message: text || `请求失败 (${resp.status})` } }
}

async function req<T = any>(method: string, path: string, body?: any): Promise<T> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...authHeaders() } }
  if (body) opts.body = JSON.stringify(body)

  const start = performance.now()
  console.log(`%c[API] %c${method} %c${path}`, 'color:#888', 'color:#4fc3f7;font-weight:bold', 'color:#ccc', body || '')

  try {
    const resp = await fetch(`${BASE}${path}`, opts)
    const json = await parseBody(resp)
    const ms = Math.round(performance.now() - start)

    if (!resp.ok || (json.code && json.code >= 400)) {
      console.log(`%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold', 'color:#888', json.message || '')
      if (resp.status === 401) redirectToLogin(path)
      throw new Error(json.message || `${resp.status}`)
    }

    console.log(`%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`, 'color:#888', 'color:#66bb6a', 'color:#66bb6a;font-weight:bold', 'color:#888')
    return json.data ?? json
  } catch (err: any) {
    if (!err.message?.match(/^\d{3}$/)) {
      const ms = Math.round(performance.now() - start)
      console.log(`%c[API] %c${method} ${path} %cERROR %c${ms}ms`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold', 'color:#888', err.message)
    }
    throw err
  }
}

export const api = {
  get: <T = any>(p: string) => req<T>('GET', p),
  post: <T = any>(p: string, b?: any) => req<T>('POST', p, b),
  put: <T = any>(p: string, b?: any) => req<T>('PUT', p, b),
  del: <T = any>(p: string) => req<T>('DELETE', p),
}

export async function uploadReq<T = any>(path: string, file: File): Promise<T> {
  const fd = new FormData()
  fd.append('file', file)
  console.log(`%c[API] %cPOST %c${path} %c${file.name}`, 'color:#888', 'color:#4fc3f7;font-weight:bold', 'color:#ccc', 'color:#888')
  const resp = await fetch(`${BASE}${path}`, { method: 'POST', body: fd, headers: authHeaders() })
  const json = await parseBody(resp)
  if (!resp.ok || (json.code && json.code >= 400)) {
    console.log(`%c[API] %cPOST ${path} %c${resp.status}`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold')
    if (resp.status === 401) redirectToLogin(path)
    throw new Error(json.message || `${resp.status}`)
  }
  return json.data ?? json
}

/** 模块级列表缓存：低频变化的配置类列表避免多页面重复请求（TTL 5 分钟；写操作后失效） */
const listCache = new Map<string, { at: number; data: any }>()
const LIST_TTL = 5 * 60 * 1000
export function cachedList<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = listCache.get(key)
  if (hit && Date.now() - hit.at < LIST_TTL) return Promise.resolve(hit.data)
  return fetcher().then((data) => { listCache.set(key, { at: Date.now(), data }); return data })
}
export function invalidateListCache(prefix: string) {
  for (const key of listCache.keys()) {
    if (key.startsWith(prefix)) listCache.delete(key)
  }
}

// 管理后台（12 类接口，后端已做 admin 角色守卫）
export function adminQuery(params?: Record<string, any>): string {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v))
  }
  return query.size ? `?${query.toString()}` : ''
}
