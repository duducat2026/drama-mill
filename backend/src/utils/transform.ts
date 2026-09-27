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
 * 出参字段名转换：Drizzle 行对象是 camelCase，接口层统一转回 snake_case
 * 下发前端（沿用旧 Go 后端的字段命名，前端契约不可破）
 */

// 只在顶层键上做替换，值原样透传
const CAMEL_EDGE = /[A-Z]/g

function snakeifyKey(key: string): string {
  return key.replace(CAMEL_EDGE, upper => `_${upper.toLowerCase()}`)
}

export function toSnakeCase(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  Object.entries(obj).forEach(([key, value]) => {
    out[snakeifyKey(key)] = value
  })
  return out
}

export function toSnakeCaseArray(arr: Record<string, any>[]): Record<string, any>[] {
  return arr.map(row => toSnakeCase(row))
}
