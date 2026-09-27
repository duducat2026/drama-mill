<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->

<template>
  <section class="cfg-editor" :aria-busy="cfgLoading">
    <header class="cfg-editor-head">
      <button type="button" class="btn btn-ghost" :disabled="cfgSaving" @click="backToConfigs"><ArrowLeft :size="16" /> 返回配置</button>
      <div class="cfg-editor-heading">
        <div class="cfg-editor-breadcrumb">设置中心 / AI 服务配置 / {{ serviceMeta[cfgServiceType].label }}</div>
        <h1 class="settings-title">{{ route.params.configId === 'new' ? '添加' : '编辑' }}{{ serviceMeta[cfgServiceType].label }}服务</h1>
      </div>
      <span class="tag tag-accent">{{ serviceMeta[cfgServiceType].label }}</span>
    </header>
    <div v-if="cfgLoading" class="cfg-editor-status" role="status"><Loader2 :size="20" class="animate-spin" /> 正在加载配置…</div>
    <div v-else-if="cfgLoadError" class="cfg-editor-status" role="alert">
      <AlertTriangle :size="22" />
      <p>{{ cfgLoadError }}</p>
      <button type="button" class="btn" @click="loadCfgEditor">重新加载</button>
    </div>
    <form v-else-if="cfgReady" class="cfg-editor-form" @submit.prevent="saveCfg">
      <div class="cfg-editor-scroll">
        <fieldset class="card cfg-editor-fields" :disabled="cfgSaving">
          <div class="cfg-presets field-wide">
            <h2 class="setup-title">服务商模板</h2>
            <p class="settings-desc">选择模板填入推荐的名称、Base URL 和模型，再填写自己的 API Key。</p>
            <div class="preset-picker">
              <button
                v-for="preset in presetsByType(cfgForm.service_type)"
                :key="`${cfgForm.service_type}-${preset.provider}`"
                type="button"
                :class="['preset-pill', { active: cfgForm.provider === preset.provider }]"
                :aria-pressed="cfgForm.provider === preset.provider"
                @click="applyProviderPreset(cfgForm.service_type, preset.provider)"
              >
                {{ preset.label }}
              </button>
            </div>
          </div>
          <label class="field">
            <span class="field-label">配置名称</span>
            <input v-model="cfgForm.name" class="input" placeholder="如 默认图像服务" />
          </label>
          <label class="field"><span class="field-label">服务商</span>
            <BaseSelect v-model="cfgForm.provider" :options="providerSelectOptions" :disabled="cfgSaving" placeholder="选择服务商" searchable />
          </label>
          <div class="field field-wide">
            <label for="cfg-api-key" class="field-label">API Key</label>
            <span class="input-affix">
              <input
                id="cfg-api-key" v-model="cfgForm.api_key" class="input affix-input mono"
                :type="apiKeyVisible ? 'text' : 'password'"
                placeholder="sk-..." autocomplete="off" spellcheck="false"
              />
              <button
                type="button" class="affix-btn" :title="apiKeyVisible ? '隐藏密钥' : '明文查看'"
                :aria-label="apiKeyVisible ? '隐藏密钥' : '明文查看密钥'" @click="apiKeyVisible = !apiKeyVisible"
              >
                <EyeOff v-if="apiKeyVisible" :size="14" />
                <Eye v-else :size="14" />
              </button>
              <button v-if="cfgForm.api_key" type="button" class="affix-btn" title="复制密钥" @click="copyText(cfgForm.api_key, 'API Key 已复制')">
                <Copy :size="14" />
              </button>
            </span>
            <span class="field-hint">配置只归属本人，其他用户在列表里看不到这条；点眼睛可明文核对已保存的值（前后空格、少一位都在这一步能看出来）。</span>
          </div>
          <label class="field field-wide"><span class="field-label">Base URL</span><input v-model="cfgForm.base_url" class="input mono" placeholder="https://..." />
            <span v-if="presetHint" class="field-hint">{{ presetHint }}</span>
          </label>
          <label class="field field-wide">
            <span class="field-label">模型（逗号分隔）</span>
            <textarea v-model="cfgForm.modelStr" class="textarea mono" rows="3" placeholder="model-name" spellcheck="false"></textarea>
            <span class="field-hint">多个模型用英文逗号分隔，第一个模型为此配置的默认模型。</span>
          </label>
          <label class="field">
            <span class="field-label">优先级</span>
            <input v-model.number="cfgForm.priority" class="input" type="number" min="0" max="999" />
            <span class="field-hint">数值越高越优先。工作台默认会优先使用同类型里优先级最高的启用配置。</span>
          </label>
          <label v-if="cfgForm.service_type === 'text'" class="field">
            <span class="field-label">Temperature <span class="dim">(留空跟随服务商默认)</span></span>
            <input v-model="cfgForm.temperature" class="input" type="number" step="0.1" min="0" max="2" placeholder="如 0.6" />
            <span class="field-hint">部分模型强制固定温度（如 kimi-k2 系只允许 0.6），报 invalid temperature 错误时在此填入对应值。</span>
          </label>
          <div v-if="cfgTestResult" class="test-result field-wide" role="status" :class="{ ok: cfgTestResult.reachable, bad: !cfgTestResult.reachable }">
            <div class="test-result-head">
              <span class="tag" :class="cfgTestResult.reachable ? 'tag-success' : 'tag-error'">{{ cfgTestResult.status || 'ERROR' }}</span>
              <span>{{ cfgTestResult.message }}</span>
            </div>
            <div class="mono test-result-url">{{ cfgTestResult.method }} {{ cfgTestResult.url }}</div>
            <div v-if="cfgTestResult.response_preview" class="mono test-result-preview">{{ cfgTestResult.response_preview }}</div>
          </div>
        </fieldset>
      </div>
      <footer class="cfg-editor-foot">
        <button type="button" class="btn btn-ghost test-draft-btn" :disabled="cfgTesting || cfgSaving" @click="testDraftCfg">
          <Loader2 v-if="cfgTesting" :size="12" class="animate-spin" />
          {{ cfgTesting ? '测试中…' : '测试配置' }}
        </button>
        <span class="cfg-save-hint">{{ cfgDirty ? '有未保存的更改' : '配置仅自己可见' }}</span>
        <button type="button" class="btn" :disabled="cfgSaving" @click="backToConfigs">取消</button>
        <button type="submit" class="btn btn-primary" :disabled="cfgSaving">
          <Loader2 v-if="cfgSaving" :size="14" class="animate-spin" />
          {{ cfgSaving ? '保存中…' : '保存配置' }}
        </button>
      </footer>
    </form>
  </section>
</template>

<script setup>
import { Loader2, AlertTriangle, Eye, EyeOff, Copy, ArrowLeft } from 'lucide-vue-next'
import BaseSelect from '~/components/BaseSelect.vue'

const {
  route, serviceMeta, cfgServiceType, providerSelectOptions, copyText,
  cfgLoading, cfgLoadError, cfgReady, cfgSaving, cfgDirty, cfgTesting, cfgTestResult,
  cfgForm, apiKeyVisible, presetsByType, applyProviderPreset, presetHint,
  loadCfgEditor, saveCfg, testDraftCfg, backToConfigs,
} = inject('settings-ctx')
</script>

<style scoped src="~/assets/styles/settings.css"></style>
