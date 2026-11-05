<script setup>
/**
 * 出门模块 · 历史同期对比（O-11 / P2）
 *
 * 今年的 7 天预报从首页传进来；去年同期的实际记录由 climate.js 去 archive 接口取。
 * 两边数据性质不同（预报 vs 实况），所以图例和下方说明都要点明，
 * 不能让用户以为这是「两年同一个东西的对比」。
 */
import { computed, inject, onMounted, ref } from 'vue'
import TrendChart from '@/components/TrendChart.vue'
import climateService from '@/services/climate.js'
import { get as readStore, KEYS } from '@/services/storage.js'
import { buildHistory, describe } from './history.js'

const props = defineProps({
  /** weather.js 的 data.daily */
  daily: { type: Array, default: () => [] },
  /** 今天的本地日期 YYYY-MM-DD */
  today: { type: String, default: '' },
})

const config = inject('config', {})

const DAYS = 7

const loading = ref(true)
const error = ref('')
const stale = ref(false)
const historyDaily = ref([])
const sourceStart = ref('')
const sourceEnd = ref('')

onMounted(async () => {
  const settings = readStore(KEYS.SETTINGS, {}) || {}
  const cities = config.cities || []
  const wanted = settings.cityId || config.defaultCityId
  const city = cities.find((item) => item.id === wanted) || cities[0]

  if (!city) {
    error.value = '没有可用城市配置'
    loading.value = false
    return
  }

  const start = props.today || new Date().toISOString().slice(0, 10)
  try {
    const response = await climateService.getSamePeriod(city, start, DAYS)
    sourceStart.value = response.sourceStart || ''
    sourceEnd.value = response.sourceEnd || ''
    if (response?.ok && response.data?.length) {
      historyDaily.value = response.data
      stale.value = Boolean(response.stale)
    } else {
      error.value = response?.error || '历史数据没取到'
    }
  } catch (err) {
    error.value = err?.message || '历史数据没取到'
  } finally {
    loading.value = false
  }
})

const comparison = computed(() =>
  buildHistory({ forecastDaily: props.daily, historyDaily: historyDaily.value, today: props.today, days: DAYS }),
)

const summaryText = computed(() => describe(comparison.value.summary))

/** '2026-11-05' → '11-05' */
function shortDate(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(text || '')) ? String(text).slice(5) : String(text || '—')
}

/**
 * 差值取整显示。
 * 两列温度都是整数（29°），差值若保留一位就会出现「29° vs 29°，差值 +0.1」这种
 * 看起来自相矛盾的行。不足半度的直接显示 ≈。
 */
function deltaText(delta) {
  if (delta === null || delta === undefined) return '—'
  const rounded = Math.round(delta)
  if (rounded === 0) return '≈'
  return `${rounded > 0 ? '+' : ''}${rounded}`
}

/** ECharts 不认 CSS 变量，读不到就用与 main.css 一致的字面值 */
function palette() {
  const root = typeof document !== 'undefined' ? document.documentElement : null
  const read = (name, fallback) => {
    if (!root) return fallback
    const value = getComputedStyle(root).getPropertyValue(name).trim()
    return value || fallback
  }
  return {
    accent: read('--accent', '#2f6fed'),
    muted: read('--text-3', '#8a94a3'),
    line: read('--line', '#e6e8ec'),
    text2: read('--text-2', '#5b6572'),
  }
}

const chartOption = computed(() => {
  const rows = comparison.value.rows.filter((row) => row.thisDate || row.lastDate)
  if (rows.length === 0) return null
  const colors = palette()
  const labels = rows.map((row) => shortDate(row.thisDate || row.lastDate))

  return {
    grid: { left: 40, right: 14, top: 34, bottom: 26 },
    legend: {
      data: ['今年预报', '去年同期实况'],
      right: 0,
      top: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: colors.text2, fontSize: 11 },
    },
    tooltip: { trigger: 'axis', valueFormatter: (value) => (value === null ? '—' : `${value} ℃`) },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: colors.muted, fontSize: 11, formatter: '{value}°' },
      splitLine: { lineStyle: { color: colors.line, type: 'dashed' } },
    },
    series: [
      {
        name: '今年预报',
        type: 'line',
        smooth: true,
        symbolSize: 5,
        data: rows.map((row) => row.thisMax),
        lineStyle: { width: 2, color: colors.accent },
        itemStyle: { color: colors.accent },
      },
      {
        name: '去年同期实况',
        type: 'line',
        smooth: true,
        symbolSize: 5,
        data: rows.map((row) => row.lastMax),
        lineStyle: { width: 2, color: colors.muted, type: 'dashed' },
        itemStyle: { color: colors.muted },
      },
    ],
  }
})
</script>

<template>
  <section class="card stack-sm">
    <div class="row-between">
      <h2 class="section-title section-flush">历史同期对比</h2>
      <span v-if="sourceStart" class="chip">去年 {{ shortDate(sourceStart) }} 起</span>
    </div>

    <div v-if="loading" class="stack-sm">
      <div class="skeleton skeleton-bar" />
      <div class="skeleton skeleton-chart" />
    </div>

    <p v-else-if="error" class="notice">
      去年同期数据没取到（{{ error }}），这项对比暂时不可用。
      <span class="block tiny">历史数据来自再分析归档，个别日期本身可能缺测。</span>
    </p>

    <template v-else-if="comparison.status === 'ok'">
      <p class="small">{{ summaryText }}。</p>
      <p v-if="stale" class="faint tiny">历史数据是缓存，可能不是最新一次拉取结果。</p>

      <TrendChart v-if="chartOption" :option="chartOption" height="180px" />

      <div class="hist-table">
        <div class="hist-row hist-head">
          <span>日期</span>
          <span>今年最高</span>
          <span>去年最高</span>
          <span>差值</span>
        </div>
        <div v-for="row in comparison.rows" :key="row.index" class="hist-row">
          <span class="num hist-date">
            {{ shortDate(row.thisDate || row.lastDate) }}
          </span>
          <span class="num">{{ row.thisMax === null ? '—' : `${Math.round(row.thisMax)}°` }}</span>
          <span class="num">{{ row.lastMax === null ? '—' : `${Math.round(row.lastMax)}°` }}</span>
          <span class="num" :class="row.deltaMax === null ? 'faint' : row.deltaMax > 0 ? 'up' : 'down'">
            {{ deltaText(row.deltaMax) }}
          </span>
        </div>
      </div>

      <div class="hist-facts">
        <p class="small muted">
          去年同期这 {{ comparison.summary.lastCount }} 天累计降水
          <span class="num">{{ comparison.summary.lastPrecipSum }} mm</span>，
          其中 {{ comparison.summary.lastRainDays }} 天有雨；
          今年未来 {{ comparison.summary.thisCount }} 天里有 {{ comparison.summary.thisRainDays }} 天降水概率 ≥50%。
        </p>
      </div>

      <p class="faint tiny">
        口径：今年是<strong>预报</strong>（未来 {{ DAYS }} 天），去年是<strong>实况记录</strong>（再分析归档），
        两者性质不同，差值是「预报值 − 实况值」，本来就含一层预报误差。
        另外 {{ DAYS }} 天样本不足以谈气候变化，这里只做同期对照，不做趋势判断。
      </p>
    </template>

    <p v-else class="notice">
      今年预报或去年同期数据有一边是空的，凑不出逐日对比。
    </p>
  </section>
</template>

<style scoped>
.section-flush {
  margin: 0;
}

.skeleton-bar {
  height: 14px;
  width: 60%;
}

.skeleton-chart {
  height: 140px;
}

.hist-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hist-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 0.8fr;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 13px;
}

.hist-row:last-child {
  border-bottom: none;
}

.hist-head {
  font-size: 12px;
  color: var(--text-3, var(--text-2));
  border-bottom: 1px solid var(--line);
}

.hist-row > span:not(.hist-date) {
  text-align: right;
}

.hist-date {
  color: var(--text-2);
}

/* 温差正负用颜色分开：这里不是涨跌，只是「比去年热/冷」 */
.up {
  color: var(--lv-2, #c9791a);
}

.down {
  color: var(--accent, #2f6fed);
}

.hist-facts {
  padding: 8px 0 0;
}
</style>
