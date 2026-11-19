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
 * Drama Mill — 出网地址安全校验（SSRF 兜底）
 * 入库、探测、远程下载、参考图拉取四处共用同一套规则：
 *   1) 协议只放行 http/https
 *   2) 主机名先按字面量判私网（含 IPv6 字面量、IPv4 映射地址）
 *   3) 再做一次 DNS 解析，按解析结果判私网（挡 `2130706433`、解析到内网的域名等）
 * 自建网关 / 本机 Ollama 等确需访问内网的部署，显式设置 ALLOW_PRIVATE_OUTBOUND=true 放行。
 */
import dns from 'dns/promises'
import { URL } from 'url'

const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_OUTBOUND === 'true'
const PRIVATE_OUTBOUND_MESSAGE = '不允许访问内网地址'

/** 校验出网 URL；不合法抛错（调用方按 badRequest / 失败处理），合法静默返回 */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<void> {
  if (ALLOW_PRIVATE) return
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('不支持的协议，仅允许 http/https')
  }
  // IPv6 字面量在 URL.hostname 中带方括号（[::1]），去掉后再比对
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  // 字面量直判
  if (isPrivateIp(hostname)) throw new Error(PRIVATE_OUTBOUND_MESSAGE)
  // DNS 解析后复判：挡十进制/八进制等变体写法与解析到内网的域名
  try {
    const { address } = await dns.lookup(hostname)
    if (isPrivateIp(address)) throw new Error(PRIVATE_OUTBOUND_MESSAGE)
  } catch (err: any) {
    if (err?.message === PRIVATE_OUTBOUND_MESSAGE) throw err
    // 解析失败交给真实请求去报错，这里不改变原有失败语义
  }
}

/** 重定向状态码：这些响应需要按 Location 逐跳复校验后再跟 */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECT_HOPS = 3

/**
 * 自动跟随重定向的安全 fetch：每一跳都重新过 assertSafeOutboundUrl。
 * 原生 fetch 默认跟随重定向却只校验首跳，公网地址 302 到 169.254.169.254 即可绕过校验。
 */
export async function fetchWithSafeRedirects(rawUrl: string, init: RequestInit = {}, maxHops = MAX_REDIRECT_HOPS): Promise<Response> {
  let current = rawUrl
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertSafeOutboundUrl(current)
    const resp = await fetch(current, { ...init, redirect: 'manual' })
    if (!REDIRECT_STATUS.has(resp.status)) return resp
    const location = resp.headers.get('location')
    if (!location) return resp
    current = new URL(location, current).toString()
  }
  throw new Error('重定向次数过多')
}

/** 私网 / 保留地址判定（IPv4 段 + IPv6 前缀，含 IPv4 映射形态） */
export function isPrivateIp(ip: string): boolean {
  const addr = String(ip || '').trim().toLowerCase()
  if (!addr) return false
  return isPrivateIpv4(mappedIpv4(addr) || addr) || isPrivateIpv6(addr)
}

/**
 * IPv4 映射的 IPv6（::ffff:127.0.0.1，URL 解析后会被归一到 ::ffff:7f00:1）还原成点分 IPv4，
 * 否则可用 [::ffff:127.0.0.1] 绕过环回拦截；非映射形态返回 null。
 */
function mappedIpv4(addr: string): string | null {
  if (!addr.startsWith('::ffff:')) return null
  const rest = addr.slice('::ffff:'.length)
  if (rest.includes('.')) return rest
  const m = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!m) return null
  const hi = parseInt(m[1], 16)
  const lo = parseInt(m[2], 16)
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map(p => Number(p))
  if (octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = octets
  if (a === 127) return true                      // 127.0.0.0/8 环回
  if (a === 10) return true                       // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true         // 192.168.0.0/16
  if (a === 169 && b === 254) return true         // 169.254.0.0/16 链路本地（含 169.254.169.254 元数据）
  if (a === 0) return true                        // 0.0.0.0/8
  if (a >= 224) return true                       // 组播 / 保留段
  return false
}

function isPrivateIpv6(ip: string): boolean {
  if (ip === '::1' || ip === '::') return true     // 环回 / 未指定
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true // fc00::/7 唯一本地
  if (/^fe[89ab]/.test(ip)) return true            // fe80::/10 链路本地
  return false
}
