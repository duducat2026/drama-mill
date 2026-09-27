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
 * ffmpeg/ffprobe 统一入口与可用性探测
 *
 * 为什么要自己 spawn：
 * 1) ffmpeg-static 下载损坏（比如把 HTML 错误页存成了 ffmpeg.exe）或 node_modules
 *    跨平台拷贝时，spawn 会同步抛 EFTYPE/ENOENT；这个异常若发生在 fluent-ffmpeg 的
 *    延迟回调里，外层 try/catch 根本接不住，整个 Node 进程直接崩。
 * 2) fluent-ffmpeg 2.1.3 在 Node ≥22 上，子进程异常退出时其内部 endCB 会读未初始化的
 *    stdoutRing/stderrRing，TypeError 崩进程——同样是库内回调，外层无从捕获。
 * 所以热路径（海报帧/拼接/探测）一律走下面的 runFfmpeg/runFfprobe 直接 spawn，
 * 失败以可捕获 Error 抛出，由业务侧优雅降级；调用前再用 checkFfmpegSuite 主动探活。
 */
import { spawn } from 'child_process'
import fs from 'fs'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPathImport from 'ffmpeg-static'
import { createRequire } from 'module'

// ffprobe-static 没有类型声明，且仓库 .gitignore 屏蔽 *.d.ts，用 createRequire 取
const ffprobeStatic = createRequire(import.meta.url)('ffprobe-static') as { path: string }

// ffmpeg-static 声明是 string，但目标平台无对应二进制时实际为 null
const ffmpegPath = ffmpegPathImport as string | null
const ffprobePath = (ffprobeStatic?.path as string | null) || null

// 没装系统 ffmpeg 的机器回退到项目内置二进制
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath)

export { ffmpeg }

export interface FfmpegSuite {
  ffmpeg: boolean
  ffprobe: boolean
}

/** 真跑一次 `-version` 确认二进制可执行；同步异常（Windows EFTYPE）与超时都算不可用 */
function probeBinary(binPath: string | null): Promise<boolean> {
  if (!binPath || !fs.existsSync(binPath)) return Promise.resolve(false)
  return new Promise((resolve) => {
    let done = false
    const settle = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => settle(false), 10_000)
    let child
    try {
      child = spawn(binPath, ['-version'], { stdio: 'ignore', windowsHide: true })
    } catch {
      // Windows 上 spawn 非 PE 文件（损坏的 ffmpeg.exe）在这里就同步炸出来
      settle(false)
      return
    }
    child.on('error', () => settle(false))
    child.on('close', (code) => settle(code === 0))
  })
}

/**
 * 直接 spawn ffmpeg 执行一次任务（绕开 fluent-ffmpeg）。
 * 超时先 SIGKILL，等进程 close 后才 reject——发信号不等于进程退出，
 * 提前抛错会让调用方去删仍被占用的输入/输出文件。
 */
export function runFfmpeg(args: string[], timeoutMs = 300_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) { reject(new Error('ffmpeg 二进制不可用')); return }
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    // 只保留 stderr 尾部，长转码日志不会撑爆内存
    let tail = ''
    child.stderr?.on('data', (d: Buffer) => {
      tail = (tail + d.toString()).slice(-64_000)
    })
    let abortReason: Error | undefined
    const timer = setTimeout(() => {
      abortReason = new Error(`ffmpeg 执行超时 (${Math.round(timeoutMs / 1000)}s)`)
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      abortReason ??= err
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (abortReason) { reject(abortReason); return }
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${tail.slice(-400)}`))
    })
  })
}

/** 直接 spawn ffprobe，把 stdout 原文交给调用方（自行配 -print_format json 解析） */
export function runFfprobe(args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffprobePath) { reject(new Error('ffprobe 二进制不可用')); return }
    const child = spawn(ffprobePath, args, { windowsHide: true })
    let stdout = ''
    let tail = ''
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { tail += d.toString() })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`ffprobe 执行超时 (${Math.round(timeoutMs / 1000)}s)`))
    }, timeoutMs)
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`ffprobe exit ${code}: ${tail.slice(-200)}`))
    })
  })
}

// 探测通过的结果进程内缓存（只成功才缓存）；失败不落缓存，修好二进制不用重启
let suiteCache: FfmpegSuite | null = null
let alerted = false

/** 探测内置 ffmpeg/ffprobe 是否双双可用 */
export async function checkFfmpegSuite(): Promise<FfmpegSuite> {
  if (suiteCache) return suiteCache
  const [ffmpegOk, ffprobeOk] = await Promise.all([probeBinary(ffmpegPath), probeBinary(ffprobePath)])
  const suite = { ffmpeg: ffmpegOk, ffprobe: ffprobeOk }
  if (ffmpegOk && ffprobeOk) {
    suiteCache = suite
  } else if (!alerted) {
    alerted = true
    console.warn(
      `[ffmpeg] 内置二进制不可用 (ffmpeg=${ffmpegOk ? 'ok' : 'FAIL'}, ffprobe=${ffprobeOk ? 'ok' : 'FAIL'})。` +
      `海报帧提取与视频拼接将跳过/失败。修复：删除 node_modules 后在本机重新 npm install，` +
      `或设置 FFMPEG_BIN 指向有效的 ffmpeg 可执行文件`
    )
  }
  return suite
}
