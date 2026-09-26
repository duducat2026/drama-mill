/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */

export function useEpisodeFormat(wb: any) {
function sanitizeFileName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
}
// episodes.title 形如「第3集 重逢在长街」（拆分时自带集号前缀），取名部分避免集号重复
function episodeNamePart(title) {
  return sanitizeFileName(String(title || '').replace(/^第\s*\d+\s*集[\s:：\-_]+/, ''))
}
// 扩展名跟随实际产物（后端可能返回 mov/webm），未知时按 mp4 命名
function mediaExt(url) {
  const m = String(url || '').split('?')[0].match(/\.([a-z0-9]+)$/i)
  return m && /^(mp4|mov|webm|m4v|mkv)$/i.test(m[1]) ? m[1].toLowerCase() : 'mp4'
}
function toCamel(field) {
  return field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function epNumberOf(e) { return e.episode_number || e.episodeNumber }
function fmtDuration(ms) {
  if (ms == null) return '-'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${s % 60}s`
}
function costUsageLabel(r) {
  if (r.service_type === 'text') return `${r.input_tokens ?? 0}+${r.output_tokens ?? 0} tok`
  if (r.service_type === 'image') return `${r.image_count ?? 1} 张`
  if (r.service_type === 'video') return `${r.video_seconds ?? 0} 秒`
  return '-'
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 页面隐藏时拉长等待间隔，避免后台标签页持续高频请求；回前台自动恢复原节奏
async function sleepVisible(ms) {
  await sleep(ms)
  while (typeof document !== 'undefined' && document.hidden) await sleep(10000)
}

function getVideoUrl(s) { return s?.video_url || s?.videoUrl || s?.composed_video_url || s?.composedVideoUrl || null }
function hasVid(s) { return !!getVideoUrl(s) }

// 文件大小格式化：后端返回字节数（视频来自 storyboard.video_size / merge.merged_size）
function formatSize(bytes) {
  const n = Number(bytes)
  if (!n || n <= 0) return ''
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return Math.ceil(n / 1024) + ' KB'
}

// ===== 分镜视频历史（一个分镜可能生成多个视频,sys_task 留存全部记录）=====
function formatHistoryTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function pickFile(accept, cb) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.onchange = () => { const f = input.files?.[0]; if (f) cb(f) }
  input.click()
}

// ===== 资产图片手动上传（角色形象 / 场景图 / 道具图）=====
  return {
    sanitizeFileName, episodeNamePart, mediaExt, formatSize, formatHistoryTime, fmtDuration, costUsageLabel, toCamel, getVideoUrl, hasVid, pickFile, sleep, sleepVisible, epNumberOf,
  }
}
