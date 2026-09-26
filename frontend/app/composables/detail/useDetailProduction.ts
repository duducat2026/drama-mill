/*
 * Drama Mill — 项目详情「自动化生产进度」逻辑（自 views/drama/detail.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 *
 * 编排进度轮询与阶段矩阵展示：状态非 idle 时展示卡片，间隔按状态自适应。
 */
import { toast } from 'vue-sonner'
import { productionAPI } from '~/composables/useApi'

export function useDetailProduction(dramaId: number) {
  // ===== 自动化生产进度：状态非 idle 时展示卡片，5s 轮询 =====
  const production = ref<any>(null)
  let prodTimer: ReturnType<typeof setTimeout> | null = null
  const PIPELINE_STEP_KEYS = ['script_rewrite', 'extract_characters', 'extract_scenes', 'extract_storyboards', 'generate_images', 'generate_videos']
  // 进度矩阵列：与后端每集步骤键一一对应（列头图例 + 各集单元格对齐）
  const PROD_MATRIX_KEYS = PIPELINE_STEP_KEYS
  const PROD_STEP_LABELS: Record<string, string> = {
    script_rewrite: '剧本改写',
    extract_characters: '角色提取',
    extract_scenes: '场景提取',
    extract_storyboards: '分镜拆分',
    generate_images: '素材图片',
    generate_videos: '视频生成',
    // 编排器 current_step 使用的阶段键（仅顶部「当前进度」文案用）
    extract_assets: '资产提取',
    storyboard_split: '分镜拆分',
    video_prompts: '视频提示词',
    asset_images: '资产图片',
  }
  const PROD_STATUS_LABELS: Record<string, string> = { running: '生产中', paused: '已暂停', done: '已完成', error: '出错' }
  // idle 兜底：run 丢失（如进程重启）或从未生产过，但存在未完成集时仍展示卡片并提供启动入口
  const idleProd = computed(() => {
    const p = production.value
    if (!p || p.status !== 'idle') return null
    const eps = p.episodes || []
    if (!eps.length) return null
    // 自动生产不含拼接：以全部集的视频生成完成为“已完成”
    if (eps.every((ep: any) => epStepStatus(ep.steps, 'generate_videos') === 'done')) return null
    const interrupted = eps.some((ep: any) => PIPELINE_STEP_KEYS.some(k => epStepStatus(ep.steps, k) !== 'pending'))
    return { interrupted }
  })
  const prodStatusLabel = computed(() => {
    if (production.value?.status === 'idle') return idleProd.value?.interrupted ? '已中断' : '未开始'
    return PROD_STATUS_LABELS[production.value?.status] || ''
  })
  function prodStepLabel(key: string) { return PROD_STEP_LABELS[key] || key || '' }
  function epStepStatus(steps: any, key: string) {
    const st = steps?.[key]?.status
    if (st === 'done' || st === 'completed') return 'done'
    if (st === 'partial' || st === 'ready' || st === 'processing') return 'partial'
    return 'pending'
  }
  // 单元格计数文案：completed/total 优先，其次 count（如角色数）
  function stepCountText(steps: any, key: string) {
    const st = steps?.[key]
    if (!st) return ''
    if (st.total > 0) return `${st.completed ?? 0}/${st.total}`
    if (st.count > 0) return String(st.count)
    return ''
  }
  // 卡片摘要：最后一个非待办阶段；全完成则显示已完成，全待办显示未开始
  function epStepSummary(ep: any) {
    const steps = ep.steps || {}
    if (PIPELINE_STEP_KEYS.every(k => epStepStatus(steps, k) === 'done')) return '已完成'
    let lastKey = ''
    for (const k of PIPELINE_STEP_KEYS) if (epStepStatus(steps, k) !== 'pending') lastKey = k
    if (!lastKey) return '未开始'
    const cnt = stepCountText(steps, lastKey)
    return `${prodStepLabel(lastKey)}${cnt ? ' · ' + cnt : ''}`
  }
  function goEpisodeWorkbench(num: number) { navigateTo(`/drama/${dramaId}/episode/${num}`) }

  async function loadProduction() {
    try {
      production.value = await productionAPI.status(dramaId)
    } catch { production.value = null }
  }
  // 轮询间隔按状态自适应：running 5s / paused·error 10s / idle·done 30s；页面隐藏时停轮询，回前台立即补一次
  const PROD_INTERVALS: Record<string, number> = { running: 5000, paused: 10000, error: 10000, done: 30000, idle: 30000 }
  function scheduleProductionPoll() {
    clearTimeout(prodTimer as any)
    if (typeof document !== 'undefined' && document.hidden) return
    const delay = PROD_INTERVALS[production.value?.status] ?? 10000
    prodTimer = setTimeout(async () => {
      await loadProduction()
      scheduleProductionPoll()
    }, delay)
  }

  function onDocVisibility() {
    if (typeof document === 'undefined') return
    if (document.hidden) clearTimeout(prodTimer as any)
    else { loadProduction().then(scheduleProductionPoll) }
  }

  async function doPauseProduction() {
    try { await productionAPI.pause(dramaId); toast.info('已请求暂停，当前步骤完成后生效'); await loadProduction() } catch (e: any) { toast.error(e.message) }
  }
  async function doResumeProduction() {
    try { await productionAPI.resume(dramaId); toast.success('已继续生产'); await loadProduction() } catch (e: any) { toast.error(e.message) }
  }
  async function doStartProduction() {
    try { await productionAPI.start(dramaId); toast.success('自动生产已启动'); await loadProduction() } catch (e: any) { toast.error(e.message) }
  }

  onMounted(async () => {
    await loadProduction()
    scheduleProductionPoll()
    document.addEventListener('visibilitychange', onDocVisibility)
  })
  onBeforeUnmount(() => {
    clearTimeout(prodTimer as any)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onDocVisibility)
  })

  return {
    production,
    PROD_MATRIX_KEYS,
    idleProd,
    prodStatusLabel,
    prodStepLabel,
    epStepStatus,
    stepCountText,
    epStepSummary,
    goEpisodeWorkbench,
    doPauseProduction,
    doResumeProduction,
    doStartProduction,
  }
}
