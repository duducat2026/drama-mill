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

// MentionTextarea.vue 的纯函数工具（无响应式依赖，拆分超限文件时外提）
export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 由可引用名列表（[[name, group]]）构造 @引用匹配正则；无名字返回 null
export function buildHighlightRegex(names) {
  if (!names.length) return null
  const alt = names.map(([name]) => escapeRegExp(name)).join('|')
  return new RegExp(`@(${alt})`, 'g')
}

// 镜像层高亮 HTML：@引用 包上分组色彩 span，其余文本原样
export function renderHighlightedHtml(text, names) {
  let html = escapeHtml(text)
  const re = buildHighlightRegex(names)
  if (re) {
    const groupOf = Object.fromEntries(names)
    html = html.replace(re, (m, name) =>
      `<span class="mention-token mention-token-${groupOf[name]}">@${escapeHtml(name)}</span>`)
  }
  if (html.endsWith('\n')) html += '\u200b'
  return html
}

// 光标前最近一个 @token（@ 后不含空白），命中则处于引用输入态
export function detectActiveMention(value, pos) {
  const before = value.slice(0, pos)
  const m = before.match(/@([^\s@]{0,20})$/)
  if (!m) return null
  return { start: pos - m[0].length, query: m[1] }
}

// 光标紧邻一个完整 @引用（用于整体退格删除）
export function mentionBeforeCaret(value, pos, names) {
  const before = value.slice(0, pos)
  for (const [name] of names) {
    if (before.endsWith(`@${name}`)) return { start: pos - name.length - 1, end: pos }
  }
  return null
}
// 光标紧邻一个完整 @引用（用于整体 Delete 删除）
export function mentionAfterCaret(value, pos, names) {
  const after = value.slice(pos)
  for (const [name] of names) {
    if (after.startsWith(`@${name}`)) return { start: pos, end: pos + name.length + 1 }
  }
  return null
}

// 镜像 div 测量 textarea 光标坐标（视口相对，附行高）
export function getCaretCoordinates(textarea, position) {
  const div = document.createElement('div')
  const style = getComputedStyle(textarea)
  const propsToCopy = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textIndent',
  ]
  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.wordWrap = 'break-word'
  div.style.top = '0'
  div.style.left = '-9999px'
  for (const p of propsToCopy) div.style[p] = style[p]
  div.textContent = textarea.value.substring(0, position)
  const span = document.createElement('span')
  span.textContent = textarea.value.substring(position) || '.'
  div.appendChild(span)
  document.body.appendChild(div)
  const rect = { top: span.offsetTop, left: span.offsetLeft }
  document.body.removeChild(div)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.7 || 20
  return { ...rect, lineHeight }
}
