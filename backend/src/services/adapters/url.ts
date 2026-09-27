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
 * 厂商 endpoint 拼接：用户在配置里填的 baseUrl 形态五花八门
 * （带/不带协议、带/不带版本路径），这里统一保证最终 URL 落在
 * requiredPrefix 之下再接 path，且前缀不因用户已写而重复叠加。
 */

/** 段首补一个 '/'，空段原样返回 */
const slashHead = (seg: string) => (seg ? (seg.startsWith('/') ? seg : `/${seg}`) : '')

/** 去掉串尾的全部 '/' */
const trimTail = (s: string) => s.replace(/\/+$/, '')

/** 串尾若不以 prefix 收尾则接上 prefix */
const ensureTail = (s: string, prefix: string) => (s.endsWith(prefix) ? s : `${s}${prefix}`)

export function joinProviderUrl(baseUrl: string, requiredPrefix: string, path: string) {
  const prefix = slashHead(requiredPrefix)
  const tail = slashHead(path)
  const base = trimTail(baseUrl || '')
  if (!base) return `${prefix}${tail}`

  try {
    const parsed = new URL(base)
    // 能走 URL 对象：只在 pathname 上做前缀合并，query/hash 原样保留
    parsed.pathname = `${ensureTail(trimTail(parsed.pathname), prefix)}${tail}`.replace(/\/{2,}/g, '/')
    return parsed.toString()
  } catch {
    // 非法 URL（裸 host 等）退化为纯字符串拼接
    return `${ensureTail(base, prefix)}${tail}`
  }
}
