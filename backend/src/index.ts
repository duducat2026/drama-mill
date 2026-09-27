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
 * Hono 服务入口
 * 组装顺序：CORS → 请求日志 → onError；/api/v1 子应用再叠 auth + audit。
 * 静态素材走自定义分类解析；前端产物按 SPA fallback 兜底；启动时拉起任务恢复与看门狗。
 */
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import dramas from './routes/dramas.js'
import dramasAssets from './routes/dramas-assets.js'
import episodes from './routes/episodes.js'
import storyboards from './routes/storyboards.js'
import scenes from './routes/scenes.js'
import characters from './routes/characters.js'
import tasks from './routes/tasks.js'
import upload from './routes/upload.js'
import aiConfigs, { aiProviders } from './routes/aiConfigs.js'
import stylePresets from './routes/stylePresets.js'
import prompts from './routes/prompts.js'
import agent from './routes/agent.js'
import merge from './routes/merge.js'
import skills from './routes/skills.js'
import props from './routes/props.js'
import novels from './routes/novels.js'
import novelSplitTemplates from './routes/novel-split-templates.js'
import production from './routes/production.js'
import productionBatch from './routes/production-batch.js'
import costs from './routes/costs.js'
import admin from './routes/admin/index.js'
import auth from './routes/auth.js'
import { requestLogger, errorHandler } from './middleware/logger.js'
import { authMiddleware } from './middleware/auth.js'
import { auditMiddleware } from './middleware/audit.js'
import { resumeInterruptedTasks } from './services/generation.js'
import { resumeRunningBatches } from './services/production-batch.js'
import { startAssetWatchdog } from './services/asset-watchdog.js'
import { startTaskRecoveryWatchdog } from './services/task-recovery-watchdog.js'
import { resolveStaticFile } from './utils/storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const app = new Hono()

// 开发期 Nuxt dev server 与生产同域两个来源都放行，带 cookie
app.use('*', cors({
  origin: ['http://localhost:3013', 'http://localhost:5679'],
  credentials: true,
}))
app.use('*', requestLogger)
// 错误兜底必须走 onError 钩子而不是中间件：api 子应用内抛出的异常
// 不会向上传播到父应用中间件，父子两层各自挂 onError 才能都接住
app.onError(errorHandler)

// 健康检查（探活/部署脚本用，无需鉴权）
app.get('/api/v1/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// 业务 API 子应用：先鉴权再审计
const api = new Hono()
api.onError(errorHandler)
api.use('*', authMiddleware)
api.use('*', auditMiddleware)
api.route('/auth', auth)
// 素材子路由必须先注册：/dramas/:id/assets-status 这类具体路径要抢在门面 /dramas/:id 通配前匹配
api.route('/dramas', dramasAssets)
api.route('/dramas', dramas)
api.route('/episodes', episodes)
api.route('/storyboards', storyboards)
api.route('/scenes', scenes)
api.route('/characters', characters)
api.route('/tasks', tasks)
api.route('/upload', upload)
api.route('/ai-configs', aiConfigs)
api.route('/ai-providers', aiProviders)
api.route('/style-presets', stylePresets)
api.route('/prompts', prompts)
api.route('/agent', agent)
api.route('/merge', merge)
api.route('/skills', skills)
api.route('/props', props)
api.route('/novels', novels)
api.route('/novel-split-templates', novelSplitTemplates)
api.route('/production', production)
api.route('/production-batch', productionBatch)
api.route('/costs', costs)
api.route('/admin', admin)

app.route('/api/v1', api)

// 静态素材分发：images/videos/merged/uploads 四个分类各自可外置目录，
// 由 resolveStaticFile 按前缀映射；对外的相对路径 static/xxx/... 保持不变，前端零改动。
// 文件名带 uuid、内容不可变 → 打 immutable 长缓存；不挂鉴权，否则 <img>/<video> 标签加载失败
app.get('/static/*', async (c) => {
  const resolved = resolveStaticFile(c.req.path)
  if (!resolved) return c.notFound()
  c.header('Content-Type', resolved.contentType)
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  return c.body(fs.createReadStream(resolved.abs) as any)
})

// 前端生产构建产物（Nuxt static）：
// "/" 精确回 index.html（预渲染页，SSR 数据里带 path="/")；
// 其余路径回 200.html 做 SPA fallback（serverRendered=false，无 path 字段），
// 避免水合时 SSR path 与地址栏不符把用户弹回首页
const distPath = path.join(projectRoot, 'frontend', 'dist')
app.use('*', serveStatic({ root: distPath }))
app.get('/', serveStatic({ root: distPath, path: 'index.html' }))
app.get('*', serveStatic({ root: distPath, path: '200.html' }))

const port = Number(process.env.PORT || 5679)
console.log(`🚀 Drama Mill TS server on http://localhost:${port}`)

// 内存里的执行/轮询线程随进程死掉，但任务状态都在库里：
// 启动时把 processing 任务捞回来（有上游 task_id 的续轮询，没有的重跑），提交不因重启作废。
// DISABLE_TASK_RESUME=true 会跳过下面全部恢复与看门狗——云端额度冻结期用，防止重启续跑烧额度
if (/^(1|true|yes)$/i.test(process.env.DISABLE_TASK_RESUME || '')) {
  console.warn('[startup] DISABLE_TASK_RESUME=true：跳过任务恢复/批次续跑/资产巡检/失败重提看门狗')
} else {
  resumeInterruptedTasks().catch(err => console.error('恢复中断任务失败:', err?.message))
  // 批量生产编排落库持久化：重启前 running 的批次断点续跑（各环节幂等）
  resumeRunningBatches().catch(err => console.error('恢复批量生产失败:', err?.message))
  // 资产图片巡检：周期性为生产中/中断项目缺图的资产补提图片任务（默认 20 分钟一轮）
  startAssetWatchdog()
  // 失败自动恢复：超时视频任务判死 + 失败任务自动重提（默认 5 分钟一轮）
  startTaskRecoveryWatchdog()
}

serve({ fetch: app.fetch, port })
