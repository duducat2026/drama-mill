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
 * 剧集缺失镜头视频重生成 — DB 中 video_url 指向的文件在磁盘上不存在时（如库迁移后素材未同步），
 * 清空这些分镜的 video_url 并复用编排同款入口 submitEpisodeVideoBatch 重新生成（只补缺失的镜头）。
 * 参数与编排器完全一致：集锁定配置/分辨率、剧画幅、分镜时长、参考图收集与 @引用替换。
 *
 * 用法：cd backend && npx tsx scripts/regen-episode-shots.ts <episodeId> <dramaId>
 *
 * 注意：
 * - 生成任务在本脚本进程内提交并轮询（generation 队列为进程内存态），请勿中途 Ctrl-C；
 *   中断后残留 processing 任务由后端看门狗按超时阈值恢复
 * - 重新生成会真实计费（与正常视频生成相同）
 * - 幂等：没有"有 URL 但文件缺失"的分镜时直接退出，不提交任何任务
 */
import 'dotenv/config'
import fs from 'node:fs'
import { db, schema } from '../src/db/index.js'
import { eq, inArray } from 'drizzle-orm'
import { now } from '../src/utils/response.js'
import { getAbsolutePath } from '../src/utils/storage.js'
import { submitEpisodeVideoBatch } from '../src/services/episode-videos.js'

const POLL_MS = 15_000
const TIMEOUT_MS = 40 * 60_000

const episodeId = Number(process.argv[2] || 0)
const dramaId = Number(process.argv[3] || 0)

async function main() {
  if (!episodeId || !dramaId) {
    console.error('用法: npx tsx scripts/regen-episode-shots.ts <episodeId> <dramaId>')
    process.exit(1)
  }
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep || ep.dramaId !== dramaId) {
    console.error(`剧集#${episodeId} 不存在或不属于剧目#${dramaId}`)
    process.exit(1)
  }

  // 1) 找出"有 video_url 但文件缺失"的分镜并清空，使其进入重生成（文件本身已不在，无残留可回收）
  const sbs = (await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId)))
    .filter(sb => !sb.deletedAt)
  const stale = sbs.filter(sb => sb.videoUrl && !fs.existsSync(getAbsolutePath(sb.videoUrl)))
  if (!stale.length) {
    console.log(`剧集#${episodeId} 无缺失文件的镜头，无需重生成`)
    process.exit(0)
  }
  console.log(`缺失文件镜头: ${stale.map(s => `S${s.storyboardNumber}(#${s.id})`).join('、')}`)
  for (const sb of stale) {
    await db.update(schema.storyboards).set({ videoUrl: null, updatedAt: now() })
      .where(eq(schema.storyboards.id, sb.id))
  }

  // 2) 提交重生成（编排同款入口：只为缺 video_url 的分镜提交，其余跳过）
  const { submitted, skipped } = await submitEpisodeVideoBatch(episodeId, dramaId)
  console.log(`已提交 ${submitted.length} 个任务，跳过 ${skipped} 个已有视频的分镜`)
  const taskIds = submitted.map(s => s.task_id)
  if (!taskIds.length) {
    console.error('提交为空，请检查分镜是否缺少视频提示词')
    process.exit(1)
  }

  // 3) 轮询至全部终态（任务在本进程内执行：提交上游 → 轮询 → 下载落盘 → 回写分镜）
  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    const rows = await db.select({
      id: schema.sysTask.id, status: schema.sysTask.status,
      errorMsg: schema.sysTask.errorMsg, storyboardId: schema.sysTask.storyboardId,
    }).from(schema.sysTask).where(inArray(schema.sysTask.id, taskIds))
    const done = rows.filter(r => r.status === 'completed').length
    const failed = rows.filter(r => r.status === 'failed')
    console.log(`[${new Date().toISOString()}] 进度: completed ${done}/${rows.length}` +
      (failed.length ? ` | failed: ${failed.map(f => `#${f.id} ${(f.errorMsg || '').slice(0, 80)}`).join('; ')}` : ''))
    if (done + failed.length === rows.length) break
    if (Date.now() > deadline) {
      console.error(`超时（${TIMEOUT_MS / 60_000} 分钟），仍有任务未到终态，请到任务列表人工查看: ${taskIds.join(',')}`)
      process.exit(1)
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }

  // 4) 终态核对：分镜 video_url 落库且文件真实存在
  const fresh = (await db.select().from(schema.storyboards).where(inArray(schema.storyboards.id, stale.map(s => s.id))))
  let ok = 0
  for (const sb of fresh) {
    const exists = !!sb.videoUrl && fs.existsSync(getAbsolutePath(sb.videoUrl))
    console.log(`${exists ? '✅' : '❌'} S${sb.storyboardNumber}(#${sb.id}) → ${sb.videoUrl || '未生成'}`)
    if (exists) ok++
  }
  console.log(ok === fresh.length ? '🎉 全部镜头重生成完成，可重新发起拼接' : `⚠️ 仅 ${ok}/${fresh.length} 成功，失败镜头请查看任务错误信息`)
  process.exit(ok === fresh.length ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
