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
 * FFmpeg 多镜头拼接 — 将所有生成后的镜头视频拼接为一集
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { db, getInsertId, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { logTaskError, logTaskStart, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { runFfmpeg, runFfprobe, checkFfmpegSuite } from '../utils/ffmpeg.js'
import { getAbsolutePath, buildAssetDir, tenantNestedPath, getStorageRoot } from '../utils/storage.js'

// 路径解析统一收口到 storage.ts：支持分类目录外置与绝对路径透传（兼容历史数据）
function toAbsPath(relativePath: string): string {
  return getAbsolutePath(relativePath)
}

/**
 * 拼接一集的镜头视频。
 * 优先使用视频生成产物，兼容历史的 composedVideoUrl 数据。
 * 传入 storyboardIds 时只拼接所选镜头（仍按镜号顺序）。
 */
export async function mergeEpisodeVideos(episodeId: number, dramaId: number, storyboardIds?: number[], userId?: number): Promise<number> {
  let storyboards = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)

  if (storyboardIds?.length) {
    const allow = new Set(storyboardIds.map(Number))
    storyboards = storyboards.filter(sb => allow.has(sb.id))
  }

  // 允许部分拼接:按镜号顺序拼接已生成的镜头,未生成的跳过
  const clips = storyboards
    .map(sb => ({ sb, url: sb.videoUrl || sb.composedVideoUrl }))
    .filter(c => Boolean(c.url)) as { sb: typeof storyboards[number]; url: string }[]

  if (clips.length === 0) throw new Error('所选镜头还没有可拼接的视频')

  // 拼接前探测 ffmpeg：二进制不可用时提前拦截并给出可操作的修复指引（路由层会作为 400 返回前端）
  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg || !suite.ffprobe) {
    throw new Error('本机 ffmpeg 不可用，无法拼接视频（常见于 node_modules 跨平台拷贝或 ffmpeg-static 下载损坏）。请删除 node_modules 后在本机重新 npm install，或设置 FFMPEG_BIN 指向有效的 ffmpeg 可执行文件后重启服务')
  }

  // 校验视频文件真实存在:DB 里的 video_url 可能指向已被清理的文件,
  // 直接拼会得到 ffmpeg 的 "No such file or directory" 晦涩报错
  const missing = clips.filter(c => !fs.existsSync(toAbsPath(c.url)))
  if (missing.length > 0) {
    const nums = missing.map(c => `S${c.sb.storyboardNumber}`).join('、')
    throw new Error(`镜头 ${nums} 的视频文件已丢失（本地文件不存在），请重新生成这些镜头的视频，或在拼接时取消勾选`)
  }

  const videos = clips.map(c => c.url)

  logTaskStart('MergeTask', 'episode-merge', { episodeId, dramaId, clips: videos.length })

  // 创建 merge 记录：title 取本集真实标题（曾写 `Episode {episodeId} Merge` 内部占位串，
  // 该字段随接口下发前端并用于成片下载命名，占位串会直接泄漏进文件名）
  const ts = now()
  const [ep] = await db.select({ title: schema.episodes.title })
    .from(schema.episodes).where(eq(schema.episodes.id, episodeId)).limit(1)
  const res = await db.insert(schema.videoMerges).values({
    episodeId,
    dramaId,
    userId: userId ?? null,
    title: ep?.title || null,
    provider: 'ffmpeg',
    model: 'ffmpeg-concat-h264-aac',
    status: 'processing',
    scenes: JSON.stringify(videos),
    createdAt: ts,
  })
  const mergeId = getInsertId(res)

  // 异步执行（透传租户上下文：成片落 {merged}/{user_id}/{drama_id}/ 分层目录）
  doMerge(mergeId, episodeId, dramaId, userId ?? null, videos).catch(async err => {
    logTaskError('MergeTask', 'episode-merge', { mergeId, episodeId, error: err.message })
    console.error(`[Merge] Failed:`, err)
    await db.update(schema.videoMerges)
      .set({ status: 'failed', errorMsg: err.message })
      .where(eq(schema.videoMerges.id, mergeId))
  })

  return mergeId
}

/** 探测单个片段的音视频关键参数，判断能否走免重编码的流拷贝拼接（直跑 ffprobe，绕开 fluent-ffmpeg 崩溃路径） */
function probeClip(absPath: string): Promise<{ v: string | null; a: string | null }> {
  return runFfprobe([
    '-v', 'error', '-print_format', 'json',
    '-show_streams', '-show_format', absPath,
  ]).then(out => {
    const meta = JSON.parse(out) as { streams?: any[] }
    const vs = (meta.streams || []).find((s: any) => s.codec_type === 'video')
    const as = (meta.streams || []).find((s: any) => s.codec_type === 'audio')
    // 采样宽高/帧率/编码等关键维度；音频额外要求采样率与声道一致，否则无缝拼接会错位/静音丢失
    return {
      v: vs ? `${vs.codec_name}|${vs.width}x${vs.height}|${vs.r_frame_rate}|${vs.profile ?? ''}` : null,
      a: as ? `${as.codec_name}|${as.sample_rate}|${as.channels}` : null,
    }
  }).catch(() => ({ v: null, a: null }))
}

/** 全部片段编码参数一致（h264+aac 且有音轨）时返回 true，可用 -c copy 流拷贝（秒级完成，无画质损失） */
async function canStreamCopy(absPaths: string[]): Promise<boolean> {
  const probes = await Promise.all(absPaths.map(probeClip))
  if (probes.some(p => !p.v || !p.a)) return false
  const sig = `${probes[0].v}#${probes[0].a}`
  return probes.every(p => `${p.v}#${p.a}` === sig) && probes[0].v!.startsWith('h264') && probes[0].a!.startsWith('aac')
}

/** 需要重编码时的视频编码器：macOS 优先 VideoToolbox 硬编（快 5~10 倍），其余平台 libx264 并降为 veryfast */
let encoderCache: string[] | null = null
function pickVideoEncoder(): string[] {
  if (encoderCache) return encoderCache
  let encoders: string[]
  if (process.platform === 'darwin') {
    encoders = ['-c:v', 'h264_videotoolbox', '-b:v', '8M']
  } else {
    encoders = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']
  }
  encoderCache = encoders
  return encoders
}

async function doMerge(mergeId: number, episodeId: number, dramaId: number, userId: number | null, videos: string[]) {
  // 生成 concat 列表文件（临时文件放在存储根下，不属于素材分类）
  const listDir = path.join(getStorageRoot(), 'temp')
  fs.mkdirSync(listDir, { recursive: true })
  const listPath = path.join(listDir, `${uuid()}.txt`)

  const listContent = videos
    .map(v => `file '${toAbsPath(v)}'`)
    .join('\n')

  // 输出文件（成片分类目录，按租户/剧集分层）
  const outputDir = buildAssetDir('merged', userId, dramaId)
  fs.mkdirSync(outputDir, { recursive: true })
  const outputFilename = `${uuid()}.mp4`
  const outputPath = path.join(outputDir, outputFilename)

  try {
    fs.writeFileSync(listPath, listContent, 'utf-8')
    // 拼接策略：镜头来自同一视频模型时编码参数完全一致，直接流拷贝免重编码；不一致才降级重编码
    const streamCopy = await canStreamCopy(videos.map(toAbsPath)).catch(() => false)
    const outputOptions = streamCopy
      ? ['-fflags', '+genpts', '-c', 'copy', '-movflags', '+faststart']
      : [
          '-fflags', '+genpts',
          ...pickVideoEncoder(),
          '-c:a', 'aac',
          '-ar', '48000',
          '-b:a', '192k',
          '-movflags', '+faststart',
        ]
    logTaskWarn('MergeTask', 'strategy', { mergeId, mode: streamCopy ? 'stream-copy' : 'reencode' })

    // 拼接用 runFfmpeg 直接 spawn（绕开 fluent-ffmpeg 在 Node ≥22 的进程级崩溃路径），失败抛错由外层 catch 落库
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, ...outputOptions, outputPath], 30 * 60_000)
  } finally {
    // 清理临时文件
    // 只回收本任务清单；异常写入、拼接失败和超时同样回收，不覆盖原始业务错误。
    try {
      fs.unlinkSync(listPath)
    } catch (err) {
      const cleanupError = err as NodeJS.ErrnoException
      if (cleanupError.code !== 'ENOENT') {
        logTaskWarn('MergeTask', 'cleanup-list', { mergeId, listPath, error: cleanupError.message })
      }
    }
  }

  // 获取时长
  const duration = await getVideoDuration(outputPath)

  const mergedRelative = `static/merged/${tenantNestedPath(userId, dramaId)}/${outputFilename}`

  // 成片海报帧（导出页封面用）
  await extractVideoPoster(mergedRelative)

  // 更新 merge 记录
  await db.update(schema.videoMerges)
    .set({ status: 'completed', mergedUrl: mergedRelative, duration, completedAt: now() })
    .where(eq(schema.videoMerges.id, mergeId))

  // 更新 episode
  await db.update(schema.episodes)
    .set({ videoUrl: mergedRelative, updatedAt: now() })
    .where(eq(schema.episodes.id, episodeId))

  logTaskSuccess('MergeTask', 'episode-merge', { mergeId, episodeId, output: mergedRelative, duration, clips: videos.length })
}

function getVideoDuration(filePath: string): Promise<number> {
  return runFfprobe(['-v', 'error', '-print_format', 'json', '-show_format', filePath])
    .then(out => {
      const meta = JSON.parse(out) as { format?: { duration?: string } }
      return Math.round(Number(meta.format?.duration) || 0)
    })
    .catch(() => 0)
}
