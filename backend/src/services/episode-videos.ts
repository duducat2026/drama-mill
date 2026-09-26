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
 * 整集视频任务组装 — 移植前端 episode.vue 的参考图收集与 @引用替换逻辑，供生产编排器使用
 * 参考图顺序：场景 → 角色 → 道具（去重、≤9 张）；提示词中 @名字 → @图片N名字
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { generateVideo } from './generation.js'
import { logTaskProgress } from '../utils/task-logger.js'

interface RefAsset {
  name: string
  imageUrl: string | null
}

/** 收集分镜参考图（场景图在前、角色图居中、道具图在后，去重 ≤9）— 移植自前端 getShotReferenceImages */
export function getShotReferenceImages(
  scene: RefAsset | null,
  characters: RefAsset[],
  props: RefAsset[],
): string[] {
  const refs: string[] = []
  const pushRef = (value?: string | null) => {
    if (!value || refs.includes(value) || refs.length >= 9) return
    refs.push(value)
  }
  pushRef(scene?.imageUrl)
  for (const ch of characters) pushRef(ch.imageUrl)
  for (const p of props) pushRef(p.imageUrl)
  return refs
}

/** 按参考图顺序为 @名字 建立索引映射（序号从 1 起）— 移植自前端 getShotReferenceIndexMap */
export function getShotReferenceIndexMap(
  scene: RefAsset | null,
  characters: RefAsset[],
  props: RefAsset[],
): Record<string, number> {
  const ordered: { name: string; imageUrl: string }[] = []
  const seen = new Set<string>()
  const push = (name: string, url?: string | null) => {
    if (!url || seen.has(url) || ordered.length >= 9) return
    seen.add(url)
    ordered.push({ name, imageUrl: url })
  }
  push(scene?.name || '', scene?.imageUrl)
  for (const ch of characters) push(ch.name || '', ch.imageUrl)
  for (const p of props) push(p.name || '', p.imageUrl)
  const nameToIndex: Record<string, number> = {}
  ordered.forEach((a, i) => { if (a.name && !(a.name in nameToIndex)) nameToIndex[a.name] = i + 1 })
  return nameToIndex
}

/** 将视频提示词中的 @名字 替换为 @图片N名字（N 为参考图序号）— 移植自前端 resolveVideoPromptRefs */
export function resolveVideoPromptRefs(prompt: string, nameToIndex: Record<string, number>): string {
  const names = Object.keys(nameToIndex).sort((a, b) => b.length - a.length)
  if (!names.length || !prompt) return prompt
  return prompt.replace(/@([^\s@]+)/g, (m, raw) => {
    for (const name of names) {
      if (raw.startsWith(name)) {
        return `@图片${nameToIndex[name]}${name}${raw.slice(name.length)}`
      }
    }
    return m
  })
}

export interface ShotVideoSubmission {
  storyboard_id: number
  storyboard_number: number
  task_id: number
}

/**
 * 为本集缺少视频的分镜组装并提交视频任务：
 * 集锁定配置/分辨率、剧画幅、分镜时长；提交进入 generation 队列（并发/限流由其内部控制）
 * 返回提交清单；无视频提示词的分镜抛错（应先由视频提示词步骤补齐）
 */
export async function submitEpisodeVideoBatch(episodeId: number, dramaId: number): Promise<{
  submitted: ShotVideoSubmission[]
  skipped: number
}> {
  const [episode] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!episode) throw new Error('剧集不存在')
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  const aspectRatio = drama?.aspectRatio || '16:9'

  const sbs = (await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId)))
    .filter(sb => !sb.deletedAt)
    .sort((a, b) => a.storyboardNumber - b.storyboardNumber)
  const pending = sbs.filter(sb => !sb.videoUrl)
  if (!pending.length) return { submitted: [], skipped: sbs.length }

  // 分镜绑定资产：场景取自 sb.scene_id，角色/道具取自关联表；按本集分镜 id 用 inArray 定点查，不全表加载
  const pendingIds = pending.map(sb => sb.id)
  const [charLinks, propLinks] = await Promise.all([
    db.select().from(schema.storyboardCharacters).where(inArray(schema.storyboardCharacters.storyboardId, pendingIds)),
    db.select().from(schema.storyboardProps).where(inArray(schema.storyboardProps.storyboardId, pendingIds)),
  ])
  const charIds = [...new Set(charLinks.map(l => l.characterId))]
  const propIds = [...new Set(propLinks.map(l => l.propId))]
  const sceneIds = [...new Set(pending.map(sb => sb.sceneId).filter((v): v is number => !!v))]
  const [charRows, sceneRows, propRows] = await Promise.all([
    charIds.length
      ? db.select().from(schema.characters).where(and(inArray(schema.characters.id, charIds), isNull(schema.characters.deletedAt)))
      : Promise.resolve([] as (typeof schema.characters.$inferSelect)[]),
    sceneIds.length
      ? db.select().from(schema.scenes).where(and(inArray(schema.scenes.id, sceneIds), isNull(schema.scenes.deletedAt)))
      : Promise.resolve([] as (typeof schema.scenes.$inferSelect)[]),
    propIds.length
      ? db.select().from(schema.props).where(and(inArray(schema.props.id, propIds), isNull(schema.props.deletedAt)))
      : Promise.resolve([] as (typeof schema.props.$inferSelect)[]),
  ])
  const charsById = new Map(charRows.map(ch => [ch.id, ch]))
  const scenesById = new Map(sceneRows.map(s => [s.id, s]))
  const propsById = new Map(propRows.map(p => [p.id, p]))

  const submitted: ShotVideoSubmission[] = []
  let skipped = sbs.length - pending.length
  for (const sb of pending) {
    const basePrompt = sb.videoPrompt || sb.description || ''
    if (!basePrompt.trim()) throw new Error(`分镜 ${sb.storyboardNumber} 缺少视频提示词，无法生成视频`)

    const scene = sb.sceneId ? (scenesById.get(sb.sceneId) || null) : null
    const characters = charLinks
      .filter(l => l.storyboardId === sb.id)
      .map(l => charsById.get(l.characterId))
      .filter((ch): ch is NonNullable<typeof ch> => !!ch)
    const props = propLinks
      .filter(l => l.storyboardId === sb.id)
      .map(l => propsById.get(l.propId))
      .filter((p): p is NonNullable<typeof p> => !!p)

    const sceneRef: RefAsset | null = scene ? { name: scene.location, imageUrl: scene.imageUrl } : null
    const charRefs: RefAsset[] = characters.map(ch => ({ name: ch.name, imageUrl: ch.imageUrl }))
    const propRefs: RefAsset[] = props.map(p => ({ name: p.name, imageUrl: p.imageUrl }))

    const referenceImageUrls = getShotReferenceImages(sceneRef, charRefs, propRefs)
    const prompt = resolveVideoPromptRefs(basePrompt, getShotReferenceIndexMap(sceneRef, charRefs, propRefs))

    const taskId = await generateVideo({
      storyboardId: sb.id,
      dramaId,
      prompt,
      referenceMode: 'reference',
      referenceImageUrls,
      generateAudio: true,
      duration: sb.duration || 10,
      aspectRatio,
      resolution: episode.resolution || '720p',
      configId: episode.videoConfigId ?? undefined,
      // 编排/批量入口无请求态用户：按剧集 owner 落库（租户目录与配额归属依赖）
      userId: drama?.userId ?? undefined,
    })
    submitted.push({ storyboard_id: sb.id, storyboard_number: sb.storyboardNumber, task_id: taskId })
    logTaskProgress('EpisodeVideos', 'submitted', { episodeId, storyboardId: sb.id, taskId, refImages: referenceImageUrls.length })
  }
  return { submitted, skipped }
}

/** 本集视频生成进度：已有视频/总数（编排器轮询判定终态用） */
export async function getEpisodeVideoProgress(episodeId: number) {
  const sbs = (await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId)))
    .filter(sb => !sb.deletedAt)
  return {
    total: sbs.length,
    completed: sbs.filter(sb => !!sb.videoUrl).length,
    missing: sbs.filter(sb => !sb.videoUrl).map(sb => sb.storyboardNumber),
  }
}
