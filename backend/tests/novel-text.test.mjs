// 小说分集纯函数单测：章节识别 + 贪心归组边界用例 + 段落模式（诗词/笑话）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countChars, detectChapters, groupChapters, DEFAULT_TARGET_CHARS, detectParagraphs, groupParagraphs, DEFAULT_PARAGRAPHS_PER_EPISODE } from '../src/services/novel-text.ts'

test('countChars 去除空白字符计数', () => {
  assert.equal(countChars('你好 世界'), 4)
  assert.equal(countChars('a\nb\tc'), 3)
  assert.equal(countChars(''), 0)
})

test('detectChapters 识别中文数字章节头', () => {
  const text = '第一章 开端\n内容甲。\n第二章 转折\n内容乙。\n第三章 终章\n内容丙。'
  const chapters = detectChapters(text)
  assert.equal(chapters.length, 3)
  assert.equal(chapters[0].title, '第一章 开端')
  assert.equal(chapters[0].content, '内容甲。')
  assert.equal(chapters[2].title, '第三章 终章')
})

test('detectChapters 识别阿拉伯数字章节头（含回/节）', () => {
  const text = '第1章 开始\n正文一。\n第2回 中段\n正文二。\n第3节 结尾\n正文三。'
  const chapters = detectChapters(text)
  assert.equal(chapters.length, 3)
  assert.equal(chapters[0].title, '第1章 开始')
  assert.equal(chapters[1].title, '第2回 中段')
  assert.equal(chapters[2].title, '第3节 结尾')
})

test('detectChapters 识别英文 Chapter 头', () => {
  const text = 'Chapter 1 Begin\nbody one.\nChapter 2 End\nbody two.'
  const chapters = detectChapters(text)
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0].title, 'Chapter 1 Begin')
  assert.equal(chapters[1].content, 'body two.')
})

test('detectChapters 无章节标记时整篇视为 1 章', () => {
  const text = '只是普通段落一。\n普通段落二。'
  const chapters = detectChapters(text)
  assert.equal(chapters.length, 1)
  assert.equal(chapters[0].title, '')
  assert.match(chapters[0].content, /普通段落一/)
})

test('detectChapters 首章前短引言被丢弃，长引言并入第 1 章', () => {
  const short = detectChapters('简短引言。\n第一章 起点\n正文。')
  assert.equal(short.length, 1)
  assert.doesNotMatch(short[0].content, /简短引言/)

  const longPreamble = '引言'.repeat(300) // 600 字 ≥ 500
  const long = detectChapters(`${longPreamble}\n第一章 起点\n正文。`)
  assert.equal(long.length, 1)
  assert.match(long[0].content, /引言/)
  assert.match(long[0].content, /正文。/)
})

test('detectChapters 章节头在正文中间出现时不误判（非行首）', () => {
  const text = '他说了一句话里包含第二章字样但不是章节头。\n第1章 真章节\n正文。'
  const chapters = detectChapters(text)
  assert.equal(chapters.length, 1)
  assert.equal(chapters[0].title, '第1章 真章节')
})

test('detectChapters 识别全角数字章节头（第１章）', () => {
  const text = '第１章 开端\n内容甲。\n第２章 转折\n内容乙。'
  const chapters = detectChapters(text)
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0].title, '第1章 开端')
  assert.equal(chapters[0].content, '内容甲。')
  assert.equal(chapters[1].title, '第2章 转折')
})

test('detectChapters 容忍全角空格/普通缩进与数字后空白', () => {
  const text = '\u3000\u3000第1章 缩进章\n正文一。\n   第 2 章 空格章\n正文二。'
  const chapters = detectChapters(text)
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0].title, '第1章 缩进章')
  assert.equal(chapters[0].content, '正文一。')
  assert.equal(chapters[1].title, '第 2 章 空格章')
  assert.equal(chapters[1].content, '正文二。')
})

test('groupChapters 贪心归组到目标字数', () => {
  const chapters = [
    { title: '第一章', content: '甲'.repeat(400) },
    { title: '第二章', content: '乙'.repeat(400) },
    { title: '第三章', content: '丙'.repeat(400) },
    { title: '第四章', content: '丁'.repeat(400) },
  ]
  const groups = groupChapters(chapters, 1000)
  // 400+400=800 ≤ 1000 可同组；再加第三章 1200>1000 收组 → 每组两章共 2 组
  assert.equal(groups.length, 2)
  assert.equal(groups[0].chapters.length, 2)
  assert.equal(groups[1].chapters.length, 2)
  assert.ok(groups[0].text.includes('第一章'))
  assert.ok(!groups[0].text.includes('第三章'))
})

test('groupChapters 单章允许小幅超出目标字数（不切碎）', () => {
  const chapters = [{ title: '第一章', content: '甲'.repeat(1100) }]
  const groups = groupChapters(chapters, 1000)
  assert.equal(groups.length, 1)
})

test('groupChapters 超长单章（>2 倍目标）按段落边界切分并加序号后缀', () => {
  // 3 段 × 1200 字 = 3600 字 > 2×1000，应被切分
  const paras = ['甲'.repeat(1200), '乙'.repeat(1200), '丙'.repeat(1200)]
  const chapters = [{ title: '第一章 超长', content: paras.join('\n\n') }]
  const groups = groupChapters(chapters, 1000)
  assert.ok(groups.length >= 2, `预期至少 2 组，实际 ${groups.length}`)
  const allTitles = groups.flatMap(g => g.chapters.map(c => c.title))
  assert.ok(allTitles.some(t => t.includes('（1）')), '切分后标题应带序号后缀')
  // 无内容丢失
  const total = groups.reduce((s, g) => s + g.charCount, 0)
  assert.ok(total >= 3600)
})

test('groupChapters 默认目标字数为 15000', () => {
  assert.equal(DEFAULT_TARGET_CHARS, 15000)
  const chapters = [
    { title: '第一章', content: '甲'.repeat(14000) },
    { title: '第二章', content: '乙'.repeat(14000) },
  ]
  const groups = groupChapters(chapters)
  // 第一章 14000 未超目标先入组；再加第二章 14000 → 28000>15000 收组 → 共 2 组（单章 14000 < 2×15000 不切段）
  assert.equal(groups.length, 2)
  assert.equal(groups[0].chapters.length, 1)
})

// ─── 段落模式（诗词/幽默笑话：空行分隔的一段即一首/一则）───────────────────

test('detectParagraphs 按空行切块，丢弃空块并兼容 CRLF/全角空格', () => {
  const text = '静夜思\n床前明月光。\n\n春晓\n春眠不觉晓。\r\n\u3000\n登鹳雀楼\n白日依山尽。'
  const paras = detectParagraphs(text)
  assert.equal(paras.length, 3)
  assert.equal(paras[0], '静夜思\n床前明月光。')
  assert.equal(paras[2], '登鹳雀楼\n白日依山尽。')
  // 连续多个空行不产生空块
  assert.deepEqual(detectParagraphs('甲\n\n\n\n乙'), ['甲', '乙'])
  assert.deepEqual(detectParagraphs(''), [])
})

test('groupParagraphs 每 N 段一集，尾段不足独立成集', () => {
  const text = Array.from({ length: 5 }, (_, i) => `第${i + 1}首\n正文。`).join('\n\n')
  const groups = groupParagraphs(text, 2)
  assert.equal(groups.length, 3)
  assert.equal(groups[0].chapters.length, 2)
  assert.equal(groups[2].chapters.length, 1)
  // 每段包装为无标题 Chapter（标题由 titler Agent 生成）
  assert.equal(groups[0].chapters[0].title, '')
  assert.match(groups[0].text, /第1首/)
  assert.ok(groups[0].charCount > 0)
})

test('groupParagraphs 默认每集 20 段，无段落时整篇兜底为 1 集', () => {
  assert.equal(DEFAULT_PARAGRAPHS_PER_EPISODE, 20)
  // 无空行的整篇文本兜底为 1 集，保证拆分不产出空结果
  const groups = groupParagraphs('没有空行的整篇文本。', 3)
  assert.equal(groups.length, 1)
  assert.match(groups[0].text, /没有空行的整篇文本/)
  assert.deepEqual(groupParagraphs('   \n  \n  ', 3), [])
})
