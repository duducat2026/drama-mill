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
 * 单集流水线步骤进度计算 — GET /episodes/:id/pipeline-status 与生产编排器共用
 */
import { eq, inArray, and, isNull, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

/** 步骤推导只关心"是否非空"，用 SQL 布尔替代拉取剧本全文 */
const EP_STEP_FIELDS = {
  id: schema.episodes.id,
  dramaId: schema.episodes.dramaId,
  content: sql<string | null>`CASE WHEN content IS NOT NULL AND content <> '' THEN '1' ELSE NULL END`,
  scriptContent: sql<string | null>`CASE WHEN script_content IS NOT NULL AND script_content <> '' THEN '1' ELSE NULL END`,
} as const

/** 步骤推导只需资产的存在性字段（id/图片/软删标记） */
const ASSET_STEP_FIELDS = (t: any) => ({ id: t.id, imageUrl: t.imageUrl, deletedAt: t.deletedAt })

export interface PipelineStep {
  status: string
  count?: number
  completed?: number
  total?: number
  merged_url?: string | null
}

export interface PipelineSteps {
  script_rewrite: PipelineStep
  extract_characters: PipelineStep
  extract_scenes: PipelineStep
  extract_storyboards: PipelineStep
  generate_images: PipelineStep
  generate_videos: PipelineStep
  merge_episode: PipelineStep
}

function stepStatus(done: boolean, partial?: boolean) {
  if (done) return 'done'
  if (partial) return 'partial'
  return 'pending'
}

/** 纯函数：根据已拉取的数据计算单集 7 步流水线进度 */
export function computePipelineSteps(ep: {
  id: number; dramaId: number; content: string | null; scriptContent: string | null;
}, chars: Array<{ id: number; imageUrl: string | null; deletedAt: string | null }>,
  scenes: Array<{ id: number; imageUrl: string | null; deletedAt: string | null }>,
  props: Array<{ id: number; imageUrl: string | null; deletedAt: string | null }>,
  sbs: Array<{ videoUrl: string | null }>,
  merges: Array<{ status: string | null; mergedUrl: string | null }>,
  charLinkIds: Set<number>, sceneLinkIds: Set<number>, propLinkIds: Set<number>,
): PipelineSteps {
  const linkedChars = chars.filter(ch => charLinkIds.has(ch.id) && !ch.deletedAt)
  const linkedScenes = scenes.filter(s => sceneLinkIds.has(s.id) && !s.deletedAt)
  const linkedProps = props.filter(p => propLinkIds.has(p.id) && !p.deletedAt)
  const assetRows = [...linkedChars, ...linkedScenes, ...linkedProps]
  const assetsWithImage = assetRows.filter(a => a.imageUrl)
  const sbsWithVideo = sbs.filter(s => s.videoUrl)
  const latestMerge = merges[merges.length - 1]

  return {
    script_rewrite: { status: ep.scriptContent ? 'done' : (ep.content ? 'ready' : 'pending') },
    extract_characters: { status: stepStatus(chars.length > 0), count: chars.length },
    extract_scenes: { status: stepStatus(scenes.length > 0), count: scenes.length },
    extract_storyboards: { status: stepStatus(sbs.length > 0), count: sbs.length },
    generate_images: { status: stepStatus(assetsWithImage.length === assetRows.length && assetRows.length > 0, assetsWithImage.length > 0), completed: assetsWithImage.length, total: assetRows.length },
    generate_videos: { status: stepStatus(sbsWithVideo.length === sbs.length && sbs.length > 0, sbsWithVideo.length > 0), completed: sbsWithVideo.length, total: sbs.length },
    merge_episode: { status: latestMerge?.status === 'completed' ? 'done' : (latestMerge ? (latestMerge.status || 'pending') : 'pending'), merged_url: latestMerge?.mergedUrl },
  }
}

/** 计算某集 7 个流水线步骤的进度；集不存在时返回 null（全部查询仅取推导所需列） */
export async function getEpisodePipelineSteps(episodeId: number): Promise<PipelineSteps | null> {
  const [ep] = await db.select(EP_STEP_FIELDS).from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) return null

  const [chars, scenes, sbs, merges, epCharLinks, epSceneLinks, epPropLinks, props] = await Promise.all([
    db.select(ASSET_STEP_FIELDS(schema.characters)).from(schema.characters).where(eq(schema.characters.dramaId, ep.dramaId)),
    db.select(ASSET_STEP_FIELDS(schema.scenes)).from(schema.scenes).where(eq(schema.scenes.dramaId, ep.dramaId)),
    db.select({ videoUrl: schema.storyboards.videoUrl }).from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId)),
    db.select({ status: schema.videoMerges.status, mergedUrl: schema.videoMerges.mergedUrl }).from(schema.videoMerges).where(eq(schema.videoMerges.episodeId, episodeId)),
    db.select({ characterId: schema.episodeCharacters.characterId }).from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, episodeId)),
    db.select({ sceneId: schema.episodeScenes.sceneId }).from(schema.episodeScenes).where(eq(schema.episodeScenes.episodeId, episodeId)),
    db.select({ propId: schema.episodeProps.propId }).from(schema.episodeProps).where(eq(schema.episodeProps.episodeId, episodeId)),
    db.select(ASSET_STEP_FIELDS(schema.props)).from(schema.props).where(eq(schema.props.dramaId, ep.dramaId)),
  ])

  return computePipelineSteps(
    ep as any, chars, scenes, props, sbs, merges,
    new Set(epCharLinks.map(l => l.characterId)),
    new Set(epSceneLinks.map(l => l.sceneId)),
    new Set(epPropLinks.map(l => l.propId)),
  )
}

/** 批量计算多集流水线进度（供生产编排器 getProductionStatus 使用，避免逐集 N+1） */
export async function getDramaPipelineSteps(
  dramaId: number,
  episodes: Array<{ id: number; dramaId: number; content: string | null; scriptContent: string | null }>,
): Promise<Map<number, PipelineSteps>> {
  if (!episodes.length) return new Map()

  const episodeIds = episodes.map(e => e.id)

  // 批量查询所有数据（8 次 DB 往返覆盖全部集，而非每集 10 次；仅取推导所需列，不拉剧本/提示词等大字段）
  const [
    chars, scenes, props,
    allSbs, allMerges,
    allCharLinks, allSceneLinks, allPropLinks,
  ] = await Promise.all([
    db.select(ASSET_STEP_FIELDS(schema.characters)).from(schema.characters).where(eq(schema.characters.dramaId, dramaId)),
    db.select(ASSET_STEP_FIELDS(schema.scenes)).from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId)),
    db.select(ASSET_STEP_FIELDS(schema.props)).from(schema.props).where(eq(schema.props.dramaId, dramaId)),
    db.select({ episodeId: schema.storyboards.episodeId, videoUrl: schema.storyboards.videoUrl })
      .from(schema.storyboards).where(inArray(schema.storyboards.episodeId, episodeIds)),
    db.select({ episodeId: schema.videoMerges.episodeId, status: schema.videoMerges.status, mergedUrl: schema.videoMerges.mergedUrl })
      .from(schema.videoMerges).where(and(
      inArray(schema.videoMerges.episodeId, episodeIds),
      isNull(schema.videoMerges.deletedAt),
    )),
    db.select({ episodeId: schema.episodeCharacters.episodeId, characterId: schema.episodeCharacters.characterId }).from(schema.episodeCharacters).where(inArray(schema.episodeCharacters.episodeId, episodeIds)),
    db.select({ episodeId: schema.episodeScenes.episodeId, sceneId: schema.episodeScenes.sceneId }).from(schema.episodeScenes).where(inArray(schema.episodeScenes.episodeId, episodeIds)),
    db.select({ episodeId: schema.episodeProps.episodeId, propId: schema.episodeProps.propId }).from(schema.episodeProps).where(inArray(schema.episodeProps.episodeId, episodeIds)),
  ])

  // 按 episodeId 分组
  const sbsByEp = new Map<number, typeof allSbs>()
  const mergesByEp = new Map<number, typeof allMerges>()
  const charLinksByEp = new Map<number, Set<number>>()
  const sceneLinksByEp = new Map<number, Set<number>>()
  const propLinksByEp = new Map<number, Set<number>>()

  for (const sb of allSbs) {
    const arr = sbsByEp.get(sb.episodeId) || []
    arr.push(sb)
    sbsByEp.set(sb.episodeId, arr)
  }
  for (const m of allMerges) {
    const eid = m.episodeId
    if (eid == null) continue
    const arr = mergesByEp.get(eid) || []
    arr.push(m)
    mergesByEp.set(eid, arr)
  }
  for (const cl of allCharLinks) {
    const s = charLinksByEp.get(cl.episodeId) || new Set()
    s.add(cl.characterId)
    charLinksByEp.set(cl.episodeId, s)
  }
  for (const sl of allSceneLinks) {
    const s = sceneLinksByEp.get(sl.episodeId) || new Set()
    s.add(sl.sceneId)
    sceneLinksByEp.set(sl.episodeId, s)
  }
  for (const pl of allPropLinks) {
    const s = propLinksByEp.get(pl.episodeId) || new Set()
    s.add(pl.propId)
    propLinksByEp.set(pl.episodeId, s)
  }

  const result = new Map<number, PipelineSteps>()
  for (const ep of episodes) {
    result.set(ep.id, computePipelineSteps(
      ep, chars, scenes, props,
      sbsByEp.get(ep.id) || [],
      mergesByEp.get(ep.id) || [],
      charLinksByEp.get(ep.id) || new Set(),
      sceneLinksByEp.get(ep.id) || new Set(),
      propLinksByEp.get(ep.id) || new Set(),
    ))
  }
  return result
}
