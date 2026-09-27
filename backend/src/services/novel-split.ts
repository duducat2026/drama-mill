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
 * 小说自动分集 — 章节识别 + 目标字数贪心归组（或段落数归组）+ novel_splitter Agent 生成每集标题/概要 + 批量建集
 * 归组为纯函数（detectChapters / groupChapters / groupParagraphs）可单测；拆分任务为进程内存态 + novels 表落盘状态
 */
import { Agent } from '@mastra/core/agent'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { getModel, buildAgentInstructions } from '../agents/index.js'
import { createEpisode } from './episode-create.js'
import { resolveTextConfigMeta } from './ai.js'
import { withTextSlot } from '../utils/rate-config.js'
import { recordTextUsageFromResult } from './cost.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

// 纯函数抽在 novel-text.ts（无依赖可独立单测），这里转出保持对外接口不变
export { DEFAULT_TARGET_CHARS, DEFAULT_PARAGRAPHS_PER_EPISODE, countChars, detectChapters, groupChapters, detectParagraphs, groupParagraphs, preSplitNovel } from './novel-text.js'
export type { Chapter, EpisodeGroup, PreSplitChunk } from './novel-text.js'
import { DEFAULT_TARGET_CHARS, DEFAULT_PARAGRAPHS_PER_EPISODE, countChars, detectChapters, groupChapters, detectParagraphs, groupParagraphs, type Chapter, type EpisodeGroup } from './novel-text.js'

// ─── 拆分任务（内存态 + novels.split_status 落库） ───

export interface SplitTask {
  status: 'splitting' | 'split' | 'failed'
  started_at: string
  finished_at?: string
  progress?: string
  error?: string
  created_episodes: { episode_number: number; title: string; char_count: number }[]
}

const splitTasks = new Map<number, SplitTask>()

export interface SplitOpts {
  targetChars?: number
  model?: string
  configId?: number
  /** 发起用户（模型配置用户维度 + 建集归属 + 成本归属） */
  userId?: number
  /** 所属项目（内部传递，成本归属用） */
  dramaId?: number
  /** 拆分提示词（来自模版）：注入每集标题/概要生成，引导按模版风格拆分命名 */
  splitPrompt?: string
  /** 拆分模版 id（快照记录到 split_info / novels.split_template_id） */
  splitTemplateId?: number
  /** 拆分方式：chars 按目标字数归组（默认）；paragraphs 按段落数归组（诗词/笑话推荐） */
  splitMode?: 'chars' | 'paragraphs'
  /** paragraphs 模式下每集段落数（未传用兜底值） */
  paragraphsPerEpisode?: number
}

/** 为一组章节生成「标题 + 一句话概要」；失败时兜底用首个章节标题，不中断整体拆分 */
async function generateEpisodeTitleSummary(
  group: EpisodeGroup,
  opts: SplitOpts,
): Promise<{ title: string; summary: string }> {
  const fallback = { title: group.chapters[0]?.title?.replace(/（\d+）$/, '') || '未命名', summary: '' }
  try {
    const model = await getModel(undefined, opts.model, opts.configId, opts.userId)
    const templateHint = opts.splitPrompt?.trim()
    const agent = new Agent({
      id: 'novel_splitter',
      name: 'novel_splitter',
      // 正式 Agent 类型：instructions 由 workspace/prompts/novel_splitter.md（缺失回退代码默认）
      // + skills/novel-splitter 技能全文组装，设置页可编辑；不挂 workspace，保持单步无工具输出 JSON
      instructions: await buildAgentInstructions('novel_splitter'),
      model,
    })
    const chapterTitles = group.chapters.map(ch => ch.title).filter(Boolean).join('、') || '（无章节标题）'
    const snippet = group.text.slice(0, 2500)
    const templateSection = templateHint
      ? `\n\n拆分模版要求（必须遵守）：\n${templateHint}`
      : ''
    const result = await withTextSlot(() => agent.generate(
      [{
        role: 'user',
        content: `请为短剧的一集生成标题和一句话概要。\n该集包含章节：${chapterTitles}\n内容开头节选：\n${snippet}${templateSection}\n\n只输出一个 JSON 对象，不要任何其它文字：{"title":"12字以内的吸睛标题","summary":"50字以内的一句话概要"}`,
      }],
      { maxSteps: 1 },
    ))
    // 标题/概要生成也计入成本（失败不影响拆分）
    const meta = await resolveTextConfigMeta(opts.userId, opts.configId)
    await recordTextUsageFromResult(result, meta, { userId: opts.userId, dramaId: opts.dramaId, detail: 'novel_split_titler' })
    const raw = (result.text || '').trim()
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    const start = jsonText.indexOf('{')
    const end = jsonText.lastIndexOf('}')
    if (start < 0 || end <= start) return fallback
    const parsed = JSON.parse(jsonText.slice(start, end + 1))
    return {
      title: String(parsed.title || '').trim() || fallback.title,
      summary: String(parsed.summary || '').trim(),
    }
  } catch {
    return fallback
  }
}

async function updateNovelSplit(novelId: number, fields: {
  splitStatus: string
  splitError?: string | null
  splitInfo?: string
  chapterCount?: number
  splitTemplateId?: number
}) {
  await db.update(schema.novels).set({ ...fields, updatedAt: now() }).where(eq(schema.novels.id, novelId))
}

/** 是否存在进程内运行中的拆分任务（区分于重启后残留的 DB splitting 状态） */
export function hasActiveSplitTask(novelId: number): boolean {
  return splitTasks.get(novelId)?.status === 'splitting'
}

/** 启动异步拆分任务（立即返回）；已在运行时返回 false */
export function startNovelSplit(novelId: number, opts: SplitOpts = {}): Promise<boolean> {
  return (async () => {
    const [novel] = await db.select().from(schema.novels).where(eq(schema.novels.id, novelId))
    if (!novel) return false
    const running = splitTasks.get(novelId)
    if (running?.status === 'splitting') return false

    // 小说库模式下未建项目的小说无法拆分（分集产物必须归属项目），先建项目再拆
    const dramaId = novel.dramaId
    if (!dramaId) {
      await updateNovelSplit(novelId, { splitStatus: 'failed', splitError: '小说尚未创建项目，请先创建项目后再拆分' })
      return false
    }

    const targetChars = opts.targetChars && opts.targetChars > 0 ? opts.targetChars : DEFAULT_TARGET_CHARS
    const splitMode = opts.splitMode === 'paragraphs' ? 'paragraphs' : 'chars'
    const paragraphsPerEpisode = opts.paragraphsPerEpisode && opts.paragraphsPerEpisode > 0
      ? Math.round(opts.paragraphsPerEpisode)
      : DEFAULT_PARAGRAPHS_PER_EPISODE
    const task: SplitTask = { status: 'splitting', started_at: now(), created_episodes: [] }
    splitTasks.set(novelId, task)
    logTaskStart('NovelSplit', 'split', { novelId, dramaId, targetChars, splitMode, paragraphsPerEpisode })

    void (async () => {
      await updateNovelSplit(novelId, { splitStatus: 'splitting', splitError: null, splitTemplateId: opts.splitTemplateId ?? undefined })
      try {
        // 归组：paragraphs 模式按空行段落数切集（诗词一首/笑话一则即一段）；
        // chars 模式走章节识别 + 目标字数贪心归组。两路均产出 EpisodeGroup 后共用后续建集流程
        let groups: EpisodeGroup[]
        let chapterCount: number
        if (splitMode === 'paragraphs') {
          task.progress = '识别段落中'
          const paragraphs = detectParagraphs(novel.content)
          chapterCount = paragraphs.length
          await updateNovelSplit(novelId, { splitStatus: 'splitting', chapterCount })
          logTaskProgress('NovelSplit', 'paragraphs-detected', { novelId, paragraphCount: paragraphs.length })
          groups = groupParagraphs(novel.content, paragraphsPerEpisode)
        } else {
          task.progress = '识别章节中'
          const chapters = detectChapters(novel.content)
          chapterCount = chapters.length
          await updateNovelSplit(novelId, { splitStatus: 'splitting', chapterCount })
          logTaskProgress('NovelSplit', 'chapters-detected', { novelId, chapterCount: chapters.length })
          groups = groupChapters(chapters, targetChars)
        }
        task.progress = `归组完成：${groups.length} 集，开始生成标题/概要`

        const episodeSummaries: { episode_number: number; title: string; char_count: number; chapter_range: string }[] = []
        let paragraphCursor = 0
        for (let i = 0; i < groups.length; i++) {
          task.progress = `第 ${i + 1}/${groups.length} 集标题/概要生成中`
          const { title: aiTitle, summary } = await generateEpisodeTitleSummary(groups[i], { ...opts, dramaId })
          const created = await createEpisode(dramaId, {
            title: `第__NUM__集 ${aiTitle}`,
            content: groups[i].text,
            description: summary || undefined,
          }, opts.userId)
          // 集号由 createEpisode 递增分配，标题中的占位符替换为实际集号
          const finalTitle = `第${created.episode_number}集 ${aiTitle}`
          await db.update(schema.episodes).set({ title: finalTitle, updatedAt: now() })
            .where(eq(schema.episodes.id, created.id))
          // 归组来源记录：字数模式取章节标题串；段落模式取段落序号区间
          let range: string
          if (splitMode === 'paragraphs') {
            const from = paragraphCursor + 1
            paragraphCursor += groups[i].chapters.length
            range = `第 ${from}–${paragraphCursor} 段`
          } else {
            range = groups[i].chapters.map(ch => ch.title).filter(Boolean).join('、')
          }
          task.created_episodes.push({ episode_number: created.episode_number, title: finalTitle, char_count: groups[i].charCount })
          episodeSummaries.push({ episode_number: created.episode_number, title: finalTitle, char_count: groups[i].charCount, chapter_range: range })
          logTaskProgress('NovelSplit', 'episode-created', { novelId, episodeNumber: created.episode_number, charCount: groups[i].charCount })
        }

        const splitInfo = JSON.stringify({
          split_mode: splitMode,
          target_chars: splitMode === 'chars' ? targetChars : null,
          paragraphs_per_episode: splitMode === 'paragraphs' ? paragraphsPerEpisode : null,
          chapter_count: chapterCount,
          episode_count: groups.length,
          episodes: episodeSummaries,
          split_template_id: opts.splitTemplateId ?? null,
          split_at: now(),
        })
        await updateNovelSplit(novelId, { splitStatus: 'split', splitInfo })
        task.status = 'split'
        task.finished_at = now()
        task.progress = undefined
        logTaskSuccess('NovelSplit', 'split', { novelId, episodeCount: groups.length, chapterCount, splitMode })
      } catch (err: any) {
        task.status = 'failed'
        task.finished_at = now()
        task.error = err?.message || '拆分失败'
        await updateNovelSplit(novelId, { splitStatus: 'failed', splitError: task.error }).catch(() => {})
        logTaskError('NovelSplit', 'split', { novelId, error: err?.message })
      }
    })()
    return true
  })()
}

/** 查询拆分任务状态（内存进度 + DB 落盘状态合并） */
export async function getNovelSplitStatus(novelId: number) {
  const [novel] = await db.select().from(schema.novels).where(eq(schema.novels.id, novelId))
  if (!novel) return null
  const task = splitTasks.get(novelId)
  const splitInfo = novel.splitInfo ? JSON.parse(novel.splitInfo) : null
  return {
    status: task?.status || novel.splitStatus,
    progress: task?.status === 'splitting' ? task.progress : undefined,
    error: task?.error || novel.splitError,
    created_episodes: task?.created_episodes?.length ? task.created_episodes : (splitInfo?.episodes || []).map((e: any) => ({
      episode_number: e.episode_number,
      title: e.title,
      char_count: e.char_count,
    })),
    split_info: splitInfo,
  }
}
