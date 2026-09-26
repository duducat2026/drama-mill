<!--
  AdminMonitorCharts.vue — 运行监控「24h 趋势柱状图 + 任务状态分布环形图」（纯 SVG）。
  由 admin/monitor.vue 拆分而来（单文件超限治理）；样式复用父页全局 monitor-* 类。
-->
<template>
  <div class="monitor-charts">
    <div class="monitor-card monitor-card-grow">
      <div class="monitor-card-head">
        <span class="monitor-card-title">最近 24 小时任务趋势</span>
        <span class="monitor-legend">
          <span class="monitor-legend-item"><i style="background:var(--accent,#0071e3)"></i>新提交</span>
          <span class="monitor-legend-item"><i style="background:#34c759"></i>完成</span>
          <span class="monitor-legend-item"><i style="background:#ff3b30"></i>失败</span>
        </span>
      </div>
      <svg v-if="trendChart" :viewBox="`0 0 ${TREND_W} ${TREND_H}`" class="monitor-svg" role="img" aria-label="最近24小时任务趋势">
        <line v-for="g in trendChart.gridLines" :key="g.val" :x1="TREND_PAD.l" :x2="TREND_W - TREND_PAD.r" :y1="g.y" :y2="g.y" class="monitor-grid" />
        <text v-for="g in trendChart.gridLines" :key="`t${g.val}`" :x="TREND_PAD.l - 6" :y="g.y + 3.5" class="monitor-axis" text-anchor="end">{{ g.val }}</text>
        <line :x1="TREND_PAD.l" :x2="TREND_W - TREND_PAD.r" :y1="trendChart.baseY" :y2="trendChart.baseY" class="monitor-axis-line" />
        <template v-for="(grp, gi) in trendChart.groups" :key="gi">
          <rect v-for="(b, bi) in grp.bars" :key="bi" :x="b.x" :y="b.y" :width="b.w" :height="Math.max(b.h, 0)" :rx="Math.min(2, b.w / 2)" :fill="b.color">
            <title>{{ grp.label }} {{ b.name }}：{{ b.v }}</title>
          </rect>
          <text v-if="grp.showLabel" :x="grp.lx" :y="TREND_H - 8" class="monitor-axis" text-anchor="middle">{{ grp.label }}</text>
        </template>
      </svg>
      <div v-else class="admin-empty">暂无任务数据</div>
    </div>

    <div class="monitor-card">
      <div class="monitor-card-head"><span class="monitor-card-title">任务状态分布（全量）</span></div>
      <div v-if="statusDonut.total" class="monitor-donut-wrap">
        <svg viewBox="0 0 140 140" class="monitor-donut" role="img" aria-label="任务状态分布">
          <circle v-for="seg in statusDonut.segs" :key="seg.key" cx="70" cy="70" r="52" fill="none"
                  :stroke="seg.color" stroke-width="18" :stroke-dasharray="seg.dash" :stroke-dashoffset="seg.offset"
                  transform="rotate(-90 70 70)">
            <title>{{ seg.label }}：{{ seg.count }}（{{ seg.percent }}%）</title>
          </circle>
          <text x="70" y="66" class="monitor-donut-num" text-anchor="middle">{{ statusDonut.total }}</text>
          <text x="70" y="82" class="monitor-donut-sub" text-anchor="middle">任务总数</text>
        </svg>
        <ul class="monitor-donut-legend">
          <li v-for="seg in statusDonut.segs" :key="seg.key">
            <i :style="{ background: seg.color }"></i>
            <span class="monitor-donut-label">{{ seg.label }}</span>
            <span class="monitor-donut-count">{{ seg.count }}</span>
            <span class="monitor-donut-pct">{{ seg.percent }}%</span>
          </li>
        </ul>
      </div>
      <div v-else class="admin-empty">暂无任务数据</div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ data: any }>()

// ─── 趋势柱状图（纯 SVG） ───
const TREND_W = 720
const TREND_H = 232
const TREND_PAD = { l: 36, r: 8, t: 12, b: 24 }
const TREND_SERIES = [
  { key: 'created', name: '新提交', color: 'var(--accent, #0071e3)' },
  { key: 'completed', name: '完成', color: '#34c759' },
  { key: 'failed', name: '失败', color: '#ff3b30' },
]

/** 纵轴上限取整到“好看”的刻度（1/2/5 ×10^n） */
function niceCeil(n: number): number {
  if (n <= 5) return 5
  const pow = 10 ** Math.floor(Math.log10(n))
  for (const m of [1, 2, 5, 10]) {
    if (n <= m * pow) return m * pow
  }
  return 10 * pow
}

const trendChart = computed(() => {
  const hourly = props.data?.hourly || []
  if (!hourly.length) return null
  const yMax = niceCeil(Math.max(1, ...hourly.flatMap((h: any) => [h.created || 0, h.completed || 0, h.failed || 0])))
  const plotW = TREND_W - TREND_PAD.l - TREND_PAD.r
  const plotH = TREND_H - TREND_PAD.t - TREND_PAD.b
  const band = plotW / hourly.length
  const barW = Math.min(8, band * 0.24)
  const groups = hourly.map((h: any, i: number) => {
    const cx = TREND_PAD.l + band * i + band / 2
    return {
      label: h.label,
      showLabel: i % 3 === 0,
      lx: cx,
      bars: TREND_SERIES.map((s, si) => {
        const v = h[s.key] || 0
        return {
          name: s.name,
          color: s.color,
          v,
          w: barW,
          x: cx + (si - 1) * barW * 1.15 - barW / 2,
          y: TREND_PAD.t + plotH * (1 - v / yMax),
          h: plotH * (v / yMax),
        }
      }),
    }
  })
  const gridLines = [0.25, 0.5, 0.75, 1].map(f => ({ y: TREND_PAD.t + plotH * (1 - f), val: Math.round(yMax * f) }))
  return { groups, gridLines, baseY: TREND_PAD.t + plotH }
})

// ─── 状态分布环形图 ───
const TASK_STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: '等待中', color: '#ff9500' },
  processing: { label: '进行中', color: '#0071e3' },
  completed: { label: '已完成', color: '#34c759' },
  failed: { label: '失败', color: '#ff3b30' },
}
const statusDonut = computed(() => {
  const by = props.data?.tasks_by_status || {}
  const entries = Object.entries(by).filter(([, v]) => Number(v) > 0) as [string, number][]
  const total = entries.reduce((s, [, v]) => s + Number(v), 0)
  if (!total) return { total: 0, segs: [] as any[] }
  const C = 2 * Math.PI * 52
  let acc = 0
  const segs = entries
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([k, v]) => {
      const meta = TASK_STATUS_META[k] || { label: k, color: '#8e8e93' }
      const frac = Number(v) / total
      const seg = {
        key: k,
        label: meta.label,
        color: meta.color,
        count: Number(v),
        percent: (frac * 100).toFixed(1),
        dash: `${frac * C} ${C}`,
        offset: -acc * C,
      }
      acc += frac
      return seg
    })
  return { total, segs }
})
</script>
