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

// Model Router 网关（model-router.edu-aliyun.com）接入 — 行为 + 结构测试
// 端点契约来自官方手册正文与实测：文本 /v1/chat/completions（OpenAI 兼容），
// 图片 /v1/images/generations、视频 /v1/videos/generations + X-MR-Async（DashScope 兼容体），轮询 /v1/tasks/{id}
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationSources } from './helpers/generation-sources.mjs'
import { readAiConfigRouteSources } from './helpers/aiconfig-route-sources.mjs'
import { readDashScopeSources } from './helpers/dashscope-sources.mjs'
import { readFailureDetailSources } from './helpers/failure-detail-sources.mjs'

const { ModelRouterImageAdapter, ModelRouterVideoAdapter } =
  await import('../src/services/adapters/model-router.js')
const { DashScopeImageAdapter, DashScopeVideoAdapter } =
  await import('../src/services/adapters/dashscope.js')

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const BASE = 'https://model-router.edu-aliyun.com'
const cfg = { provider: 'model-router', baseUrl: BASE, apiKey: 'sk-test', model: 'qwen/wan2.7-image', models: [] }
const nativeCfg = { provider: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com', apiKey: 'sk-test', model: 'wan2.7-image', models: [] }

const imgAdapter = new ModelRouterImageAdapter()
const vidAdapter = new ModelRouterVideoAdapter()

test('model-router 图片：打 /v1/images/generations，请求体保持 DashScope 形状', () => {
  const req = imgAdapter.buildGenerateRequest(cfg, {
    model: 'qwen/wan2.7-image', prompt: '一只戴宇航头盔的橘猫', size: '1024x1024',
  })
  assert.equal(req.url, `${BASE}/v1/images/generations`)
  assert.equal(req.method, 'POST')
  assert.equal(req.headers.Authorization, 'Bearer sk-test')
  assert.equal(req.body.model, 'qwen/wan2.7-image')
  assert.deepEqual(req.body.input.messages[0].content, [{ text: '一只戴宇航头盔的橘猫' }])
  // 项目侧 1024x1024 必须归成网关接受的 1024*1024
  assert.equal(req.body.parameters.size, '1024*1024')
  assert.equal(imgAdapter.buildPollRequest(cfg, 'qwen_abc123').url, `${BASE}/v1/tasks/qwen_abc123`)
})

test('model-router 视频：/v1/videos/generations + X-MR-Async，且不带百炼原生异步头', () => {
  const req = vidAdapter.buildGenerateRequest(cfg, {
    model: 'qwen/wan3.0-video', prompt: '小猫缓缓转头', aspectRatio: '16:9', duration: 5,
  })
  assert.equal(req.url, `${BASE}/v1/videos/generations`)
  assert.equal(req.headers['X-MR-Async'], 'true')
  assert.equal(req.headers['X-DashScope-Async'], undefined)
  assert.equal(req.body.input.prompt, '小猫缓缓转头')
  assert.equal(req.body.parameters.ratio, '16:9')
  assert.equal(vidAdapter.buildPollRequest(cfg, 'qwen_abc123').url, `${BASE}/v1/tasks/qwen_abc123`)
})

test('模型族判定兼容 symbol/ 前缀：带前缀仍走 wan3.0 与 happyhorse-i2v 正确分支', () => {
  // 前缀不剥离时 qwen/wan3.0-video 会被当成旧格式（img_url），qwen/happyhorse-1.1-i2v 会漏掉首帧校验
  const wan3 = vidAdapter.buildGenerateRequest(cfg, { model: 'qwen/wan3.0-video-prime', prompt: 'p', resolution: '1080p' })
  assert.equal(wan3.body.parameters.resolution, '1080P')
  const i2v = vidAdapter.buildGenerateRequest(cfg, {
    model: 'qwen/happyhorse-1.1-i2v', prompt: 'p', firstFrameUrl: 'https://cdn/x.png',
  })
  assert.deepEqual(i2v.body.input.media, [{ type: 'first_frame', url: 'https://cdn/x.png' }])
  // i2v 输出画幅跟随首帧，不能带 ratio
  assert.equal(i2v.body.parameters.ratio, undefined)
  assert.match(vidAdapter.buildGenerateRequest(cfg, { model: 'qwen/happyhorse-1.1-t2v', prompt: 'p' }).url, /videos\/generations$/)
})

test('继承不改变原生百炼行为：dashscope 仍用 /api/v1/services/aigc 端点与原生异步头', () => {
  const img = new DashScopeImageAdapter().buildGenerateRequest(nativeCfg, { model: 'wan2.7-image', prompt: 'p' })
  assert.equal(img.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
  const vid = new DashScopeVideoAdapter().buildGenerateRequest({ ...nativeCfg, model: 'wan3.0-video' }, { model: 'wan3.0-video', prompt: 'p' })
  assert.equal(vid.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis')
  assert.equal(vid.headers['X-DashScope-Async'], 'enable')
  assert.equal(vid.headers['X-MR-Async'], undefined)
})

test('白名单/文本端点/注册表都认 model-router', () => {
  const ai = read('src/services/ai.ts')
  assert.match(ai, /text: \[[^\]]*'model-router'\]/)
  assert.match(ai, /image: \[[^\]]*'model-router'\]/)
  assert.match(ai, /video: \[[^\]]*'model-router'\]/)
  assert.match(ai, /if \(provider === 'model-router'\) \{\n\s*return joinProviderUrl\(config\.baseUrl, '\/v1', ''\)/)
  const registry = read('src/services/adapters/registry.ts')
  assert.match(registry, /'model-router': new ModelRouterImageAdapter\(\)/)
  assert.match(registry, /'model-router': new ModelRouterVideoAdapter\(\)/)
})

test('网关图片无独立异步端点：跳过 text2image 试探（否则每次提交前先吃一个 404）', () => {
  const src = read('src/services/adapters/model-router.ts')
  assert.match(src, /protected override supportsAsyncImage\(\): boolean \{\n\s*return false\n\s*\}/)
  const dash = readDashScopeSources(root)
  // 父类改为受钩子控制，且异步端点/轮询/请求头均可覆写
  assert.match(dash, /if \(this\.supportsAsyncImage\(\) && !refImages\.length/)
  assert.match(dash, /protected asyncSubmitUrl\(config: AIConfig\)/)
  assert.match(dash, /protected pollUrl\(config: AIConfig, taskId: string\)/)
  assert.match(dash, /headers: this\.submitHeaders\(config\.apiKey\)/)
})

test('探测改打真实生成端点：不再依赖网关未必实现的 GET /v1/models', () => {
  const route = readAiConfigRouteSources(root)
  const probe = route.slice(route.indexOf('function buildProbe'), route.indexOf('// GET /ai-configs'))
  assert.doesNotMatch(probe, /GET'?,\s*\n\s*url: joinProviderUrl\(baseUrl, '\/v1', '\/models'\)/)
  assert.match(probe, /if \(p === 'openai' \|\| p === 'model-router'\)/)
  assert.match(probe, /headers\['X-MR-Async'\] = 'true'/)
  // 空体探测回 400「invalid model format」属于鉴权通过、端点正确，要判连通且判 ok
  assert.match(route, /missing from request\|invalid model format\|invalid_request_error/i)
})

test('视频选模对 model-router 只做素材兼容过滤（网关没有百炼在途查询接口）', () => {
  const gen = readGenerationSources(root)
  assert.match(gen, /if \(config\.provider !== 'dashscope' && config\.provider !== 'model-router'\) return fallback/)
  const mrBlock = gen.slice(gen.indexOf("if (config.provider === 'model-router') {"), gen.indexOf('const candidates = models'))
  assert.ok(mrBlock.length > 0)
  // 不探负载：不得在该分支里调用在途查询
  assert.doesNotMatch(mrBlock, /upstreamInflightCount/)
  assert.match(mrBlock, /compatible\.includes\(fallback\) \? fallback : compatible\[0\]/)
})

test('失败诊断带网关专属建议；文本测试输出上限不再掐死思考型模型', () => {
  const detail = readFailureDetailSources(root)
  assert.match(detail, /if \(p === 'model-router'\)/)
  assert.match(detail, /模型标识需带 symbol\/ 前缀/)
  const test = read('src/services/ai-test.ts')
  assert.match(test, /export const TEXT_TEST_MAX_TOKENS = 256/)
  assert.match(test, /createTextModel\(config, config\.model, TEXT_TEST_MAX_TOKENS\)/)
  assert.match(test, /empty_note:/)
  assert.match(test, /reasoning_content/)
})
