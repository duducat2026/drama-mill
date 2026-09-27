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
 * 小说分集纯函数 — 章节识别 + 目标字数贪心归组
 * 无运行时依赖，可独立单测
 */

export const DEFAULT_TARGET_CHARS = 15000
/** paragraphs 模式未指定每集段落数时的兜底值 */
export const DEFAULT_PARAGRAPHS_PER_EPISODE = 20

export interface Chapter {
  title: string
  content: string
}

export interface EpisodeGroup {
  chapters: Chapter[]
  text: string
  charCount: number
}

/** 去除空白字符的字数统计（中文场景惯例） */
export function countChars(text: string): number {
  return text.replace(/\s/g, '').length
}

// 章节头正则：中文「第X章/回/节」+ 英文 Chapter N；行首锚定，容忍缩进（含全角空格），
// 数字与章/回/节间允许空白；整行长度受限避免误伤正文（全角数字在识别前归一化）
const CHAPTER_RE = /^[ \t\u00A0\u3000]*第[ \t\u00A0\u3000]*[0-9一二三四五六七八九十百千零两]+[ \t\u00A0\u3000]*[章回节].{0,80}$/gm
const CHAPTER_RE_EN = /^[^\S\n]*Chapter\s+\d+[^\n]{0,80}$/gim
const MAX_HEADER_LINE_LENGTH = 100

/** 全角数字归一化为半角（1:1 映射不改变偏移）：老电子书常见「第１章」式章节头 */
function normalizeFullWidthDigits(text: string): string {
  return text.replace(/[\uFF10-\uFF19]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
}

/**
 * 识别章节：返回 [{title, content}]
 * - 首章前的引言 <500 字丢弃，否则并入第 1 章正文
 * - 无任何章节标记时整篇视为 1 章
 */
export function detectChapters(rawText: string): Chapter[] {
  const text = normalizeFullWidthDigits(rawText)
  const headers: { index: number; end: number; line: string }[] = []
  for (const re of [CHAPTER_RE, CHAPTER_RE_EN]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const line = m[0].trim()
      if (line.length <= MAX_HEADER_LINE_LENGTH) headers.push({ index: m.index, end: m.index + m[0].length, line })
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }
  if (!headers.length) return [{ title: '', content: text.trim() }]
  headers.sort((a, b) => a.index - b.index)
  // 去掉同一位置的重复匹配
  const unique = headers.filter((h, i) => i === 0 || h.index !== headers[i - 1].index)

  const chapters: Chapter[] = unique.map((h, i) => {
    const end = i + 1 < unique.length ? unique[i + 1].index : text.length
    return { title: h.line, content: text.slice(h.end, end).trim() }
  })

  // 首章前引言：<500 字丢弃，否则并入第 1 章
  const preamble = text.slice(0, unique[0].index).trim()
  if (countChars(preamble) >= 500) {
    chapters[0].content = (preamble + '\n\n' + chapters[0].content).trim()
  }
  return chapters.filter(c => c.content.length > 0 || c.title.length > 0)
}

/** 超长单章按段落边界切分为多段（标题加 (N) 后缀） */
function splitOversizedChapter(chapter: Chapter, targetChars: number): Chapter[] {
  if (countChars(chapter.content) <= targetChars * 2) return [chapter]
  const paragraphs = chapter.content.split(/\n+/).map(p => p.trim()).filter(Boolean)
  const pieces: Chapter[] = []
  let buf: string[] = []
  let bufChars = 0
  for (const p of paragraphs) {
    const pChars = countChars(p)
    if (buf.length && bufChars + pChars > targetChars) {
      pieces.push({ title: chapter.title, content: buf.join('\n\n') })
      buf = []
      bufChars = 0
    }
    buf.push(p)
    bufChars += pChars
  }
  if (buf.length) pieces.push({ title: chapter.title, content: buf.join('\n\n') })
  return pieces.map((p, i) => ({ ...p, title: pieces.length > 1 ? `${p.title}（${i + 1}）` : p.title }))
}

/**
 * 连续章节贪心归组到目标字数；超长单章先按段落切分
 * 返回每组的章节列表、拼接全文与字数
 */
export function groupChapters(chapters: Chapter[], targetChars: number = DEFAULT_TARGET_CHARS): EpisodeGroup[] {
  const expanded = chapters.flatMap(ch => splitOversizedChapter(ch, targetChars))
  const groups: EpisodeGroup[] = []
  let current: Chapter[] = []
  let currentChars = 0

  const flush = () => {
    if (!current.length) return
    const text = current.map(ch => (ch.title ? `${ch.title}\n\n${ch.content}` : ch.content)).join('\n\n')
    groups.push({ chapters: current, text, charCount: countChars(text) })
    current = []
    currentChars = 0
  }

  for (const ch of expanded) {
    const chChars = countChars(ch.content)
    // 当前组非空且加入后超出目标字数 → 收组；否则继续累加（允许小幅超出，避免切碎）
    if (current.length && currentChars + chChars > targetChars) flush()
    current.push(ch)
    currentChars += chChars
  }
  flush()
  return groups
}

/**
 * 段落识别：按空行分隔切块（兼容 CRLF），空块丢弃。
 * 诗词一首/笑话一则通常即一段，适合 paragraphs 模式按段落数归组
 */
export function detectParagraphs(rawText: string): string[] {
  return rawText
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t\u00A0\u3000]*\n+/)
    .map(p => p.trim())
    .filter(Boolean)
}

/**
 * 文档预切分结果：每份成为一个独立小说入库
 */
export interface PreSplitChunk {
  title: string
  content: string
  charCount: number
  paragraphCount: number
  /** chars 模式下记录章节数；paragraphs 模式为 undefined */
  chapterCount?: number
}

/**
 * 文档预切分：把大文档拆成多个子文档，每份成为独立小说入库。
 * 支持两种拆分模式：
 * - chars（按目标字数）：识别章节 + 贪心归组到目标字数，适合小说/长文
 * - paragraphs（按段落数）：按段落数均分，诗词一首/笑话一则即一段
 *
 * paragraphs 模式参数：
 * - paragraphsPerNovel 指定时按段落数均分
 * - targetNovels 指定时按段落数贪心均分到目标份数
 * 两个参数都未传时按 DEFAULT_PARAGRAPHS_PER_EPISODE 段切分
 */
export function preSplitNovel(
  rawText: string,
  opts: { paragraphsPerNovel?: number; targetNovels?: number; titlePrefix?: string; splitMode?: 'chars' | 'paragraphs'; targetChars?: number } = {},
): PreSplitChunk[] {
  const prefix = opts.titlePrefix || '片段'

  // chars 模式：章节识别 + 目标字数贪心归组，适合小说/长文
  if (opts.splitMode === 'chars') {
    const chapters = detectChapters(rawText)
    if (!chapters.length) {
      const text = rawText.trim()
      return text ? [{ title: `${prefix}-01`, content: text, charCount: countChars(text), paragraphCount: 0, chapterCount: 0 }] : []
    }
    const targetChars = opts.targetChars && opts.targetChars > 0 ? opts.targetChars : DEFAULT_TARGET_CHARS
    const groups = groupChapters(chapters, targetChars)
    return groups.map((g, i) => {
      const idx = String(i + 1).padStart(2, '0')
      return {
        title: `${prefix}-${idx}`,
        content: g.text,
        charCount: g.charCount,
        paragraphCount: detectParagraphs(g.text).length,
        chapterCount: g.chapters.length,
      }
    })
  }

  // paragraphs 模式：按段落数均分，适合诗词/笑话等短篇集
  const paragraphs = detectParagraphs(rawText)
  if (!paragraphs.length) {
    const text = rawText.trim()
    return text ? [{ title: `${prefix}-01`, content: text, charCount: countChars(text), paragraphCount: 0 }] : []
  }
  let perNovel: number
  if (opts.paragraphsPerNovel && opts.paragraphsPerNovel > 0) {
    perNovel = Math.round(opts.paragraphsPerNovel)
  } else if (opts.targetNovels && opts.targetNovels > 0) {
    perNovel = Math.max(1, Math.ceil(paragraphs.length / Math.round(opts.targetNovels)))
  } else {
    perNovel = DEFAULT_PARAGRAPHS_PER_EPISODE
  }
  const chunks: PreSplitChunk[] = []
  for (let i = 0; i < paragraphs.length; i += perNovel) {
    const slice = paragraphs.slice(i, i + perNovel)
    const text = slice.join('\n\n')
    const idx = String(chunks.length + 1).padStart(2, '0')
    chunks.push({
      title: `${prefix}-${idx}`,
      content: text,
      charCount: countChars(text),
      paragraphCount: slice.length,
    })
  }
  return chunks
}

/**
 * 按段落数归组：每 paragraphsPerEpisode 段一集（尾段不足独立成集）。
 * 每段包装为无标题 Chapter 复用 EpisodeGroup 结构，标题/概要由 titler Agent 生成；
 * 无任何段落时整篇视为 1 集，保证拆分不产出空结果。
 */
export function groupParagraphs(rawText: string, paragraphsPerEpisode: number = DEFAULT_PARAGRAPHS_PER_EPISODE): EpisodeGroup[] {
  const paragraphs = detectParagraphs(rawText)
  const perEpisode = Math.max(1, Math.round(paragraphsPerEpisode))
  if (!paragraphs.length) {
    const text = rawText.trim()
    return text ? [{ chapters: [{ title: '', content: text }], text, charCount: countChars(text) }] : []
  }
  const groups: EpisodeGroup[] = []
  for (let i = 0; i < paragraphs.length; i += perEpisode) {
    const slice = paragraphs.slice(i, i + perEpisode)
    const chapters: Chapter[] = slice.map(p => ({ title: '', content: p }))
    const text = slice.join('\n\n')
    groups.push({ chapters, text, charCount: countChars(text) })
  }
  return groups
}
