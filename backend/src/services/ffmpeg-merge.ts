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
 * FFmpeg 成片合成 — 将一集内各分镜已生成的视频按镜号顺序拼接为整集成片。
 * 同批镜头出自同一视频模型时编码参数一致，优先走 -c copy 流拷贝（秒级、零损耗）；
 * 参数不齐或缺音轨才降级重编码。
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

// 路径解析一律经 storage.ts 收口：兼容分类目录外置与绝对路径透传的历史数据
function toAbsPath(relativePath: string): string {
  return getAbsolutePath(relativePath)
}

/**
 * 发起一集成片拼接（异步执行，立即返回 merge 记录 ID）。
 * 视频来源优先 videoUrl，兼容历史数据的 composedVideoUrl；
 * storyboardIds 非空时仅拼接勾选的镜头（依旧按镜号排序）。
 */
export async function mergeEpisodeVideos(episodeId: number, dramaId: number, storyboardIds?: number[], userId?: number): Promise<number> {
  let storyboards = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)

  if (storyboardIds?.length) {
    const picked = new Set(storyboardIds.map(Number))
    storyboards = storyboards.filter(sb => picked.has(sb.id))
  }

  // 允许部分拼接：只收有视频的镜头，未生成的直接跳过
  const clips = storyboards
    .map(sb => ({ sb, url: sb.videoUrl || sb.composedVideoUrl }))
    .filter(c => Boolean(c.url)) as { sb: typeof storyboards[number]; url: string }[]

  if (!clips.length) throw new Error('所选镜头还没有可拼接的视频')

  // 动手前先探测 ffmpeg 套件：二进制异常要在入口就拦下并给修复指引（路由层按 400 透给前端）
  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg || !suite.ffprobe) {
    throw new Error('本机 ffmpeg 不可用，无法拼接视频（常见于 node_modules 跨平台拷贝或 ffmpeg-static 下载损坏）。请删除 node_modules 后在本机重新 npm install，或设置 FFMPEG_BIN 指向有效的 ffmpeg 可执行文件后重启服务')
  }

  // DB 中的 video_url 可能指向已被清理的文件，预检存在性，
  // 免得把残缺清单喂给 ffmpeg 换来一句晦涩的 "No such file or directory"
  const lost = clips.filter(c => !fs.existsSync(toAbsPath(c.url)))
  if (lost.length > 0) {
    const nums = lost.map(c => `S${c.sb.storyboardNumber}`).join('、')
    throw new Error(`镜头 ${nums} 的视频文件已丢失（本地文件不存在），请重新生成这些镜头的视频，或在拼接时取消勾选`)
  }

  const videos = clips.map(c => c.url)

  logTaskStart('MergeTask', 'episode-merge', { episodeId, dramaId, clips: videos.length })

  // 建 merge 记录：title 必须用本集真实标题——该字段会随接口下发前端并参与成片下载命名，
  // 早期写死的内部占位串曾直接泄漏进用户下载的文件名
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

  // 后台执行（租户上下文一路透传：成片按 {merged}/{user_id}/{drama_id}/ 分层落盘）
  doMerge(mergeId, episodeId, dramaId, userId ?? null, videos).catch(async err => {
    logTaskError('MergeTask', 'episode-merge', { mergeId, episodeId, error: err.message })
    console.error(`[Merge] Failed:`, err)
    await db.update(schema.videoMerges)
      .set({ status: 'failed', errorMsg: err.message })
      .where(eq(schema.videoMerges.id, mergeId))
  })

  return mergeId
}

/** ffprobe 单片段取音视频关键参数（直跑 ffprobe，绕开 fluent-ffmpeg 的崩溃路径），任一路缺失或探测失败记 null */
function probeClip(absPath: string): Promise<{ v: string | null; a: string | null }> {
  return runFfprobe([
    '-v', 'error', '-print_format', 'json',
    '-show_streams', '-show_format', absPath,
  ]).then(out => {
    const meta = JSON.parse(out) as { streams?: any[] }
    const vs = (meta.streams || []).find((s: any) => s.codec_type === 'video')
    const as = (meta.streams || []).find((s: any) => s.codec_type === 'audio')
    // 视频比编码/宽高/帧率/profile；音频还要求采样率与声道一致——不齐时流拷贝会错位或丢音
    return {
      v: vs ? `${vs.codec_name}|${vs.width}x${vs.height}|${vs.r_frame_rate}|${vs.profile ?? ''}` : null,
      a: as ? `${as.codec_name}|${as.sample_rate}|${as.channels}` : null,
    }
  }).catch(() => ({ v: null, a: null }))
}

/** 所有片段编码参数完全一致且都带音轨（h264+aac）才允许 -c copy 流拷贝；缺音轨片段自动降级重编码 */
async function canStreamCopy(absPaths: string[]): Promise<boolean> {
  const probes = await Promise.all(absPaths.map(probeClip))
  if (probes.some(p => !p.v || !p.a)) return false
  const signature = `${probes[0].v}#${probes[0].a}`
  return probes.every(p => `${p.v}#${p.a}` === signature)
    && probes[0].v!.startsWith('h264') && probes[0].a!.startsWith('aac')
}

// 重编码视频编码器选型只看平台、结果可缓存：macOS 走 VideoToolbox 硬编（快 5~10 倍），其余平台 libx264 + veryfast
let encoderCache: string[] | null = null
function pickVideoEncoder(): string[] {
  if (!encoderCache) {
    encoderCache = process.platform === 'darwin'
      ? ['-c:v', 'h264_videotoolbox', '-b:v', '8M']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']
  }
  return encoderCache
}

async function doMerge(mergeId: number, episodeId: number, dramaId: number, userId: number | null, videos: string[]) {
  // concat 清单是临时文件，放存储根 temp 下（不归属任何素材分类目录）
  const listDir = path.join(getStorageRoot(), 'temp')
  fs.mkdirSync(listDir, { recursive: true })
  const listPath = path.join(listDir, `${uuid()}.txt`)
  const listContent = videos
    .map(v => `file '${toAbsPath(v)}'`)
    .join('\n')

  // 成片输出目录：按租户/剧集分层的 merged 分类
  const outputDir = buildAssetDir('merged', userId, dramaId)
  fs.mkdirSync(outputDir, { recursive: true })
  const outputFilename = `${uuid()}.mp4`
  const outputPath = path.join(outputDir, outputFilename)

  try {
    fs.writeFileSync(listPath, listContent, 'utf-8')
    // 拼接策略二选一：编码全齐走流拷贝，否则带重编码参数（探测失败按重编码兜底）
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

    // 执行拼接走 runFfmpeg 直接 spawn（fluent-ffmpeg 在 Node ≥22 有进程级崩溃路径）；抛错由外层统一落库
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, ...outputOptions, outputPath], 30 * 60_000)
  } finally {
    // 无论写入是否完整、拼接是否失败或超时，本任务的清单文件都必须回收；
    // 只删 ENOENT 之外的错误才记警告，不让清理异常覆盖业务错误
    try {
      fs.unlinkSync(listPath)
    } catch (err) {
      const cleanupError = err as NodeJS.ErrnoException
      if (cleanupError.code !== 'ENOENT') {
        logTaskWarn('MergeTask', 'cleanup-list', { mergeId, listPath, error: cleanupError.message })
      }
    }
  }

  // 探测成片时长（失败记 0，不阻断回填）
  const duration = await getVideoDuration(outputPath)

  const mergedRelative = `static/merged/${tenantNestedPath(userId, dramaId)}/${outputFilename}`

  // 顺手抽一帧海报图，供导出页做封面
  await extractVideoPoster(mergedRelative)

  // merge 记录回填成片路径与完成态
  await db.update(schema.videoMerges)
    .set({ status: 'completed', mergedUrl: mergedRelative, duration, completedAt: now() })
    .where(eq(schema.videoMerges.id, mergeId))

  // 集的 videoUrl 同步指向新成片
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
