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
 * 多租户归属校验 — 资源按 drama.user_id 归属；
 * episodes/storyboards/characters/scenes/props 均经 drama 间接归属
 */
import { eq, getTableColumns } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import type { AuthUser } from './auth.js'

export class OwnershipError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** 查项目（不存在或未归属均按 404 处理，避免泄露他人资源存在性） */
export async function getDramaOwned(dramaId: number, user: AuthUser) {
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama || drama.userId !== user.id) throw new OwnershipError(404, '项目不存在')
  return drama
}

/**
 * 剧集归属校验（轻投影）：排除 content/script_content 两列 MEDIUMTEXT——
 * 状态/进度类端点高频轮询都会走这里，全列拉取会把数万汉字正文带入每次校验；
 * 需要正文的单集详情请用 getEpisodeFullOwned
 */
export async function getEpisodeOwned(episodeId: number, user: AuthUser) {
  const [ep] = await db.select(episodeLightCols).from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) throw new OwnershipError(404, '剧集不存在')
  return { ep, drama: await getDramaOwned(ep.dramaId, user) }
}

const { content: _c, scriptContent: _s, ...episodeLightCols } = getTableColumns(schema.episodes)

/** 全列版本：仅供需要正文（content/script_content）的单集详情使用 */
export async function getEpisodeFullOwned(episodeId: number, user: AuthUser) {
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) throw new OwnershipError(404, '剧集不存在')
  return { ep, drama: await getDramaOwned(ep.dramaId, user) }
}

export async function getStoryboardOwned(storyboardId: number, user: AuthUser) {
  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
  if (!sb) throw new OwnershipError(404, '分镜不存在')
  // 只取归属链路的 drama_id，不拉剧集正文列
  const [ep] = await db.select({ dramaId: schema.episodes.dramaId }).from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))
  if (!ep) throw new OwnershipError(404, '分镜不存在')
  await getDramaOwned(ep.dramaId, user)
  return sb
}

export async function getCharacterOwned(characterId: number, user: AuthUser) {
  const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, characterId))
  if (!row) throw new OwnershipError(404, '角色不存在')
  await getDramaOwned(row.dramaId, user)
  return row
}

export async function getSceneOwned(sceneId: number, user: AuthUser) {
  const [row] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId))
  if (!row) throw new OwnershipError(404, '场景不存在')
  await getDramaOwned(row.dramaId, user)
  return row
}

export async function getPropOwned(propId: number, user: AuthUser) {
  const [row] = await db.select().from(schema.props).where(eq(schema.props.id, propId))
  if (!row) throw new OwnershipError(404, '道具不存在')
  await getDramaOwned(row.dramaId, user)
  return row
}

/** 小说归属：优先按 novels.user_id（多租户回填后均有）；早期无 user_id 的行回退按所属项目归属 */
export async function getNovelOwned(novelId: number, user: AuthUser) {
  const [row] = await db.select().from(schema.novels).where(eq(schema.novels.id, novelId))
  if (!row || row.deletedAt) throw new OwnershipError(404, '小说不存在')
  if (row.userId != null) {
    if (row.userId !== user.id) throw new OwnershipError(404, '小说不存在')
    return row
  }
  if (row.dramaId) await getDramaOwned(row.dramaId, user)
  return row
}

/** 当前用户拥有的项目 id 集合（供列表过滤） */
export async function ownedDramaIds(user: AuthUser): Promise<Set<number>> {
  const rows = await db.select({ id: schema.dramas.id }).from(schema.dramas)
    .where(eq(schema.dramas.userId, user.id))
  return new Set(rows.map(r => r.id))
}
