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
 * 素材重生脚本：云端素材库已清空，为投产相关剧集（producing/failed/completed）
 * 引用的缺图资产批量重新生成图片。
 * 用法：cd backend && npx tsx scripts/regen-missing-assets.ts
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { db, schema } from '../src/db/index.js'
import { eq, inArray } from 'drizzle-orm'
import { signToken } from '../src/services/auth.js'

const BASE = `http://127.0.0.1:${process.env.PORT || 5679}/api/v1`
const STATIC_ROOT = path.resolve(process.cwd(), '..', 'data', 'static')

// image_url 形如 static/images/xxx.png（相对项目根）或完整 URL（视为缺失需重绘）
function localExists(imageUrl: string | null): boolean {
  if (!imageUrl) return false
  if (imageUrl.startsWith('http')) return false
  const rel = imageUrl.replace(/^\/?(data\/)?static\//, '')
  return fs.existsSync(path.join(STATIC_ROOT, rel))
}

async function main() {
  const eps = await db.select().from(schema.episodes).where(inArray(schema.episodes.status, ['producing', 'failed', 'completed']))
  console.log(`目标剧集数: ${eps.length}`)
  if (!eps.length) return

  // 权限：getDramaOwned 校验 drama.userId === user.id（admin 不豁免），必须用项目属主身份签 token
  const dramaIds = [...new Set(eps.map(e => e.dramaId))]
  const dramas = await db.select().from(schema.dramas).where(inArray(schema.dramas.id, dramaIds))
  const ownerByDrama = new Map(dramas.map(d => [d.id, d.userId as number]))
  const epById = new Map(eps.map(e => [e.id, e]))
  const allUsers = await db.select().from(schema.users)
  const tokenByUser = new Map(allUsers.map(u => [u.id, signToken({ id: u.id, username: u.username!, role: u.role as 'user' | 'admin', nickname: u.nickname ?? null })]))
  const headersFor = (episodeId: number) => {
    const ep = epById.get(episodeId)
    const ownerId = ep ? ownerByDrama.get(ep.dramaId) : undefined
    const token = ownerId ? tokenByUser.get(ownerId) : undefined
    if (!token) throw new Error(`剧集#${episodeId} 找不到属主 token`)
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  }

  const epIds = eps.map(e => e.id)
  const [charLinks, sceneLinks, propLinks] = await Promise.all([
    db.select().from(schema.episodeCharacters).where(inArray(schema.episodeCharacters.episodeId, epIds)),
    db.select().from(schema.episodeScenes).where(inArray(schema.episodeScenes.episodeId, epIds)),
    db.select().from(schema.episodeProps).where(inArray(schema.episodeProps.episodeId, epIds)),
  ])

  const charIds = [...new Set(charLinks.map(l => l.characterId))]
  const sceneIds = [...new Set(sceneLinks.map(l => l.sceneId))]
  const propIds = [...new Set(propLinks.map(l => l.propId))]

  const [chars, scenes, props] = await Promise.all([
    charIds.length ? db.select().from(schema.characters).where(inArray(schema.characters.id, charIds)) : [],
    sceneIds.length ? db.select().from(schema.scenes).where(inArray(schema.scenes.id, sceneIds)) : [],
    propIds.length ? db.select().from(schema.props).where(inArray(schema.props.id, propIds)) : [],
  ])

  const missingChars = new Set(chars.filter(a => !localExists(a.imageUrl)).map(a => a.id))
  const missingScenes = new Set(scenes.filter(a => !localExists(a.imageUrl)).map(a => a.id))
  const missingProps = new Set(props.filter(a => !localExists(a.imageUrl)).map(a => a.id))
  console.log(`缺图资产: 角色 ${missingChars.size}/${chars.length} 场景 ${missingScenes.size}/${scenes.length} 道具 ${missingProps.size}/${props.length}`)

  // 逐资产调单个生成接口（批量接口同步耗时过长会 HTTP 超时）；同一资产取首个关联剧集，入口幂等守卫双保险
  const jobs: Array<{ url: string; episodeId: number }> = []
  const seenChar = new Set<number>(), seenScene = new Set<number>(), seenProp = new Set<number>()
  for (const l of charLinks) if (missingChars.has(l.characterId) && !seenChar.has(l.characterId)) {
    seenChar.add(l.characterId)
    jobs.push({ url: `/characters/${l.characterId}/generate-image`, episodeId: l.episodeId })
  }
  for (const l of sceneLinks) if (missingScenes.has(l.sceneId) && !seenScene.has(l.sceneId)) {
    seenScene.add(l.sceneId)
    jobs.push({ url: `/scenes/${l.sceneId}/generate-image`, episodeId: l.episodeId })
  }
  for (const l of propLinks) if (missingProps.has(l.propId) && !seenProp.has(l.propId)) {
    seenProp.add(l.propId)
    jobs.push({ url: `/props/${l.propId}/generate-image`, episodeId: l.episodeId })
  }
  console.log(`待提交: ${jobs.length} 个资产（逐个错峰提交）`)

  let total = 0, fail = 0
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]
    try {
      const res = await fetch(`${BASE}${job.url}`, {
        method: 'POST', headers: headersFor(job.episodeId), body: JSON.stringify({ episode_id: job.episodeId }),
        signal: AbortSignal.timeout(5 * 60_000),
      })
      const json = await res.json() as { code?: number; data?: { id?: number }; message?: string }
      if (res.ok && json.code === 0) {
        total++
        console.log(`✅ [${i + 1}/${jobs.length}] ${job.url} → 任务#${json.data?.id}`)
      } else {
        fail++
        console.error(`❌ [${i + 1}/${jobs.length}] ${job.url}: HTTP ${res.status} ${json.message || ''}`)
      }
    } catch (err) {
      fail++
      console.error(`❌ [${i + 1}/${jobs.length}] ${job.url}: ${(err as Error).message}`)
    }
    // 错峰提交，避免瞬时洪峰触发网关限流
    await new Promise(r => setTimeout(r, 500))
  }
  console.log(`🎉 完成：提交成功 ${total}（失败 ${fail}），任务异步生成中`)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
