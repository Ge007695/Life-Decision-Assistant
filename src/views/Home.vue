<script setup>
/**
 * 出门首页
 *
 * 版面顺序按工作指导书 4.4：
 *   ① 结论横幅（hero）→ ② 四条指数条 → ③ 出门清单 → ④ 24 小时晾晒分 → ⑤ 7 天简表。
 * ①② 压缩在一屏内看完，其它靠滚动。
 *
 * 本文件只做「结构 + 样式 + ECharts option」；取数、判定、汇总都在
 * @/modules/outing/useOuting.js 里（组件不做业务判断）。
 */
import { computed, inject } from 'vue'
import DecisionCard from '@/components/DecisionCard.vue'
import ScoreBar from '@/components/ScoreBar.vue'
import ActionList from '@/components/ActionList.vue'
import TrendChart from '@/components/TrendChart.vue'
import WeeklyWear from '@/modules/outing/WeeklyWear.vue'
import SportCard from '@/modules/outing/SportCard.vue'
import CompareCard from '@/modules/outing/CompareCard.vue'
import HistoryCompare from '@/modules/outing/HistoryCompare.vue'
import { useOuting } from '@/modules/outing/useOuting.js'

const injectedConfig = inject('config', null)

const {
  loading,
  error,
  warning,
  hasData,
  cityName,
  dateLabel,
  freshnessText,
  weather,
  bars,
  banner,
  activeId,
  activeResult,
  incompleteCount,
  selectIndex,
  mergedActions,
  checklistKey,
  trend,
  dailyRows,
  bestRange,
  bestWindowText,
  dryThreshold,
  windowHours,
  refresh,
  submitFeedback,
} = useOuting(injectedConfig)

/**
 * ECharts 不认 CSS 变量，必须给实际色值。
 * 优先从 :root 上用 getComputedStyle 读，读不到时用与 main.css 完全一致的字面值兜底，
 * 这样换主题色只改 main.css 一处，图表跟着变。
 */
const CSS_FALLBACKS = {
  accent: '#2f6fed',
  accentWeak: '#edf3ff',
  lv4: '#12945f',
  lv4Weak: '#e6f6ee',
  lv2: '#c9791a',
  text2: '#5b6572',
  text3: '#8a94a3',
  line: '#e6e8ec',
  surface: '#ffffff',
}

let paletteCache = null

function cssPalette() {
  if (paletteCache) return paletteCache
  const root = typeof document !== 'undefined' ? document.documentElement : null
  const read = (name, key) => {
    if (!root) return CSS_FALLBACKS[key]
    const value = getComputedStyle(root).getPropertyValue(name).trim()
    return value || CSS_FALLBACKS[key]
  }
  paletteCache = {
    accent: read('--accent', 'accent'),
    accentWeak: read('--accent-weak', 'accentWeak'),
    lv4: read('--lv4', 'lv4'),
    lv4Weak: read('--lv4-weak', 'lv4Weak'),
    lv2: read('--lv2', 'lv2'),
    text2: read('--text-2', 'text2'),
    text3: read('--text-3', 'text3'),
    line: read('--line', 'line'),
    surface: read('--surface', 'surface'),
  }
  return paletteCache
}

/** 顶部一行气象摘要，缺字段就不显示，不留「null℃」 */
const weatherBrief = computed(() => {
  const data = weather.value
  if (!data) return ''
  const parts = []
  if (typeof data.temp === 'number') parts.push(`${Math.round(data.temp)} ℃`)
  if (typeof data.humidity === 'number') parts.push(`湿度 ${Math.round(data.humidity)}%`)
  if (typeof data.windSpeed === 'number') parts.push(`风 ${Math.round(data.windSpeed * 10) / 10} m/s`)
  if (data.windDir) parts.push(data.windDir)
  return parts.join(' · ')
})

/** 新鲜度文案带警示色：过期用 lv2，正常用 faint */
const freshnessClass = computed(() => (freshnessText.value.includes('过期') ? 'lv-2' : 'faint'))

const trendOption = computed(() => {
  const colors = cssPalette()
  const points = trend.value
  const labels = points.map((point) => point.label)
  const scores = points.map((point) => Math.round(point.score * 10) / 10)
  const range = bestRange.value
  const threshold = dryThreshold.value

  const series = {
    name: '晾晒分',
    type: 'line',
    smooth: true,
    symbol: 'circle',
    symbolSize: 5,
    showSymbol: false,
    data: scores,
    lineStyle: { width: 2, color: colors.accent },
    itemStyle: { color: colors.accent },
    areaStyle: { color: colors.accentWeak },
    emphasis: { focus: 'series' },
  }
  if (range) {
    series.markArea = {
      silent: true,
      itemStyle: { color: colors.lv4Weak },
      label: {
        show: true,
        position: 'insideTop',
        color: colors.lv4,
        fontSize: 11,
        formatter: '最佳时段',
      },
      data: [[{ xAxis: range.startLabel }, { xAxis: range.endLabel }]],
    }
  }
  if (threshold !== null) {
    series.markLine = {
      silent: true,
      symbol: 'none',
      lineStyle: { color: colors.lv2, type: 'dashed', width: 1 },
      label: {
        position: 'insideEndTop',
        color: colors.lv2,
        fontSize: 11,
        formatter: `可晾线 ${threshold} 分`,
      },
      data: [{ yAxis: threshold }],
    }
  }

  return {
    animationDuration: 500,
    grid: { left: 2, right: 12, top: 26, bottom: 0, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: colors.surface,
      borderColor: colors.line,
      borderWidth: 1,
      padding: [6, 10],
      textStyle: { color: colors.text2, fontSize: 12 },
      formatter: (params) => {
        const hit = Array.isArray(params) ? params[0] : params
        if (!hit) return ''
        return `${hit.axisValue}<br/>晾晒分 ${Math.round(hit.data)}`
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: labels,
      axisLine: { lineStyle: { color: colors.line } },
      axisTick: { show: false },
      axisLabel: { color: colors.text3, fontSize: 11, interval: 3 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.text3, fontSize: 11 },
      splitLine: { lineStyle: { color: colors.line, type: 'dashed' } },
    },
    series: [series],
  }
})

const windowHint = computed(() =>
  windowHours.value ? `连续 ${windowHours.value} 小时均分不低于 ${dryThreshold.value ?? '—'} 分` : '按规则阈值取最优窗口',
)
</script>

<template>
  <div class="page stack">
    <!-- 抬头：城市 / 日期 / 新鲜度，一行看完 -->
    <header class="lead">
      <div class="lead-text">
        <h1 class="card-title">今天出门</h1>
        <p class="tiny">
          <span class="muted">{{ cityName || '深圳' }}</span>
          <span class="faint"> · {{ dateLabel || '—' }} · </span>
          <span :class="freshnessClass">{{ freshnessText }}</span>
        </p>
        <p v-if="weatherBrief" class="tiny faint num">{{ weatherBrief }}</p>
      </div>
      <button class="btn btn-sm" type="button" :disabled="loading" @click="refresh">
        {{ loading ? '取数中' : '刷新' }}
      </button>
    </header>

    <p v-if="warning" class="notice">{{ warning }}</p>

    <!-- ① 结论横幅 -->
    <section class="stack-sm">
      <template v-if="loading && !hasData">
        <div class="card skeleton-card">
          <div class="skeleton sk-chip" />
          <div class="skeleton sk-line" />
          <div class="skeleton sk-line short" />
        </div>
      </template>

      <template v-else-if="!hasData">
        <div class="card stack-sm empty-card">
          <p class="card-title">天气数据暂时取不到</p>
          <p class="small muted">{{ error || '可能是网络或接口限流，稍后重试即可。' }}</p>
          <p class="tiny faint">页面结构保留，指数恢复后自动补齐；本地存储里的清单勾选不受影响。</p>
          <div class="row">
            <button class="btn btn-primary btn-sm" type="button" @click="refresh">稍后重试</button>
          </div>
        </div>
      </template>

      <template v-else>
        <DecisionCard
          v-if="banner"
          :result="banner"
          :title="banner.shortLabel"
          hero
          :show-actions="false"
          :show-evidence="false"
        />
        <p v-if="banner" class="tiny faint ref-line">
          配置依据 {{ banner.configRef }} · 规则 v{{ banner.version }}
        </p>
        <p v-if="incompleteCount > 0" class="tiny faint">
          有 {{ incompleteCount }} 项指数数据不足，已标注「数据降级」，结论仅作参考。
        </p>
      </template>
    </section>

    <!-- ② 指数条组：点一条，下面展开完整卡片 -->
    <section class="card">
      <h2 class="section-title">今日四项指数</h2>
      <ScoreBar v-if="bars.length" :items="bars" :active-id="activeId" @select="selectIndex" />
      <ul v-else class="placeholder-bars">
        <li v-for="count in 4" :key="count" class="placeholder-bar">
          <span class="skeleton sk-placeholder" />
        </li>
      </ul>
      <p class="tiny faint hint">点击任意一条，查看该结论的完整判定与依据</p>
    </section>

    <!-- ②-展开：完整结论卡（含依据折叠、体感反馈） -->
    <section v-if="activeResult" class="stack-sm">
      <DecisionCard
        :result="activeResult"
        :title="activeResult.label"
        :feedbackable="activeResult.id === 'clothing'"
        :storage-key="`${checklistKey}:${activeResult.id}`"
        @feedback="submitFeedback"
      />
      <p class="tiny faint ref-line">
        配置依据 {{ activeResult.configRef }} · 规则 v{{ activeResult.version }} ·
        体感校准 {{ feedbackOffset > 0 ? '+' : '' }}{{ feedbackOffset }} ℃
      </p>
    </section>

    <!-- ③ 出门清单 -->
    <section class="card">
      <h2 class="section-title">出门清单</h2>
      <ActionList
        :actions="mergedActions"
        :storage-key="checklistKey"
        title="四条结论的动作已合并去重"
        dense
      />
      <p v-if="mergedActions.length === 0" class="small faint">当前没有需要执行的动作。</p>
    </section>

    <!-- ④ 最佳时间窗 -->
    <section class="card">
      <div class="row-between chart-head">
        <h2 class="section-title">未来 24 小时晾晒分</h2>
        <span class="chip chip-lv3">{{ bestWindowText }}</span>
      </div>
      <TrendChart v-if="trend.length" :option="trendOption" height="200px" />
      <p v-else class="small faint">逐小时数据缺失，暂时画不出曲线。</p>
      <p class="tiny faint chart-note">
        逐小时按 indices.json#drying 同一套权重打分；{{ windowHint }}，绿色阴影为最佳时段。
      </p>
    </section>

    <!-- ⑤ 7 天简表 -->
    <section class="card">
      <h2 class="section-title">未来 7 天</h2>
      <div v-if="dailyRows.length" class="week-table">
        <div class="week-row week-head">
          <span>日期</span>
          <span>天气</span>
          <span>最低/最高</span>
          <span class="week-chip-cell">晾晒</span>
        </div>
        <div v-for="row in dailyRows" :key="row.date" class="week-row">
          <span class="week-date num">
            {{ row.dateLabel }}
            <em class="faint">{{ row.weekday }}</em>
          </span>
          <span class="week-weather muted num">
            降水 {{ row.precipProb === null ? '—' : `${row.precipProb}%` }}
          </span>
          <span class="week-temp num">{{ row.tempText }}</span>
          <span class="week-chip-cell">
            <span class="chip" :class="`chip-lv${row.level}`">{{ row.levelLabel }}</span>
          </span>
        </div>
      </div>
      <p v-else class="small faint">未来 7 天预报缺失。</p>
      <p class="tiny faint chart-note">
        日级数据只有气温与降水概率，湿度、风速、日照缺失，等级为粗估，精度低于上方当日卡片。
      </p>
    </section>

    <!-- ⑥ 更多出门参考（P2）：只在取到当日天气时显示，否则这些卡都是空结论 -->
    <template v-if="hasData">
      <h2 class="section-title group-title">更多出门参考</h2>
      <WeeklyWear :daily="weather?.daily || []" :today="weather?.date || ''" />
      <SportCard :temp="weather?.temp ?? null" :humidity="weather?.humidity ?? null" />
      <CompareCard />
      <HistoryCompare :daily="weather?.daily || []" :today="weather?.date || ''" />
    </template>
  </div>
</template>

<style scoped>
/* 分组标题：和卡片内的 section-title 同级但更弱，表示「下面换一类内容」 */
.group-title {
  margin: 10px 0 -2px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-3, var(--text-2));
}

/* ---------- 抬头 ---------- */

.lead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.lead-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.lead-text h1 {
  font-size: 18px;
  font-weight: 650;
}

.lead-text p {
  line-height: 1.5;
}

/* ---------- 骨架屏 ---------- */

.skeleton-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 116px;
}

.sk-chip {
  width: 64px;
  height: 20px;
  border-radius: 999px;
}

.sk-line {
  width: 100%;
  height: 18px;
}

.sk-line.short {
  width: 62%;
}

.empty-card {
  min-height: 128px;
}

.placeholder-bars {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0;
}

.placeholder-bar {
  padding: 0 12px;
}

.sk-placeholder {
  display: block;
  height: 34px;
  width: 100%;
}

/* ---------- 通用小字 ---------- */

.ref-line {
  line-height: 1.6;
  word-break: break-word;
}

.hint {
  margin-top: 8px;
}

/* ---------- 图表 ---------- */

.chart-head {
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.chart-head .section-title {
  margin-bottom: 0;
}

.chart-note {
  margin-top: 8px;
  line-height: 1.6;
}

/* ---------- 7 天简表 ---------- */

.week-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.week-row {
  display: grid;
  grid-template-columns: minmax(56px, 0.9fr) minmax(0, 1.1fr) minmax(0, 0.9fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 2px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  line-height: 1.4;
}

.week-row:last-child {
  border-bottom: none;
}

.week-head {
  padding-top: 0;
  font-size: 12px;
  color: var(--text-3);
  border-bottom-color: var(--line-strong);
}

.week-date {
  display: flex;
  flex-direction: column;
  font-weight: 600;
}

.week-date em {
  font-style: normal;
  font-size: 11px;
  font-weight: 400;
}

.week-weather {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.week-temp {
  white-space: nowrap;
}

.week-chip-cell {
  justify-self: end;
  white-space: nowrap;
}

@media (max-width: 380px) {
  .week-row {
    grid-template-columns: minmax(50px, 0.85fr) minmax(0, 1fr) minmax(0, 0.85fr) auto;
    gap: 6px;
    font-size: 12.5px;
  }

  .chart-head {
    flex-wrap: wrap;
  }
}
</style>
