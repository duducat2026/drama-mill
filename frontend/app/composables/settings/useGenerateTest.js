/*
 * settings.vue「极简生成测试」逻辑 composable（拆分超限文件）。
 * 文本：后端同步回传结果；图片/视频：提交一次性任务并轮询 /tasks/:id 预览产物。
 * 复用 useAiConfigs 暴露的 cfgs/copyText，并读取模型调用总开关（关闭时拒绝发起）。
 */
import { toast } from 'vue-sonner'
import { aiConfigAPI, taskAPI } from '~/composables/useApi'

// 后端对测试任务挂了有限墙钟，这里再加一道客户端上限，避免任务行异常停留时弹层无限轮询
const GEN_TEST_POLL_MAX_MS = 25 * 60_000

// 后端 diagnose 的 kind → 中文标签（标签位只放一词，完整结论在正文里）
const FAILURE_KIND_LABEL = {
  auth: '鉴权', not_found: '端点/模型', invalid_request: '参数', balance: '额度',
  rate_limit: '限流', moderation: '审核', network: '网络', timeout: '超时',
  upstream: '上游故障', empty: '无返回', unknown: '未识别',
}

export function useGenerateTest(cfgApi, aiCallEnabled) {
  const { cfgs, copyText } = cfgApi

  const genTest = reactive({ open: false, busy: false, configId: null, serviceType: '', model: '', text: '', elapsed: 0, mediaUrl: '', note: '', error: '', detail: null })
  let genTestTimer = null
  // 轮次令牌：关闭后重开/连点会换轮次，旧请求的回包不得改写新一轮弹层状态
  let genTestRound = 0
  function stopGenTestPoll() { if (genTestTimer) { clearTimeout(genTestTimer); genTestTimer = null } }
  function closeGenerateTest() { stopGenTestPoll(); genTestRound++; genTest.busy = false; genTest.detail = null; genTest.open = false }

  const genTestStatusTag = computed(() => {
    if (genTest.busy) return { class: 'tag-accent', text: '生成中' }
    if (genTest.error) return { class: 'tag-error', text: genTestKindLabel.value ? `失败 · ${genTestKindLabel.value}` : '失败' }
    return { class: 'tag-success', text: '成功' }
  })

  async function runGenerateTest(c) {
    if (genTest.busy) return
    if (!c.is_active) { toast.warning('请先启用该配置'); return }
    if (!aiCallEnabled.value) { toast.warning('模型调用总开关已关闭，无法发起生成测试'); return }
    stopGenTestPoll()
    const round = ++genTestRound
    Object.assign(genTest, {
      open: true, busy: true, configId: c.id, serviceType: c.service_type,
      model: (Array.isArray(c.model) ? c.model[0] : c.model) || '',
      text: '', elapsed: 0, mediaUrl: '', note: '', error: '', detail: null,
    })
    try {
      const res = await aiConfigAPI.generateTest(c.id)
      if (round !== genTestRound) return
      // 失败按 200 + ok:false 回传（附结构化诊断），不再走 HTTP 400
      if (res && res.ok === false) {
        genTest.busy = false
        genTest.detail = res
        genTest.error = res.error?.summary || '生成测试失败'
        return
      }
      if (res.service_type === 'text') {
        genTest.text = res.text || ''
        genTest.note = res.empty_note || ''
        genTest.elapsed = res.elapsed_ms || 0
        genTest.busy = false
      } else {
        pollGenTestTask(res.task_id, Date.now(), round)
      }
    } catch (e) {
      if (round !== genTestRound) return
      genTest.busy = false
      genTest.error = e.message || '生成测试失败'
      genTest.detail = { error: { hint: '测试请求没能发出或回包不符合预期，可重新发起一次；持续失败请检查后端日志。', raw: '' } }
    }
  }

  function pollGenTestTask(taskId, startedAt, round) {
    if (round !== genTestRound) return
    if (!taskId) { genTest.busy = false; genTest.error = '未拿到任务 id，无法查询结果'; return }
    // 客户端兜底上限：后端超时会把任务判失败，这里只防任务行长期停在 processing 时无限轮询
    if (Date.now() - startedAt > GEN_TEST_POLL_MAX_MS) {
      genTest.busy = false
      genTest.error = '上游长时间未返回结果，本次测试已结束等待'
      genTest.detail = { task_id: taskId, error: { hint: '可到工作台的任务列表继续观察该任务，或更换模型后重新测试。', raw: '' } }
      return
    }
    genTestTimer = setTimeout(async () => {
      try {
        const t = await taskAPI.get(taskId)
        if (round !== genTestRound) return
        if (t?.status === 'completed') {
          genTest.busy = false
          const p = t.localPath || t.resultUrl || ''
          genTest.mediaUrl = p && !/^(https?:|data:|blob:|\/)/.test(p) ? `/${p}` : p
          if (!genTest.mediaUrl) {
            genTest.error = '任务已完成但未返回可预览的产物'
            genTest.detail = { task_id: taskId, error: { hint: '上游回了成功却没带图片/视频地址，多为网关未按协议返回 data[].url。', raw: JSON.stringify(t).slice(0, 800) } }
          }
        } else if (t?.status === 'failed') {
          genTest.busy = false
          // 先落一行原始 errorMsg 兜底显示，再补拉诊断（状态码/错误码/请求 ID/修复建议）
          genTest.error = t.errorMsg || '上游未返回失败原因'
          genTest.detail = { task_id: taskId, loading: true, error: { hint: '', raw: t.errorMsg || '' } }
          loadTaskFailureDetail(taskId, round)
        } else {
          pollGenTestTask(taskId, startedAt, round)
        }
      } catch (e) {
        if (round !== genTestRound) return
        genTest.busy = false
        genTest.error = e.message || '任务状态查询失败'
        genTest.detail = { task_id: taskId, error: { hint: '任务可能已被清理；到工作台任务列表确认该任务是否还存在。', raw: '' } }
      }
    }, 3000)
  }

  /** 失败任务补拉一次诊断：拉不到就保留原始 errorMsg，绝不为细节把弹层卡在 loading */
  async function loadTaskFailureDetail(taskId, round) {
    try {
      const d = await taskAPI.failureDetail(taskId)
      if (round !== genTestRound || genTest.detail?.task_id !== taskId) return
      genTest.detail = { ...d, loading: false }
      if (d?.error?.summary) genTest.error = d.error.summary
    } catch {
      if (round !== genTestRound || genTest.detail?.task_id !== taskId) return
      genTest.detail = { ...genTest.detail, loading: false }
    }
  }

  const genTestErrInfo = computed(() => genTest.detail?.error || null)
  const genTestKindLabel = computed(() => FAILURE_KIND_LABEL[genTest.detail?.error?.kind] || '')
  /** 诊断清单：有值才占一行，避免整屏空字段噪音 */
  const genTestFacts = computed(() => {
    const d = genTest.detail
    if (!d) return []
    const e = d.error || {}
    const facts = []
    if (e.upstream_status) facts.push({ label: '上游状态码', value: String(e.upstream_status) })
    if (e.upstream_code) facts.push({ label: '上游错误码', value: e.upstream_code })
    if (e.request_id) facts.push({ label: '上游请求 ID', value: e.request_id })
    if (d.provider) facts.push({ label: '服务商', value: d.provider })
    if (d.model) facts.push({ label: '模型', value: d.model })
    if (d.config?.base_url) facts.push({ label: 'Base URL', value: d.config.base_url })
    if (d.config?.api_key) facts.push({ label: '本次使用的 Key', value: d.config.api_key })
    if (d.config && d.config.is_active === false) facts.push({ label: '配置状态', value: '该配置已停用' })
    if (d.task_id) facts.push({ label: '任务号', value: `#${d.task_id}` })
    if (d.upstream_task_id) facts.push({ label: '上游任务号', value: d.upstream_task_id })
    if (d.retry_count) facts.push({ label: '已重提次数', value: String(d.retry_count) })
    if (d.elapsed_ms) facts.push({ label: '耗时', value: `${(d.elapsed_ms / 1000).toFixed(1)}s` })
    return facts
  })

  function copyGenDiagnosis() {
    const d = genTest.detail || {}
    const e = d.error || {}
    const lines = [
      `【生成测试失败诊断】${genTest.serviceType} / ${genTest.model || '—'}`,
      `结论：${genTest.error || e.summary || ''}`,
      e.kind ? `分类：${FAILURE_KIND_LABEL[e.kind] || e.kind}` : '',
      e.hint ? `建议：${e.hint}` : '',
      ...genTestFacts.value.map(f => `${f.label}：${f.value}`),
      e.raw ? `原始返回：\n${e.raw}` : '',
    ].filter(Boolean)
    copyText(lines.join('\n'), '诊断信息已复制，可直接发给服务商')
  }

  /** 重新测试：按当前配置列表里的最新值再发一次（配置可能刚被改过） */
  function retestGenerate() {
    const c = cfgs.value.find(x => x.id === genTest.configId)
    if (!c) { toast.error('该配置已被删除或无权访问'); closeGenerateTest(); return }
    runGenerateTest(c)
  }

  function copyGenResult() {
    const val = genTest.serviceType === 'text' ? genTest.text : genTest.mediaUrl
    if (!val) return
    navigator.clipboard?.writeText(val).then(() => toast.success('已复制')).catch(() => toast.error('复制失败'))
  }

  onBeforeUnmount(stopGenTestPoll)

  return {
    genTest, genTestStatusTag, genTestErrInfo, genTestKindLabel, genTestFacts,
    runGenerateTest, closeGenerateTest, retestGenerate, copyGenDiagnosis, copyGenResult,
  }
}
