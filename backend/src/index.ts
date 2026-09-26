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

// Middleware
app.use('*', cors({
  origin: ['http://localhost:3013', 'http://localhost:5679'],
  credentials: true,
}))
app.use('*', requestLogger)
// 错误处理必须注册为 onError 钩子：api 子应用内的异常不会传播到父应用中间件，
// 且 app / api 需各自接管（子应用异常由子应用自己的 onError 处理）
app.onError(errorHandler)

// Health check
app.get('/api/v1/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// API routes
const api = new Hono()
api.onError(errorHandler)
api.use('*', authMiddleware)
api.use('*', auditMiddleware)
api.route('/auth', auth)
// 素材子路由先注册：/:id/assets-status 等具体路径需先于门面 /:id 通配路由匹配
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

// Serve static files (storage)
// 自定义解析中间件：按分类前缀（images/videos/merged/uploads）映射到各自配置目录，
// 目录可在项目目录之外；相对路径格式 static/xxx/... 不变，前端零改动。
// 生成的图片/视频按 uuid 命名、内容不变，标记为 immutable 让浏览器长缓存；保持免登录避免破坏 img/video 标签加载
app.get('/static/*', async (c) => {
  const resolved = resolveStaticFile(c.req.path)
  if (!resolved) return c.notFound()
  c.header('Content-Type', resolved.contentType)
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  return c.body(fs.createReadStream(resolved.abs) as any)
})

// Serve frontend (production build)
// 根路径用预渲染首页 index.html（含 SSR 数据 path="/");
// 其余未匹配路径用 200.html（SPA fallback，serverRendered=false，无 path 字段），
// 避免客户端水合时因 SSR path 不匹配而跳回首页
const distPath = path.join(projectRoot, 'frontend', 'dist')
app.use('*', serveStatic({ root: distPath }))
app.get('/', serveStatic({ root: distPath, path: 'index.html' }))
app.get('*', serveStatic({ root: distPath, path: '200.html' }))

const port = Number(process.env.PORT || 5679)
console.log(`🚀 Drama Mill TS server on http://localhost:${port}`)

// 进程重启后内存中的执行/轮询线程全部丢失，但任务已落库：
// 启动时恢复 processing 任务（有上游 task_id 的继续轮询，其余重新执行），提交不因重启作废
// DISABLE_TASK_RESUME=true 时跳过全部启动恢复与自动重提看门狗（云端冻结期用，避免重启触发续跑消耗额度）
const taskResumeDisabled = /^(1|true|yes)$/i.test(process.env.DISABLE_TASK_RESUME || '')
if (taskResumeDisabled) {
  console.warn('[startup] DISABLE_TASK_RESUME=true：跳过任务恢复/批次续跑/资产巡检/失败重提看门狗')
} else {
  resumeInterruptedTasks().catch(err => console.error('恢复中断任务失败:', err?.message))
  // 批量生产编排持久化在 DB：续跑重启前处于 running 的批次（各环节幂等，断点续跑）
  resumeRunningBatches().catch(err => console.error('恢复批量生产失败:', err?.message))
  // 资产图片巡检看门狗：定期为生产中/中断项目的缺图资产重提图片任务（默认 20 分钟一轮）
  startAssetWatchdog()
  // 生成任务失败自动恢复：超时视频任务判失败 + 失败任务自动重提（默认 5 分钟一轮）
  startTaskRecoveryWatchdog()
}

serve({ fetch: app.fetch, port })
