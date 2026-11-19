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

// 阿里云百炼 Token Plan（token-plan.cn-beijing.maas.aliyuncs.com）接入 — 行为 + 结构测试
// 套餐只开放文本与视频（图片端点仅支持同步、异步 text2image 实测 403，生图仍走按量付费 dashscope）
// 端点契约来自官方文档与实测：文本 /compatible-mode/v1/chat/completions（OpenAI 兼容），
// 视频 /api/v1/services/aigc/video-generation/video-synthesis + X-DashScope-Async，轮询 /api/v1/tasks/{id}
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readAiConfigRouteSources } from './helpers/aiconfig-route-sources.mjs'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readFailureDetailSources } from './helpers/failure-detail-sources.mjs'

const { TokenPlanVideoAdapter, tokenPlanRoot } =
  await import('../src/services/adapters/token-plan.js')
const { getImageAdapter, getVideoAdapter } = await import('../src/services/adapters/registry.js')

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const SITE = 'https://token-plan.cn-beijing.maas.aliyuncs.com'
// 文档给的 Base URL 是文本用的那条，用户往往两类配置都粘它——归一后视频仍要落到站点根
const COMPAT = `${SITE}/compatible-mode/v1`
const cfg = { provider: 'token-plan', baseUrl: SITE, apiKey: 'sk-sp-test', model: 'wan3.0-video', models: [] }

const vidAdapter = new TokenPlanVideoAdapter()

test('站点根归一：剥掉文本用的 /compatible-mode/v1 与 /api/v1，避免拼出双前缀 404', () => {
  assert.equal(tokenPlanRoot(SITE), SITE)
  assert.equal(tokenPlanRoot(`${SITE}/`), SITE)
  assert.equal(tokenPlanRoot(COMPAT), SITE)
  assert.equal(tokenPlanRoot(`${SITE}/api/v1`), SITE)
  // 视频适配器拿到的是文本 Base URL 也照样拼对
  const req = vidAdapter.buildGenerateRequest({ ...cfg, baseUrl: COMPAT }, { model: 'wan3.0-video', prompt: 'p' })
  assert.equal(req.url, `${SITE}/api/v1/services/aigc/video-generation/video-synthesis`)
})

test('套餐图片适配器已下线：不再导出 TokenPlanImageAdapter，但站点根归一保留', async () => {
  const mod = await import('../src/services/adapters/token-plan.js')
  assert.equal(mod.TokenPlanImageAdapter, undefined)
  assert.equal(typeof mod.TokenPlanVideoAdapter, 'function')
  // tokenPlanRoot 不能跟着图片适配器一起删：视频端点与文本 Base URL 差一层 /compatible-mode/v1
  assert.equal(typeof mod.tokenPlanRoot, 'function')
  assert.equal(mod.tokenPlanRoot(COMPAT), SITE)
})

test('token-plan 视频：wan3.0 走 media/ratio/resolution/audio，happyhorse 按后缀裁剪素材', () => {
  const wan3 = vidAdapter.buildGenerateRequest({ ...cfg, model: 'wan3.0-video' }, {
    model: 'wan3.0-video', prompt: '小猫缓缓转头', aspectRatio: '16:9', resolution: '720p', duration: 5,
    firstFrameUrl: 'https://cdn/first.png',
  })
  assert.equal(wan3.url, `${SITE}/api/v1/services/aigc/video-generation/video-synthesis`)
  assert.equal(wan3.headers['X-DashScope-Async'], 'enable')
  assert.deepEqual(wan3.body.input.media, [{ type: 'first_frame', url: 'https://cdn/first.png' }])
  assert.equal(wan3.body.parameters.resolution, '720P')
  assert.equal(wan3.body.parameters.ratio, '16:9')
  assert.equal(wan3.body.parameters.duration, 5)
  assert.equal(wan3.body.parameters.audio, true)

  // t2v/i2v/r2v 素材要求互斥：t2v 不传 media，i2v 只吃首帧且无 ratio，r2v 只吃参考图
  assert.equal(vidAdapter.buildGenerateRequest({ ...cfg, model: 'happyhorse-1.1-t2v' }, { model: 'happyhorse-1.1-t2v', prompt: 'p' }).body.input.media, undefined)
  const i2v = vidAdapter.buildGenerateRequest({ ...cfg, model: 'happyhorse-1.1-i2v' }, {
    model: 'happyhorse-1.1-i2v', prompt: 'p', firstFrameUrl: 'https://cdn/first.png', duration: 5,
  })
  assert.deepEqual(i2v.body.input.media, [{ type: 'first_frame', url: 'https://cdn/first.png' }])
  assert.equal(i2v.body.parameters.ratio, undefined)
  assert.equal(i2v.body.parameters.watermark, false)
  // happyhorse 时长下限 3 秒，2 秒请求要钳到 3
  assert.equal(vidAdapter.buildGenerateRequest({ ...cfg, model: 'happyhorse-1.1-t2v' }, { model: 'happyhorse-1.1-t2v', prompt: 'p', duration: 2 }).body.parameters.duration, 3)
  assert.throws(() => vidAdapter.buildGenerateRequest({ ...cfg, model: 'happyhorse-1.1-i2v' }, { model: 'happyhorse-1.1-i2v', prompt: 'p' }), /首帧图/)
  assert.equal(vidAdapter.buildPollRequest(cfg, 'tp-abc123').url, `${SITE}/api/v1/tasks/tp-abc123`)
})

test('白名单/文本端点/注册表：文本与视频认 token-plan，图片不开放', () => {
  const ai = read('src/services/ai.ts')
  assert.match(ai, /text: \[[^\]]*'token-plan'/)
  assert.match(ai, /video: \[[^\]]*'token-plan'/)
  // 图片不开放：套餐图片端点只支持同步，生图仍走按量付费 dashscope
  assert.doesNotMatch(ai, /image: \[[^\]]*'token-plan'/)
  // 文本端点补 /compatible-mode/v1（填站点根也自动补全，已含则不重复叠加）
  assert.match(ai, /if \(provider === 'token-plan'\) \{\n\s*return joinProviderUrl\(config\.baseUrl, '\/compatible-mode\/v1', ''\)/)
  const registry = read('src/services/adapters/registry.ts')
  assert.match(registry, /'token-plan': new TokenPlanVideoAdapter\(\)/)
  assert.doesNotMatch(registry, /TokenPlanImageAdapter/)
  assert.ok(getVideoAdapter('token-plan') instanceof TokenPlanVideoAdapter)
  assert.equal(getVideoAdapter('token-plan').provider, 'token-plan')
  // 图片侧 fail-closed：绕过白名单直接取适配器也必须拒，不会默默落到 dashscope
  assert.throws(() => getImageAdapter('token-plan'), /Unsupported image provider: token-plan/)
})

test('连通探针：文本 GET /compatible-mode/v1/models、视频空体打站点根 /api/v1，image 不进套餐分支', () => {
  const route = readAiConfigRouteSources(root)
  assert.match(route, /if \(p === 'dashscope' \|\| \(p === 'token-plan' && serviceType !== 'image'\)\)/)
  assert.match(route, /const textBase = p === 'token-plan' \? joinProviderUrl\(baseUrl, '\/compatible-mode\/v1', ''\) : baseUrl/)
  assert.match(route, /const apiBase = p === 'token-plan' \? tokenPlanRoot\(baseUrl\) : baseUrl/)
  assert.match(route, /url: joinProviderUrl\(textBase, '', '\/models'\)/)
  assert.match(route, /url: joinProviderUrl\(apiBase, '\/api\/v1', '\/services\/aigc\/video-generation\/video-synthesis'\)/)
  assert.match(route, /import \{ tokenPlanRoot \} from '\.\.\/services\/adapters\/token-plan\.js'/)
})

test('视频选模只做素材兼容过滤；水位闸门不对套餐生效（无中央在途查询接口）', () => {
  const gen = readGenerationSources(root)
  assert.match(gen, /const MEDIA_FILTER_ONLY_PROVIDERS = \['model-router', 'token-plan'\]/)
  assert.match(gen, /if \(config\.provider !== 'dashscope' \|\| UPSTREAM_VIDEO_PENDING_WATERMARK <= 0\) return/)
})

test('失败诊断给出套餐 Key / Base URL 隔离提示，且不再给图片端点', () => {
  const detail = readFailureDetailSources(root)
  assert.match(detail, /if \(p === 'token-plan'\)/)
  assert.match(detail, /套餐 Key 以 sk-sp- 开头/)
  assert.match(detail, /404 Model not exist/)
  assert.doesNotMatch(detail, /图片走 \{站点根\}\/api\/v1\/services\/aigc\/multimodal-generation/)
})
