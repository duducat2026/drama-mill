/*
 * Drama Mill — 存储布局迁移：文件搬迁 / 孤儿归档 / 数据库回写
 */
import fs from 'fs'
import path from 'path'
import { eq } from 'drizzle-orm'
import { db } from '../../src/db/index.js'
import { categoryDir, getAbsolutePath, getStorageRoot, thumbPathFor } from '../../src/utils/storage.js'
import { posterPathFor } from '../../src/utils/video-poster.js'
import {
  BATCH,
  CATEGORIES,
  DRY_RUN,
  moves,
  referenced,
  updatesByTable,
} from './state.js'

/** 单文件搬迁：同卷 rename，跨卷（EXDEV）降级复制+校验后删源 */
export function moveFile(srcAbs: string, dstAbs: string): 'moved' | 'conflict' {
  fs.mkdirSync(path.dirname(dstAbs), { recursive: true })
  try {
    fs.renameSync(srcAbs, dstAbs)
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err
    fs.copyFileSync(srcAbs, dstAbs)
    if (fs.statSync(srcAbs).size !== fs.statSync(dstAbs).size) {
      fs.unlinkSync(dstAbs)
      throw new Error(`跨卷复制校验失败: ${srcAbs}`)
    }
    fs.unlinkSync(srcAbs)
  }
  return 'moved'
}

export async function moveFiles() {
  let moved = 0, already = 0, missing = 0, conflicts = 0
  for (const [oldRel, newRel] of moves) {
    // 派生文件一并搬迁：图片缩略图 _thumb.webp、视频海报帧 _poster.jpg
    const pairs: [string, string][] = [[oldRel, newRel]]
    if (oldRel.startsWith('static/images/')) pairs.push([thumbPathFor(oldRel), thumbPathFor(newRel)])
    if (oldRel.startsWith('static/videos/') || oldRel.startsWith('static/merged/')) pairs.push([posterPathFor(oldRel), posterPathFor(newRel)])

    for (const [o, n] of pairs) {
      const srcAbs = getAbsolutePath(o)
      const dstAbs = getAbsolutePath(n)
      if (srcAbs === dstAbs) continue
      const srcExists = fs.existsSync(srcAbs)
      const dstExists = fs.existsSync(dstAbs)
      if (!srcExists) { if (o === oldRel) { dstExists ? already++ : missing++ } continue }
      if (dstExists) { conflicts++; continue }
      moveFile(srcAbs, dstAbs)
      if (o === oldRel) moved++
    }
  }
  console.log(`[files] moved=${moved} already=${already} missing=${missing} conflicts=${conflicts} (派生文件未单独计数)`)
  if (conflicts > 0) console.warn('[files] ⚠️ 存在目标已存在的冲突文件，未覆盖；请人工核对后重跑')
}

/** 平铺层无引用文件 → data/static/_orphan/{分类}/（引用按 DB 扫描结果 + 派生文件命名规则判定） */
export function archiveOrphans() {
  // 每个分类的引用文件名（去扩展名）集合：缩略图/海报帧按原始文件基名跟随判定
  const stemsByCat = new Map<string, Set<string>>()
  for (const rel of referenced) {
    const parts = rel.split('/')
    if (parts.length !== 3) continue
    const cat = parts[1]
    const stem = path.basename(parts[2], path.extname(parts[2]))
    if (!stemsByCat.has(cat)) stemsByCat.set(cat, new Set())
    stemsByCat.get(cat)!.add(stem)
  }

  const orphanRoot = path.join(getStorageRoot(), '_orphan')
  let archived = 0
  for (const cat of CATEGORIES) {
    const dir = categoryDir(cat)
    if (!fs.existsSync(dir)) continue
    const stems = stemsByCat.get(cat) ?? new Set()
    for (const entry of fs.readdirSync(dir)) {
      const abs = path.join(dir, entry)
      if (!fs.statSync(abs).isFile()) continue // 已有分层子目录不动
      const stem = entry.replace(/_thumb\.webp$|_poster\.jpg$/, '')
      const stemNoExt = path.basename(stem, path.extname(stem))
      const isRef = stems.has(stemNoExt) || stems.has(entry.replace(path.extname(entry), ''))
      if (isRef) continue
      if (!DRY_RUN) {
        fs.mkdirSync(path.join(orphanRoot, cat), { recursive: true })
        moveFile(abs, path.join(orphanRoot, cat, entry))
      }
      archived++
    }
  }
  console.log(`[orphans] ${DRY_RUN ? '(dry-run) 将归档' : '已归档'} ${archived} 个无引用文件 → ${orphanRoot}`)
}

export async function applyDbUpdates() {
  for (const [tableKey, { table, rows }] of updatesByTable) {
    let done = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH)
      await db.transaction(async (tx) => {
        for (const u of chunk) {
          await tx.update(table).set(u.set).where(eq(table.id, u.id))
        }
      })
      done += chunk.length
    }
    console.log(`[db] ${tableKey} 更新 ${done} 行`)
  }
}
