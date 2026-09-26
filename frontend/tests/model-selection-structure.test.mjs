import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { episodeViewSource } from './helpers/episode-sources.mjs'
import { readUseApiSources } from './helpers/use-api-sources.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const page = episodeViewSource()
const useAgent = read('app/composables/useAgent.ts')
const useApi = readUseApiSources(root)

test('workbench offers model selectors for rewrite, image and video generation', () => {
  // 三个选择器（自定义 ModelSelect 弹窗组件，非原生 select）
  assert.match(page, /<ModelSelect/)
  assert.match(page, /v-model="chatModel"/)
  assert.match(page, /v-model="imageModel"/)
  assert.match(page, /v-model="videoModel"/)
  assert.doesNotMatch(page, /<select v-model="chatModel"/)
  // 选项汇总该类型全部启用配置的模型（去重、按优先级），API 返回的 model 可能已是数组
  assert.match(page, /function collectModelOptions\(cfgs\)/)
  assert.match(page, /if \(Array\.isArray\(raw\)\) return raw\.filter\(Boolean\)/)
  assert.match(page, /collectModelOptions\(textConfigs\.value\)/)
  assert.match(page, /collectModelOptions\(imageConfigs\.value\)/)
  assert.match(page, /collectModelOptions\(videoConfigs\.value\)/)
  assert.match(page, /aiConfigAPI\.list\('text'\)/)
})

test('model select dropdown is a custom designed popover', () => {
  const component = read('app/components/ModelSelect.vue')

  assert.match(component, /Teleport to="body"/)
  assert.match(component, /model-select-menu/)
  assert.match(component, /model-select-option/)
  assert.match(component, /Check :size="12"/)
  assert.match(component, /model-select-backdrop/)
  assert.match(component, /emit\('update:modelValue', model\)/)
  // 多配置时展示来源配置名
  assert.match(component, /showConfig/)
  assert.match(component, /opt-config/)
})

test('selected models are sent with rewrite, image and video generation requests', () => {
  // 选中模型时连同其所属配置一起调用（model 选项 key 形如 configId::modelName，需拆出裸模型名）
  assert.match(page, /function bareModelName\(key\)/)
  assert.match(page, /function ownerConfigId\(options, key\)/)
  // 改写（Agent）透传模型与配置
  assert.match(useAgent, /model: model \|\| undefined/)
  assert.match(useAgent, /config_id: configId \|\| undefined/)
  // 剧本改写已改为异步 fire-and-forget 模式，模型覆盖随 rewriterAPI.run 透传
  assert.match(page, /rewriterAPI\.run\(epId\.value, dramaId, undefined, chatModelOverride\(\), chatConfigId\(\)\)/)
  // 图片生成透传模型与配置
  assert.match(useApi, /generateImage: \(id: number, episodeId: number, model\?: string, configId\?: number, textModel\?: string, textConfigId\?: number\)/)
  // 文本模型覆盖随生图/提取请求透传（缺提示词时后端触发提示词 Agent）
  assert.match(useApi, /text_model: textModel \|\| undefined/)
  assert.match(useApi, /text_config_id: textConfigId \|\| undefined/)
  assert.match(useApi, /config_id: configId \|\| undefined/)
  assert.match(page, /characterAPI\.generateImage\(id, epId\.value, bareModelName\(imageModel\.value\) \|\| undefined, ownerConfigId\(imageModelOptions\.value, imageModel\.value\), chatModelOverride\(\), chatConfigId\(\)\)/)
  assert.match(page, /sceneAPI\.generateImage\(id, epId\.value, bareModelName\(imageModel\.value\) \|\| undefined, ownerConfigId\(imageModelOptions\.value, imageModel\.value\), chatModelOverride\(\), chatConfigId\(\)\)/)
  assert.match(page, /characterAPI\.batchImages\(ids, epId\.value, bareModelName\(imageModel\.value\) \|\| undefined, ownerConfigId\(imageModelOptions\.value, imageModel\.value\), chatModelOverride\(\), chatConfigId\(\)\)/)
  // 视频生成透传模型与配置
  assert.match(page, /model: bareModelName\(videoModel\.value\) \|\| undefined/)
  assert.match(page, /config_id: ownerConfigId\(videoModelOptions\.value, videoModel\.value\)/)
})

test('video model lock toggle sends no_balance to skip backend load balancing', () => {
  // 顶栏锁定开关（ModelSelect 旁）：开启后生成请求带 no_balance，后端提交时跳过多模型分流
  assert.match(page, /class="model-lock"/)
  assert.match(page, /const videoModelLock = ref\(false\)/)
  assert.match(page, /no_balance: videoModelLock\.value \|\| undefined/)
  // 开关状态持久化到 localStorage（默认关，刷新后保留）
  assert.match(page, /videoLock: 'drama-mill:model:video-lock'/)
  // 开关样式（激活态高亮）位于工作台样式表
  const css = read('app/assets/styles/episode.workbench.css')
  assert.match(css, /\.model-lock\.active/)
})
