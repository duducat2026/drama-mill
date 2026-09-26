/*
 * Drama Mill — 存储布局迁移：共享状态 + 归属索引 + 路径映射
 */
import { gt } from 'drizzle-orm'
import { db, schema } from '../../src/db/index.js'
import { getStorageRoot } from '../../src/utils/storage.js'

export const DRY_RUN = process.argv.includes('--dry-run')
export const SKIP_ORPHANS = process.argv.includes('--skip-orphans')
export const PAGE = 2000
export const BATCH = 500
export const CATEGORIES = ['images', 'videos', 'merged', 'uploads'] as const

export type Owner = { userId: number | null; dramaId: number | null }

// ─── 归属索引 ──────────────────────────────────────────────
export const dramaUser = new Map<number, number | null>()     // drama.id → user_id
export const episodeDrama = new Map<number, number>()          // episode.id → drama_id
export const storyboardEpisode = new Map<number, number>()     // storyboard.id → episode_id

/** 按 id 分段流式读取（keyset 分页，防大表全量加载） */
export async function streamTable<T extends { id: number }>(
  table: any,
  cols: Record<string, any>,
  cb: (rows: T[]) => void | Promise<void>,
): Promise<void> {
  let lastId = 0
  for (;;) {
    const rows = await db.select({ id: table.id, ...cols })
      .from(table)
      .where(gt(table.id, lastId))
      .orderBy(table.id)
      .limit(PAGE) as unknown as T[]
    if (!rows.length) break
    await cb(rows)
    lastId = rows[rows.length - 1].id
    if (rows.length < PAGE) break
  }
}

export async function buildOwnerIndexes() {
  await streamTable(schema.dramas, { userId: schema.dramas.userId }, rows => {
    for (const r of rows) dramaUser.set(r.id, (r as any).userId ?? null)
  })
  await streamTable(schema.episodes, { dramaId: schema.episodes.dramaId }, rows => {
    for (const r of rows) episodeDrama.set(r.id, (r as any).dramaId)
  })
  await streamTable(schema.storyboards, { episodeId: schema.storyboards.episodeId }, rows => {
    for (const r of rows) storyboardEpisode.set(r.id, (r as any).episodeId)
  })
  console.log(`[index] dramas=${dramaUser.size} episodes=${episodeDrama.size} storyboards=${storyboardEpisode.size}`)
}

export function ownerOfDrama(dramaId: number | null | undefined): Owner {
  return { userId: dramaId != null ? dramaUser.get(dramaId) ?? null : null, dramaId: dramaId ?? null }
}

// ─── 路径映射 ──────────────────────────────────────────────
export const FLAT_RE = /^static\/(images|videos|merged|uploads)\/([^/]+)$/

/** 旧平铺路径 → 新分层路径；非平铺/非本地路径返回 null（幂等：已迁移的直接跳过） */
export function mapPath(value: string, owner: Owner): { oldRel: string; newRel: string } | null {
  const rel = value.startsWith('/') ? value.slice(1) : value
  const m = rel.match(FLAT_RE)
  if (!m) return null
  const [, cat, filename] = m
  const nested = cat === 'uploads'
    ? String(owner.userId ?? 0)
    : `${owner.userId ?? 0}/${owner.dramaId ?? 'unassigned'}`
  return { oldRel: rel, newRel: `static/${cat}/${nested}/${filename}` }
}

// 全局状态
export const moves = new Map<string, string>()          // oldRel → newRel（去重）
export const referenced = new Set<string>()             // DB 中引用过的平铺旧路径（孤儿判定基准）
export const updatesByTable = new Map<string, { table: any; rows: { id: number; set: Record<string, any> }[] }>()

export function recordUpdate(tableKey: string, table: any, id: number, set: Record<string, any>) {
  const entry = updatesByTable.get(tableKey) ?? { table, rows: [] }
  entry.rows.push({ id, set })
  updatesByTable.set(tableKey, entry)
}

/** 单值列映射：返回新值或 null（无变化） */
export function mapColumn(value: string | null | undefined, owner: Owner): string | null {
  if (!value) return null
  const hit = mapPath(value, owner)
  if (!hit) return null
  referenced.add(hit.oldRel)
  moves.set(hit.oldRel, hit.newRel)
  return hit.newRel
}

/** JSON 数组列映射（reference_images 等，元素可能是本地路径/远程 URL/dataURL） */
export function mapJsonColumn(value: string | null | undefined, owner: Owner): string | null {
  if (!value) return null
  let arr: any
  try { arr = JSON.parse(value) } catch { return null }
  if (!Array.isArray(arr)) return null
  let changed = false
  const mapped = arr.map((item) => {
    if (typeof item !== 'string') return item
    const nv = mapColumn(item, owner)
    if (nv) { changed = true; return nv }
    return item
  })
  return changed ? JSON.stringify(mapped) : null
}

export { getStorageRoot }
