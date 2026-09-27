/*
 * Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
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
 * 成片/镜头视频海报帧抽图
 * 列表页 <video poster> 直接吃这张静态图，省掉为首帧缓冲整条视频的开销。
 */
import { getAbsolutePath } from './storage.js'
import { runFfmpeg, checkFfmpegSuite } from './ffmpeg.js'

/** 海报帧落点与原视频同目录，仅换后缀：.mp4 → _poster.jpg */
export function posterPathFor(relativePath: string): string {
  return relativePath.replace(/\.[^./]+$/, '_poster.jpg')
}

/**
 * 抽 0.5s 处的一帧（宽 640、高度按比例）作海报图。
 * 二进制不可用或抽帧失败都只警告并返回 null——封面缺失不阻断生成主流程。
 */
export async function extractVideoPoster(relativePath: string): Promise<string | null> {
  try {
    // 先探测内置二进制（跨平台拷贝 node_modules / 下载残缺时直接跳过）；
    // 抽帧走 runFfmpeg 直接 spawn，不碰 fluent-ffmpeg（Node ≥22 有进程级崩溃路径）
    const suite = await checkFfmpegSuite()
    if (!suite.ffmpeg) return null

    const posterRel = posterPathFor(relativePath)
    const args = [
      '-y', '-ss', '0.5', '-i', getAbsolutePath(relativePath),
      '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3',
      getAbsolutePath(posterRel),
    ]
    await runFfmpeg(args, 60_000)
    return posterRel
  } catch (err) {
    console.warn(`[video-poster] 海报帧提取失败 ${relativePath}:`, (err as Error).message)
    return null
  }
}
