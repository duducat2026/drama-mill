<!--
  Drama Mill — AI 短剧自动化生产平台 (https://github.com/duducat2026/drama-mill)
  Copyright (C) 2026 Drama Mill <52859273@qq.com>
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.
-->

<template>
  <!-- 极简生成测试弹层：文本直接展示结果；图片/视频轮询任务并预览产物 -->
  <div v-if="genTest.open" class="overlay" @click.self="closeGenerateTest">
    <div class="dialog gen-test-dialog">
      <div class="dialog-head">
        <div>
          <div class="dialog-title">{{ serviceMeta[genTest.serviceType]?.label || '' }}生成测试</div>
          <div class="dialog-sub mono">{{ genTest.model || '—' }}</div>
        </div>
        <span :class="['tag ml-auto', genTestStatusTag.class]">{{ genTestStatusTag.text }}</span>
      </div>
      <div class="dialog-body gen-test-body">
        <p class="gen-test-cost">这是一次真实的模型调用，会按实际用量计价。</p>

        <div v-if="genTest.busy" class="gen-test-pending">
          <Loader2 :size="18" class="animate-spin" />
          <span>{{ genTest.serviceType === 'text' ? '正在请求模型…' : '任务已提交，正在生成并等待产物落盘…（视频可能需要几分钟）' }}</span>
        </div>

        <div v-else-if="genTest.error" class="gen-test-error">
          <div class="gen-test-error-head">
            <AlertTriangle :size="15" />
            <div class="gen-test-error-summary">{{ genTest.error }}</div>
          </div>
          <p v-if="genTestErrInfo?.hint" class="gen-test-error-hint">{{ genTestErrInfo.hint }}</p>
          <dl v-if="genTestFacts.length" class="gen-test-facts">
            <div v-for="f in genTestFacts" :key="f.label" class="gen-test-fact">
              <dt>{{ f.label }}</dt>
              <dd class="mono">{{ f.value }}</dd>
            </div>
          </dl>
          <div v-if="genTestErrInfo?.raw" class="gen-test-raw">
            <div class="gen-test-raw-head">
              <span>上游原始返回</span>
              <button type="button" class="gen-test-raw-copy" @click="copyText(genTestErrInfo.raw, '原始返回已复制')">复制</button>
            </div>
            <pre class="gen-test-raw-body">{{ genTestErrInfo.raw }}</pre>
          </div>
          <p v-if="genTest.detail?.loading" class="gen-test-meta">正在拉取失败详情…</p>
        </div>

        <div v-else-if="genTest.serviceType === 'text'" class="gen-test-text">
          <div class="gen-test-text-body" :class="{ 'is-empty': !genTest.text }">{{ genTest.text || '（正文为空）' }}</div>
          <p v-if="genTest.note" class="gen-test-note">{{ genTest.note }}</p>
          <div class="gen-test-meta mono">耗时 {{ (genTest.elapsed / 1000).toFixed(1) }}s</div>
        </div>

        <div v-else-if="genTest.serviceType === 'image'" class="gen-test-media">
          <img :src="genTest.mediaUrl" alt="生成测试结果" @error="genTest.error = '图片加载失败'" />
        </div>

        <div v-else-if="genTest.serviceType === 'video'" class="gen-test-media">
          <video :src="genTest.mediaUrl" controls autoplay muted playsinline />
        </div>
      </div>
      <div class="dialog-foot">
        <button v-if="!genTest.busy && (genTest.text || genTest.mediaUrl)" type="button" class="btn btn-ghost" @click="copyGenResult">
          {{ genTest.serviceType === 'text' ? '复制文本' : '复制地址' }}
        </button>
        <button v-if="!genTest.busy && genTest.error" type="button" class="btn btn-ghost" @click="copyGenDiagnosis">
          复制诊断信息
        </button>
        <!-- 测试任务在后台永不自动重提，换好配置后由这里手动再发一次 -->
        <button v-if="!genTest.busy && genTest.error" type="button" class="btn" @click="retestGenerate">
          重新测试
        </button>
        <button type="button" class="btn btn-primary ml-auto" @click="closeGenerateTest">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Loader2, AlertTriangle } from 'lucide-vue-next'

const {
  genTest, genTestStatusTag, genTestErrInfo, genTestFacts,
  closeGenerateTest, copyGenDiagnosis, copyGenResult, retestGenerate,
  serviceMeta, copyText,
} = inject('settings-ctx')
</script>

<style scoped src="~/assets/styles/settings.css"></style>
