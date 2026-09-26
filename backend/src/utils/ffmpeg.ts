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
 * FFmpeg 统一配置与可用性探测
 *
 * 背景：Windows 上若 node_modules 跨平台拷贝、或 ffmpeg-static postinstall
 * 下载损坏（HTML 错误页被存成 ffmpeg.exe），spawn 非 PE 文件会同步抛
 * EFTYPE；该异常发生在 fluent-ffmpeg 的延迟回调里，外层 try/catch 接不住，
 * 直接崩掉整个 Node 进程。这里在业务调用前主动 spawn -version 探测，
 * 不可用时由业务侧优雅降级（海报帧跳过 / 拼接返回明确错误）。
 *
 * 另：fluent-ffmpeg 2.1.3 在 Node ≥22 上还有另一类进程级崩溃 —— 子进程异常
 * 退出时 endCB 访问未初始化的 stdoutRing/stderrRing 直接 TypeError 崩进程
 * （同样发生在库内部回调，外层接不住）。因此热路径（海报帧/拼接/探测）
 * 已改用 runFfmpeg/runFfprobe 直接 spawn，绕开该库。
 */
import { spawn } from 'child_process'
import fs from 'fs'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPathImport from 'ffmpeg-static'
import { createRequire } from 'module'

// ffprobe-static 无类型声明,用 createRequire 引入(仓库 .gitignore 忽略 *.d.ts)
const ffprobeStatic = createRequire(import.meta.url)('ffprobe-static') as { path: string }

// ffmpeg-static 类型声明为 string,实际平台不支持时为 null
const ffmpegPath = ffmpegPathImport as string | null
const ffprobePath = (ffprobeStatic?.path as string | null) || null

// 系统未安装 ffmpeg 时使用项目内置二进制
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath)

export { ffmpeg }

/** spawn 一次 -version 验证二进制真实可执行（含同步 EFTYPE 兜底） */
function probeBinary(binPath: string | null): Promise<boolean> {
  if (!binPath || !fs.existsSync(binPath)) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), 10_000)
    let child
    try {
      child = spawn(binPath, ['-version'], { stdio: 'ignore', windowsHide: true })
    } catch {
      // Windows 上 spawn 非 PE 文件（如下载损坏的 ffmpeg.exe）会同步抛 EFTYPE
      finish(false)
      return
    }
    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
  })
}

export interface FfmpegSuite {
  ffmpeg: boolean
  ffprobe: boolean
}

/** 直跑 ffmpeg（绕开 fluent-ffmpeg 在 Node ≥22 的子进程异常崩溃路径），失败以 Error 抛出可被调用方捕获 */
export function runFfmpeg(args: string[], timeoutMs = 300_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) { reject(new Error('ffmpeg 二进制不可用')); return }
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000)
    })
    let processError: Error | undefined
    const timer = setTimeout(() => {
      processError = new Error(`ffmpeg 执行超时 (${Math.round(timeoutMs / 1000)}s)`)
      // 发出终止信号不等于进程已退出；等 close 后调用方才能安全回收输入文件。
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      processError ??= err
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (processError) { reject(processError); return }
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`))
    })
  })
}

/** 直跑 ffprobe，返回 stdout 原文（调用方可加 -print_format json 自行解析） */
export function runFfprobe(args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffprobePath) { reject(new Error('ffprobe 二进制不可用')); return }
    const child = spawn(ffprobePath, args, { windowsHide: true })
    let stdout = '', stderr = ''
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`ffprobe 执行超时 (${Math.round(timeoutMs / 1000)}s)`))
    }, timeoutMs)
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve(stdout) : reject(new Error(`ffprobe exit ${code}: ${stderr.slice(-200)}`))
    })
  })
}

// 成功的探测结果缓存（进程内只探测一次）；失败不缓存，修复二进制后无需重启即可恢复
let okCache: FfmpegSuite | null = null
let warned = false

/** 探测内置 ffmpeg/ffprobe 是否可用 */
export async function checkFfmpegSuite(): Promise<FfmpegSuite> {
  if (okCache) return okCache
  const [ffmpegOk, ffprobeOk] = await Promise.all([probeBinary(ffmpegPath), probeBinary(ffprobePath)])
  const suite = { ffmpeg: ffmpegOk, ffprobe: ffprobeOk }
  if (ffmpegOk && ffprobeOk) {
    okCache = suite
  } else if (!warned) {
    warned = true
    console.warn(
      `[ffmpeg] 内置二进制不可用 (ffmpeg=${ffmpegOk ? 'ok' : 'FAIL'}, ffprobe=${ffprobeOk ? 'ok' : 'FAIL'})。` +
      `海报帧提取与视频拼接将跳过/失败。修复：删除 node_modules 后在本机重新 npm install，` +
      `或设置 FFMPEG_BIN 指向有效的 ffmpeg 可执行文件`
    )
  }
  return suite
}
