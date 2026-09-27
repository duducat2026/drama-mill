/**
 * Drama Mill — AI 短剧生成平台
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
// 静态路径判定 + 图片后缀匹配，统一用于派生缩略/海报 URL
const IMG_RE = /\.(png|jpe?g|webp|gif)$/i
const VID_RE = /\.(mp4|webm|mov)$/i
const HAS_STATIC = /\/static\//
const TRAILING_EXT = /\.[^./]+$/

/** 将原始图片 URL 转换为同名 _thumb.webp；外链/非图片类型透传 */
export function thumbOf(addr: string): string {
  if (!addr || !HAS_STATIC.test(addr)) return addr
  if (!IMG_RE.test(addr)) return addr
  return addr.replace(TRAILING_EXT, '_thumb.webp')
}

/** 绑定到 img@error，缩略图 404 时切回原图并打标记防循环 */
export function thumbFallback(evt: Event, fallbackSrc: string) {
  const img = evt.target as HTMLImageElement
  if (!img || img.dataset.fbk || !fallbackSrc) return
  img.dataset.fbk = '1'
  img.src = fallbackSrc
}

/** 将视频 URL 转换为同名 _poster.jpg；无法推导（远程/不支持格式）则返回空串 */
export function posterOf(addr: string): string {
  if (!addr || !HAS_STATIC.test(addr)) return ''
  if (!VID_RE.test(addr)) return ''
  return addr.replace(TRAILING_EXT, '_poster.jpg')
}
