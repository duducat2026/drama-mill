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
 * 自动化生产编排器 — 门面（对外 API 与 import 路径不变）
 *
 * 预热 + 两阶段解耦并发执行 6 步流水线（不含自动视频拼接，拼接改手动触发），全部复用现有服务
 * 每步先按 DB 状态判定是否已完成（幂等，断点续跑安全）；执行前先校验上一步产出的素材/输入，
 * 缺失时自动回补执行对应上一步（仍幂等）；步骤间/轮询间隙检查暂停标志；
 * 启动预热：分镜拆分之前的步骤（剧本改写→资产提取）对所有集全量快速并行（默认 20），防止队列空等；
 * 前 5 步（剧本改写→资产图片）并行度由 PROD_PRE_VIDEO_CONCURRENCY 控制（默认 8），
 * 前置完成后立即释放窗口槽位移交视频阶段（不占窗口），视频生成步单独受 PROD_EPISODE_CONCURRENCY 限制（默认 3），
 * 视频生成不再阻塞后续集的前置工作，前置任务尽早铺满；各环节仍受文本/图片/视频全局槽位闸门兜底；
 * 多模型分流：视频提交时按上游负载在配置内多模型间选模（见 generation.ts pickLeastLoadedVideoModel）
 * 运行状态为进程内存态：重启后通过 resume 按 DB 状态推导剩余步骤续跑
 *
 * 实现模块：
 * - production-shared.ts  共享层：运行状态类型、runs 注册表、步骤定义、视频槽位信号量、DB helper、输入校验
 * - production-steps.ts   7 个步骤实现与步骤函数装配
 * - production-runner.ts  编排主循环（启动预热 + 两阶段解耦滑动窗口）与对外控制接口
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { getDramaPipelineSteps } from './pipeline-status.js'
import { getActiveRun, getDramaEpisodesLite } from './production-shared.js'

// ─── Re-export 全部对外 API（外部 import 路径不变） ───
export { PRODUCTION_STEPS, isPaused } from './production-shared.js'
export type { ProductionRun, ProductionStatus, StepKey, EpisodeRow } from './production-shared.js'
export { getEpisodeAssets } from './production-steps.js'
export {
  startProduction, pauseProduction, resumeProduction,
  getProductionRun, getDramaEpisodesLite,
} from './production-runner.js'

/** run 状态 + 每集步骤概要（供前端生产进度面板）；全部走轻量查询，不拉剧本/提示词大字段 */
export async function getProductionStatus(dramaId: number) {
  const run = getActiveRun(dramaId)
  const episodes = await getDramaEpisodesLite(dramaId)

  // 批量计算流水线步骤（8 次 DB 往返覆盖全部集，避免逐集 N+1）
  const stepsMap = await getDramaPipelineSteps(dramaId, episodes as any)

  // 每集正在生成的视频数：sys_task 中 video 且 processing/pending，按分镜归属到集（仅取推导所需列）
  const episodeIds = episodes.map(e => e.id)
  const [genTasks, sbs] = episodeIds.length ? await Promise.all([
    db.select({ storyboardId: schema.sysTask.storyboardId, status: schema.sysTask.status }).from(schema.sysTask).where(and(
      eq(schema.sysTask.type, 'video'),
      eq(schema.sysTask.dramaId, dramaId),
    )),
    db.select({ id: schema.storyboards.id, episodeId: schema.storyboards.episodeId }).from(schema.storyboards)
      .where(inArray(schema.storyboards.episodeId, episodeIds)),
  ]) : [[], []]
  const sbToEp = new Map(sbs.map(s => [s.id, s.episodeId]))
  const genByEp = new Map<number, number>()
  for (const t of genTasks) {
    if (t.status !== 'processing' && t.status !== 'pending') continue
    const epId = t.storyboardId ? sbToEp.get(t.storyboardId) : null
    if (!epId) continue
    genByEp.set(epId, (genByEp.get(epId) || 0) + 1)
  }

  const episodeSummaries = []
  for (const ep of episodes) {
    episodeSummaries.push({
      episode_id: ep.id,
      episode_number: ep.episodeNumber,
      title: ep.title,
      status: ep.status || 'draft',
      steps: stepsMap.get(ep.id) || null,
      videos_generating: genByEp.get(ep.id) || 0,
    })
  }
  return {
    status: run?.status || 'idle',
    current_episode_id: run?.current_episode_id ?? null,
    current_episode_number: run?.current_episode_number ?? null,
    current_step: run?.current_step ?? null,
    error: run?.error ?? null,
    started_at: run?.started_at ?? null,
    finished_at: run?.finished_at ?? null,
    episodes: episodeSummaries,
  }
}
