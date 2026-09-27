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
 * 资产图片重复任务清理脚本 — 基于状态合并同一资产的重复生成任务
 *
 * 用法：cd backend && npx tsx scripts/dedupe-active-image-tasks.ts
 *
 * 背景：提交入口曾缺少状态去重，重复点击/多源重提会让同一道具/场景/角色
 * 在队列中堆积多个活跃图片任务。本脚本按资产归组合并：
 *   - 已提交上游（有 task_id，已计费）的任务一律保留，不做无谓浪费
 *   - 仍未提交上游的排队任务：保留最早的一个，其余判失败（错误信息标注合并来源）
 * 仅处理 processing/pending 的 image 任务，可重复执行。
 * 注意：执行后应重启后端进程，确保排队中的被合并任务出队时走「状态非 processing 即跳过」守卫。
 */
import { eq, and } from 'drizzle-orm'
import { db, schema } from '../src/db/index.js'
import { now } from '../src/utils/response.js'

const ACTIVE_TASK_STATUSES = ['processing', 'pending']
const KINDS = ['characterId', 'sceneId', 'propId'] as const
const KIND_LABEL: Record<string, string> = { characterId: '角色', sceneId: '场景', propId: '道具' }

async function main() {
  const rows = await db.select().from(schema.sysTask).where(eq(schema.sysTask.type, 'image'))
  const active = rows.filter(t => ACTIVE_TASK_STATUSES.includes(t.status || ''))
  console.log(`活跃图片任务 ${active.length} 个，开始按资产归组去重 ...`)

  let merged = 0
  for (const kind of KINDS) {
    const grouped = new Map<number, typeof active>()
    for (const t of active) {
      const key = t[kind]
      if (!key) continue
      const list = grouped.get(key) || []
      list.push(t)
      grouped.set(key, list)
    }
    for (const [assetId, tasks] of grouped) {
      if (tasks.length < 2) continue
      // 已提交上游（持有 task_id）的保留：钱已花，只合并还在排队的；无已提交则保留最早入队的一个
      const submitted = tasks.filter(t => !!t.taskId)
      const queued = tasks.filter(t => !t.taskId).sort((a, b) => a.id - b.id)
      const keep = submitted[0] ?? queued[0]
      const dups = submitted.length ? queued : queued.slice(1)
      if (!keep || !dups.length) continue
      for (const dup of dups) {
        const [rs] = await db.update(schema.sysTask)
          .set({ status: 'failed', errorMsg: `已合并：同一${KIND_LABEL[kind]}已有进行中的图片任务 #${keep.id}，重复提交被清理`, updatedAt: now() })
          .where(and(eq(schema.sysTask.id, dup.id), eq(schema.sysTask.status, dup.status!)))
        if ((rs?.affectedRows ?? 0) > 0) merged++
      }
      console.log(`[dedupe] ${KIND_LABEL[kind]}#${assetId}: 保留 #${keep.id}, 合并 ${dups.map(t => t.id).join(',')}`)
    }
  }
  console.log(`完成：共合并 ${merged} 个重复任务（活跃总数 ${active.length} → ${active.length - merged}）`)
  process.exit(0)
}

main().catch(err => {
  console.error('[dedupe] 执行失败:', err)
  process.exit(1)
})
