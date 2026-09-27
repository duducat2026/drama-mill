<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->

<template>
  <div class="settings-scroll ai-settings-scroll">
    <div class="settings-head">
      <h2 class="settings-title">AI 服务配置</h2>
      <p class="settings-desc">按服务类型管理模型与密钥。添加或编辑配置将在独立页面中进行。</p>
    </div>
    <section class="card ai-call-panel" :class="{ 'is-off': !aiCallEnabled }">
      <div class="ai-call-icon">
        <Power :size="16" :stroke-width="1.8" />
      </div>
      <div class="ai-call-body">
        <div class="ai-call-title">模型调用总开关</div>
        <div class="ai-call-desc">
          {{ aiCallEnabled
            ? '开启中：文本、图片、视频生成均可正常发起。'
            : '已关闭：所有模型调用提交都会被拒绝，用于暂停消耗额度；正在生成中的任务不受影响。' }}
        </div>
      </div>
      <span :class="['tag', aiCallEnabled ? 'tag-success' : 'tag-warning']">{{ aiCallEnabled ? '已开启' : '已关闭' }}</span>
      <label class="config-switch" title="关闭后本人全部 AI 调用将被服务端拦截">
        <input ref="aiCallSwitchEl" type="checkbox" class="sr-only" :checked="aiCallEnabled" :disabled="aiCallSubmitting" @change="onAiCallToggle">
        <span class="switch" :class="{ on: aiCallEnabled }"></span>
      </label>
    </section>
    <div class="service-tabs" role="tablist" aria-label="AI 服务类型">
      <button
        v-for="st in serviceTypes" :id="`service-tab-${st.type}`" :key="st.type"
        type="button" role="tab" :class="['service-tab', { active: serviceTab === st.type }]"
        :aria-selected="serviceTab === st.type" :aria-controls="`service-panel-${st.type}`"
        :tabindex="serviceTab === st.type ? 0 : -1"
        @click="selectServiceTab(st.type)" @keydown="onServiceTabKeydown($event, st.type)"
      >
        <component :is="serviceIcons[st.type]" :size="16" />
        {{ st.label }}
        <span class="service-tab-count">{{ byType(st.type).length }}</span>
      </button>
    </div>
    <div class="sections">
      <section v-for="st in activeServiceTypes" :id="`service-panel-${st.type}`" :key="st.type" class="card svc-group ai-svc-group" role="tabpanel" :aria-labelledby="`service-tab-${st.type}`" tabindex="0">
        <div class="svc-group-head">
          <div class="svc-group-heading">
            <span class="svc-group-title">{{ st.label }}</span>
            <div class="svc-group-sub">{{ serviceMeta[st.type].desc }}</div>
          </div>
          <span v-if="countActive(st.type)" class="tag tag-accent">{{ countActive(st.type) }} 已启用</span>
          <button class="btn btn-primary btn-sm ml-auto" @click="startAddCfg(st.type)"><Plus :size="13" /> 添加{{ st.label }}服务</button>
        </div>
        <div v-for="c in byType(st.type)" :key="c.id" class="config-row">
          <div class="provider-badge" :data-provider="c.provider">{{ c.provider.slice(0, 1).toUpperCase() }}</div>
          <div class="config-main">
            <div class="config-line">
              <span class="config-name">{{ c.name || `${c.provider}-${c.service_type}` }}</span>
              <span :class="['tag', c.api_key ? 'tag-success' : 'tag-error']">{{ c.api_key ? '已配置' : '无密钥' }}</span>
              <span v-if="!c.is_active" class="tag">已停用</span>
            </div>
            <div class="config-models">
              <button
                v-for="m in c.model" :key="m" type="button"
                :class="['cfg-model-chip mono', { 'is-default': isDefaultModel(st.type, c, m) }]"
                :title="isDefaultModel(st.type, c, m) ? '当前默认模型' : '设为该类型默认模型'"
                @click="setDefaultModel(st.type, c, m)"
              >
                <Star v-if="isDefaultModel(st.type, c, m)" :size="9" class="cfg-model-star" />
                {{ m }}
              </button>
            </div>
            <div class="config-sub mono truncate">
              {{ c.base_url || '未设置 Base URL' }}
              <!-- 行内只给掩码尾号：多份配置的 Key 一眼可辨，明文仍须进弹窗点眼睛 -->
              <span v-if="c.api_key" class="cfg-key" title="密钥尾号，要看完整值请进入编辑页面点右侧眼睛">· {{ maskKey(c.api_key) }}</span>
            </div>
          </div>
          <div class="config-actions">
            <button
              class="btn btn-ghost btn-sm gen-test-btn"
              :disabled="!c.is_active || genTest.busy"
              :title="c.is_active ? `用该${serviceMeta[st.type].label}配置发起一次最小生成测试（真实调用模型，可能产生费用）` : '启用后才能发起生成测试'"
              @click="runGenerateTest(c)"
            >
              <Loader2 v-if="genTest.busy && genTest.configId === c.id" :size="12" class="animate-spin" />
              <span v-else>生成测试</span>
            </button>
            <button v-if="st.type === 'text'" class="btn btn-ghost btn-sm" @click="testExistingCfg(c)">连通</button>
            <label class="config-switch">
              <input type="checkbox" class="sr-only" :aria-label="`启用${c.name || st.label}配置`" :checked="c.is_active" @change="toggleCfg(c)">
              <span class="switch" :class="{ on: c.is_active }"></span>
            </label>
            <button class="btn btn-ghost btn-sm" @click="startEditCfg(c)"><Pencil :size="13" /> 编辑</button>
            <button class="btn btn-danger btn-icon btn-sm" :aria-label="`删除${c.name || st.label}配置`" @click="delCfg(c.id)"><Trash2 :size="13" /></button>
          </div>
        </div>
        <div v-if="cfgListLoading" class="config-empty" role="status">正在加载配置…</div>
        <div v-else-if="cfgListError" class="config-empty" role="alert">
          <p>{{ cfgListError }}</p>
          <button class="btn btn-sm" @click="loadCfgs">重新加载</button>
        </div>
        <div v-else-if="!byType(st.type).length" class="service-empty">
          <component :is="serviceIcons[st.type]" :size="26" />
          <h3>暂无{{ st.label }}服务</h3>
          <p>添加一份配置，使用推荐模板填写服务商、地址和模型。</p>
          <button class="btn btn-primary btn-sm" @click="startAddCfg(st.type)"><Plus :size="13" /> 添加{{ st.label }}服务</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { Plus, Pencil, Trash2, Loader2, Star, Power } from 'lucide-vue-next'

const {
  aiCallEnabled, aiCallSubmitting, aiCallSwitchEl, onAiCallToggle,
  serviceTypes, serviceIcons, serviceTab, selectServiceTab, onServiceTabKeydown,
  activeServiceTypes, serviceMeta, byType, countActive, maskKey,
  isDefaultModel, setDefaultModel, startAddCfg, startEditCfg, toggleCfg, delCfg,
  cfgListLoading, cfgListError, loadCfgs, genTest, runGenerateTest, testExistingCfg,
} = inject('settings-ctx')
</script>

<style scoped src="~/assets/styles/settings.css"></style>
