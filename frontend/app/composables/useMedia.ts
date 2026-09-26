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
 * 媒体地址辅助 — 列表/卡片用缩略图与海报帧，大图预览仍用原图
 *
 * 命名约定（后端生成产物时自动产出，见 backend/src/utils/storage.ts、video-poster.ts）：
 *   图片 static/images/x.png      → 缩略图 static/images/x_thumb.webp
 *   视频 static/videos|merged/x.mp4 → 海报帧 static/videos|merged/x_poster.jpg
 * 存量文件可用 `npm run backfill-artwork`（backend）补齐。
 */

/** 图片地址 → 缩略图地址；非 /static 图片（远程 URL 等）原样返回 */
export function thumbOf(url: string): string {
  if (!url || !url.includes('/static/')) return url
  if (!/\.(png|jpe?g|webp|gif)$/i.test(url)) return url
  return url.replace(/\.[^./]+$/, '_thumb.webp')
}

/** 缩略图加载失败（老数据未回填）时回退原图 */
export function thumbFallback(e: Event, orig: string) {
  const el = e.target as HTMLImageElement
  if (!el || el.dataset.fbk || !orig) return
  el.dataset.fbk = '1'
  el.src = orig
}

/** 视频地址 → 海报帧地址；无法推导（远程 URL 等）时返回空串，不设置 poster */
export function posterOf(url: string): string {
  if (!url || !url.includes('/static/')) return ''
  if (!/\.(mp4|webm|mov)$/i.test(url)) return ''
  return url.replace(/\.[^./]+$/, '_poster.jpg')
}
