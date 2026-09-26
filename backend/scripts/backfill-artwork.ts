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
 * 存量文件回填脚本 — 为历史生成的图片/视频补生成缩略图和海报帧
 *
 * 用法：cd backend && npx tsx scripts/backfill-artwork.ts
 *
 * 扫描 data/static 下：
 *   images/  → 为缺少 *_thumb.webp 的图片生成缩略图（宽 400 WebP）
 *   videos/、merged/ → 为缺少 *_poster.jpg 的视频抽取海报帧
 * 递归遍历 {user_id}/{drama_id}/ 嵌套目录（存储分层改造后的实际布局）。
 * 已存在的跳过，可重复执行。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { generateImageThumb, thumbPathFor, getAbsolutePath } from '../src/utils/storage.js'
import { extractVideoPoster, posterPathFor } from '../src/utils/video-poster.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../data/static')

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov'])

/** 递归列出分类目录下所有文件（相对 static/{subDir}/ 的路径），兼容 {user_id}/{drama_id}/ 嵌套布局 */
function listFiles(subDir: string): string[] {
  const dir = path.join(STORAGE_ROOT, subDir)
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) out.push(path.relative(dir, abs))
    }
  }
  walk(dir)
  return out
}

async function backfillImages(subDir: string) {
  let done = 0, skipped = 0, failed = 0
  for (const file of listFiles(subDir)) {
    const ext = path.extname(file).toLowerCase()
    if (!IMAGE_EXTS.has(ext) || file.endsWith('_thumb.webp')) continue
    const rel = `static/${subDir}/${file}`
    if (fs.existsSync(getAbsolutePath(thumbPathFor(rel)))) { skipped++; continue }
    const ok = await generateImageThumb(rel)
    ok ? done++ : failed++
    if (ok) console.log(`  thumb ✓ ${rel}`)
    else console.warn(`  thumb ✗ ${rel}`)
  }
  console.log(`[${subDir}] 缩略图：新生成 ${done}，已存在 ${skipped}，失败 ${failed}`)
}

async function backfillVideos(subDir: string) {
  let done = 0, skipped = 0, failed = 0
  for (const file of listFiles(subDir)) {
    const ext = path.extname(file).toLowerCase()
    if (!VIDEO_EXTS.has(ext)) continue
    const rel = `static/${subDir}/${file}`
    if (fs.existsSync(getAbsolutePath(posterPathFor(rel)))) { skipped++; continue }
    const ok = await extractVideoPoster(rel)
    ok ? done++ : failed++
    if (ok) console.log(`  poster ✓ ${rel}`)
    else console.warn(`  poster ✗ ${rel}`)
  }
  console.log(`[${subDir}] 海报帧：新生成 ${done}，已存在 ${skipped}，失败 ${failed}`)
}

console.log(`回填目录：${STORAGE_ROOT}`)
await backfillImages('images')
await backfillVideos('videos')
await backfillVideos('merged')
console.log('回填完成')
