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
 * Agent 异步执行子路由：分镜拆分 + 剧本改写（POST run 即返回 / status 轮询 / retry 注入原因）。
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, now } from '../utils/response.js'
import { executeAgentRun, normalizeToolResult } from '../services/agent-run.js'
import { getDramaOwned, getEpisodeOwned } from '../services/ownership.js'
import { withTiming } from '../utils/stage-timing.js'
import { recordTextUsageFromResult } from '../services/cost.js'
import { resolveTextConfigMeta } from '../services/ai.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

// ─── 分镜拆分异步执行：POST run 即返回，Agent 后台跑，status 轮询进度；
// 页面刷新/关闭不中断（与同步 chat 不同），状态存进程内存，重启后自然重置为 idle ───
type BreakerRun = { status: 'running' | 'done' | 'failed'; started_at: string; finished_at?: string; error?: string | null }
const breakerRuns = new Map<number, BreakerRun>()

async function countEpisodeStoryboards(episodeId: number) {
  const rows = await db.select({ id: schema.storyboards.id }).from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
  return rows.length
}

// POST /agent/storyboard_breaker/run — 异步启动分镜拆分（立即返回）
app.post('/storyboard_breaker/run', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const episodeId = Number(body.episode_id)
  if (!episodeId || !body.drama_id) return badRequest(c, 'drama_id and episode_id are required')
  await getDramaOwned(Number(body.drama_id), user)
  const existing = breakerRuns.get(episodeId)
  if (existing?.status === 'running') return success(c, { already_running: true })

  const run: BreakerRun = { status: 'running', started_at: now(), error: null }
  breakerRuns.set(episodeId, run)
  logTaskStart('Agent', 'storyboard_breaker(async)', { dramaId: body.drama_id, episodeId })

  void (async () => {
    const startTime = performance.now()
    try {
      // 耗时打点：storyboard_split；成本采集：按实际解析到的文本配置记录用量
      const result = await withTiming(episodeId, Number(body.drama_id), 'storyboard_split', () =>
        executeAgentRun('storyboard_breaker', body.message, {
          episodeId,
          dramaId: Number(body.drama_id),
          model: body.model,
          configId: body.config_id,
          userId: user.id,
        }))
      const costMeta = await resolveTextConfigMeta(user.id, body.config_id)
      await recordTextUsageFromResult(result, costMeta, {
        userId: user.id, dramaId: Number(body.drama_id), episodeId, configId: costMeta?.configId, detail: 'storyboard_split',
      })
      const toolErrors = (result.toolResults || []).filter((tr: any) => /"error"\s*:\s*true/.test(normalizeToolResult(tr))).length
      const count = await countEpisodeStoryboards(episodeId)
      run.finished_at = now()
      // 模型反复传错参数耗尽步数时不会抛异常：以「零保存 + 有工具错误」判失败，前端可提示重试
      if (!count && toolErrors > 0) {
        run.status = 'failed'
        run.error = '分镜拆分失败：模型传参异常，请点击重新拆分重试'
      } else {
        run.status = 'done'
      }
      logTaskSuccess('Agent', 'storyboard_breaker(async)', {
        episodeId, status: run.status, savedCount: count, toolErrors,
        elapsedSeconds: ((performance.now() - startTime) / 1000).toFixed(1),
      })
    } catch (err: any) {
      run.status = 'failed'
      run.finished_at = now()
      run.error = err?.message || 'Agent execution failed'
      logTaskError('Agent', 'storyboard_breaker(async)', { episodeId, error: err?.message })
    }
  })()

  return success(c, { started: true })
})

// GET /agent/storyboard_breaker/status?episode_id= — 查询拆分进度（含已保存分镜数）
app.get('/storyboard_breaker/status', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.query('episode_id'))
  if (episodeId) await getEpisodeOwned(episodeId, user)
  const run = episodeId ? breakerRuns.get(episodeId) : undefined
  if (!run) return success(c, { status: 'idle', storyboard_count: 0 })
  return success(c, { ...run, storyboard_count: await countEpisodeStoryboards(episodeId) })
})

// POST /agent/storyboard_breaker/retry — 重试失败的拆分：注入失败原因作为反馈
app.post('/storyboard_breaker/retry', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const episodeId = Number(body.episode_id)
  if (!episodeId || !body.drama_id) return badRequest(c, 'drama_id and episode_id are required')
  await getDramaOwned(Number(body.drama_id), user)
  const existing = breakerRuns.get(episodeId)
  if (existing?.status === 'running') return success(c, { already_running: true })
  if (!existing || existing.status !== 'failed') return badRequest(c, '没有失败的拆分任务可重试')

  const retryReason = existing.error || '未知错误'
  existing.status = 'running'
  existing.started_at = now()
  existing.finished_at = undefined
  existing.error = null
  const message = `【重试提示】上次拆分失败，失败原因：${retryReason}。请根据此失败原因优化拆分\n\n${body.message}`
  logTaskStart('Agent', 'storyboard_breaker(retry)', { dramaId: body.drama_id, episodeId, retryReason })

  void (async () => {
    const startTime = performance.now()
    try {
      const result = await withTiming(episodeId, Number(body.drama_id), 'storyboard_split', () =>
        executeAgentRun('storyboard_breaker', message, {
          episodeId,
          dramaId: Number(body.drama_id),
          model: body.model,
          configId: body.config_id,
          userId: user.id,
        }))
      const costMeta = await resolveTextConfigMeta(user.id, body.config_id)
      await recordTextUsageFromResult(result, costMeta, {
        userId: user.id, dramaId: Number(body.drama_id), episodeId, configId: costMeta?.configId, detail: 'storyboard_split',
      })
      const toolErrors = (result.toolResults || []).filter((tr: any) => /"error"\s*:\s*true/.test(normalizeToolResult(tr))).length
      const count = await countEpisodeStoryboards(episodeId)
      existing.finished_at = now()
      if (!count && toolErrors > 0) {
        existing.status = 'failed'
        existing.error = '分镜拆分失败：模型传参异常，请点击重新拆分重试'
      } else {
        existing.status = 'done'
      }
      logTaskSuccess('Agent', 'storyboard_breaker(retry)', {
        episodeId, status: existing.status, savedCount: count, toolErrors,
        elapsedSeconds: ((performance.now() - startTime) / 1000).toFixed(1),
      })
    } catch (err: any) {
      existing.status = 'failed'
      existing.finished_at = now()
      existing.error = err?.message || 'Agent execution failed'
      logTaskError('Agent', 'storyboard_breaker(retry)', { episodeId, error: err?.message })
    }
  })()

  return success(c, { started: true })
})

// ─── 剧本改写异步执行：同分镜拆分模式，POST run 即返回，status 轮询，retry 注入失败原因 ───
type RewriterRun = { status: 'running' | 'done' | 'failed'; started_at: string; finished_at?: string; error?: string | null }
const rewriterRuns = new Map<number, RewriterRun>()

// POST /agent/script_rewriter/run — 异步启动剧本改写（立即返回）
app.post('/script_rewriter/run', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const episodeId = Number(body.episode_id)
  if (!episodeId || !body.drama_id) return badRequest(c, 'drama_id and episode_id are required')
  await getDramaOwned(Number(body.drama_id), user)
  const existing = rewriterRuns.get(episodeId)
  if (existing?.status === 'running') return success(c, { already_running: true })

  const run: RewriterRun = { status: 'running', started_at: now(), error: null }
  rewriterRuns.set(episodeId, run)
  logTaskStart('Agent', 'script_rewriter(async)', { dramaId: body.drama_id, episodeId })

  void (async () => {
    const startTime = performance.now()
    try {
      const result = await withTiming(episodeId, Number(body.drama_id), 'script_rewrite', () =>
        executeAgentRun('script_rewriter', body.message || '请读取剧本并改写为格式化剧本，然后保存', {
          episodeId,
          dramaId: Number(body.drama_id),
          model: body.model,
          configId: body.config_id,
          userId: user.id,
        }))
      const costMeta = await resolveTextConfigMeta(user.id, body.config_id)
      await recordTextUsageFromResult(result, costMeta, {
        userId: user.id, dramaId: Number(body.drama_id), episodeId, configId: costMeta?.configId, detail: 'script_rewrite',
      })
      run.finished_at = now()
      const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
      if (!ep?.scriptContent) {
        run.status = 'failed'
        run.error = '剧本改写未产出结果，请检查 Agent 配置后重试'
      } else {
        run.status = 'done'
      }
      logTaskSuccess('Agent', 'script_rewriter(async)', {
        episodeId, status: run.status,
        elapsedSeconds: ((performance.now() - startTime) / 1000).toFixed(1),
      })
    } catch (err: any) {
      run.status = 'failed'
      run.finished_at = now()
      run.error = err?.message || 'Agent execution failed'
      logTaskError('Agent', 'script_rewriter(async)', { episodeId, error: err?.message })
    }
  })()

  return success(c, { started: true })
})

// GET /agent/script_rewriter/status?episode_id= — 查询改写进度
app.get('/script_rewriter/status', async (c) => {
  const user = c.get('user')
  const episodeId = Number(c.req.query('episode_id'))
  if (episodeId) await getEpisodeOwned(episodeId, user)
  const run = episodeId ? rewriterRuns.get(episodeId) : undefined
  if (!run) return success(c, { status: 'idle' })
  return success(c, run)
})

// POST /agent/script_rewriter/retry — 重试失败的改写：注入失败原因作为反馈
app.post('/script_rewriter/retry', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const episodeId = Number(body.episode_id)
  if (!episodeId || !body.drama_id) return badRequest(c, 'drama_id and episode_id are required')
  await getDramaOwned(Number(body.drama_id), user)
  const existing = rewriterRuns.get(episodeId)
  if (existing?.status === 'running') return success(c, { already_running: true })
  if (!existing || existing.status !== 'failed') return badRequest(c, '没有失败的改写任务可重试')

  const retryReason = existing.error || '未知错误'
  existing.status = 'running'
  existing.started_at = now()
  existing.finished_at = undefined
  existing.error = null
  const message = `【重试提示】上次改写失败，失败原因：${retryReason}。请根据此失败原因优化改写\n\n${body.message || '请读取剧本并改写为格式化剧本，然后保存'}`
  logTaskStart('Agent', 'script_rewriter(retry)', { dramaId: body.drama_id, episodeId, retryReason })

  void (async () => {
    const startTime = performance.now()
    try {
      const result = await withTiming(episodeId, Number(body.drama_id), 'script_rewrite', () =>
        executeAgentRun('script_rewriter', message, {
          episodeId,
          dramaId: Number(body.drama_id),
          model: body.model,
          configId: body.config_id,
          userId: user.id,
        }))
      const costMeta = await resolveTextConfigMeta(user.id, body.config_id)
      await recordTextUsageFromResult(result, costMeta, {
        userId: user.id, dramaId: Number(body.drama_id), episodeId, configId: costMeta?.configId, detail: 'script_rewrite',
      })
      existing.finished_at = now()
      const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
      if (!ep?.scriptContent) {
        existing.status = 'failed'
        existing.error = '剧本改写未产出结果，请检查 Agent 配置后重试'
      } else {
        existing.status = 'done'
      }
      logTaskSuccess('Agent', 'script_rewriter(retry)', {
        episodeId, status: existing.status,
        elapsedSeconds: ((performance.now() - startTime) / 1000).toFixed(1),
      })
    } catch (err: any) {
      existing.status = 'failed'
      existing.finished_at = now()
      existing.error = err?.message || 'Agent execution failed'
      logTaskError('Agent', 'script_rewriter(retry)', { episodeId, error: err?.message })
    }
  })()

  return success(c, { started: true })
})


export default app
