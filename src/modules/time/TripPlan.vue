<script setup>
/**
 * 时间模块 · 假期出行准备清单（T-5）
 *
 * 组件只做两件事：取一次天气、把 buildTripPlan 的结果画出来。
 * 天数判断、状态判定、规则调用全在 tripPlan.js，模板里不算日期也不做判断。
 *
 * 取数策略：挂载时取一次，走 weather.js 的 24 小时缓存。
 * 首页已经取过的话这里直接命中缓存，不会多发一次请求。
 * 取不到就显式说「数据没取到」，不给假清单。
 */
import { computed, inject, onMounted, ref } from 'vue'
import ActionList from '@/components/ActionList.vue'
import weatherService from '@/services/weather.js'
import { get as readStore, KEYS } from '@/services/storage.js'
import { formatDate } from '@/services/policy.js'
import {
  FORECAST_HORIZON_DAYS,
  buildRangePlan,
  buildTripPlan,
  checklistCount,
} from './tripPlan.js'

const config = inject('config', {})
const today = formatDate(new Date())

const loading = ref(true)
const error = ref('')
const stale = ref(false)
const ageHours = ref(null)
const hourlyAll = ref([])
const daily = ref([])
/** 当前没有可预判的假期时，用户可切到「未来 7 天」看真实预报 */
const showRange = ref(false)

const settings = readStore(KEYS.SETTINGS, {}) || {}
const feedbackOffset = Number(settings.feedbackOffset) || 0

const city = computed(() => {
  const cities = config.cities || []
  if (cities.length === 0) return null
  const wanted = settings.cityId || config.defaultCityId
  return cities.find((item) => item.id === wanted) || cities[0]
})

onMounted(async () => {
  if (!city.value) {
    loading.value = false
    error.value = '没有可用城市配置'
    return
  }
  try {
    const result = await weatherService.get(city.value)
    if (result?.ok && result.data) {
      hourlyAll.value = result.data.hourlyAll || []
      daily.value = result.data.daily || []
      stale.value = Boolean(result.stale)
      ageHours.value = result.ageHours
    } else {
      error.value = result?.error || '天气数据没取到'
    }
  } catch (err) {
    error.value = err?.message || '天气数据没取到'
  } finally {
    loading.value = false
  }
})

const plan = computed(() => {
  if (loading.value) return null
  if (hourlyAll.value.length === 0) {
    return {
      status: 'noWeather',
      days: [],
      checklist: { outfit: [], gear: [] },
      coverage: { inForecast: 0, total: 0 },
      message: error.value || '天气数据没取到',
    }
  }
  const base = { config, today, hourlyAll: hourlyAll.value, feedbackOffset }
  return showRange.value ? buildRangePlan(base) : buildTripPlan(base)
})

/** 清单勾选状态按第一个可预报日期分开存：不同假期互不干扰 */
const storageBase = computed(() => {
  const first = (plan.value?.days || []).find((day) => day.inForecast)
  return first ? `checklist:trip:${first.date}` : ''
})

const totalItems = computed(() => checklistCount(plan.value?.checklist))

/**
 * 雨具清单的标题要说明它的汇总口径。
 * 不说明的话，用户会以为「不用带伞」是整段假期的结论，
 * 实际它是假期里天气最好那天说的，没法指导打包。
 */
const gearTitle = computed(() => {
  const worstDay = plan.value?.checklist?.worstDay
  if (!worstDay) return '雨具与出行'
  return `雨具与出行（按天气最差的 ${dayLabel(worstDay)} 准备）`
})

const statusChip = computed(() => {
  const status = plan.value?.status
  if (status === 'ok') return { text: showRange.value ? '未来 7 天' : '预报范围内', cls: 'chip-lv4' }
  if (status === 'tooFar') return { text: '预报范围外', cls: 'chip-lv2' }
  if (status === 'pending') return { text: '待公布', cls: 'chip-lv2' }
  if (status === 'noWeather') return { text: '取数失败', cls: 'chip-lv1' }
  return { text: '暂无数据', cls: 'chip-lv0' }
})

const coverageText = computed(() => {
  const coverage = plan.value?.coverage
  if (!coverage || coverage.total === 0) return ''
  if (coverage.inForecast === coverage.total) return `全部 ${coverage.total} 天都有预报`
  return `${coverage.total} 天里 ${coverage.inForecast} 天在 ${FORECAST_HORIZON_DAYS} 天预报范围内`
})

const staleText = computed(() => {
  if (!stale.value) return ''
  const hours = Number.isFinite(ageHours.value) ? Math.round(ageHours.value) : null
  return hours === null ? '天气数据可能已过期' : `天气数据更新于 ${hours} 小时前，可能已过期`
})

/** '2026-10-01' → '10-01' */
function dayLabel(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date).slice(5) : String(date || '')
}

function fixed1(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—'
}

function fixed0(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : '—'
}

/** 未来 7 天模式下拉一行日期范围，让用户知道看的是哪几天 */
const rangeLabel = computed(() => {
  if (!showRange.value) return ''
  const days = plan.value?.days || []
  if (days.length === 0) return ''
  return `${dayLabel(days[0].date)} 至 ${dayLabel(days[days.length - 1].date)}`
})
</script>

<template>
  <section class="card stack-sm">
    <div class="row-between">
      <h2 class="section-title section-flush">假期出行准备</h2>
      <span class="chip" :class="statusChip.cls">{{ statusChip.text }}</span>
    </div>

    <!-- 骨架屏：取数时不要闪空布局 -->
    <div v-if="loading" class="stack-sm">
      <div class="skeleton skeleton-bar" />
      <div class="skeleton skeleton-card" />
    </div>

    <!-- 取数失败：说清楚，不白屏 -->
    <div v-else-if="plan.status === 'noWeather'" class="notice notice-error">
      天气数据没取到，暂时给不出出行准备清单。
      <span class="block tiny">{{ plan.message }}</span>
      <span class="block tiny">已有缓存的话会在这里显示上次结果；也可以到「设置」检查城市是否选对。</span>
    </div>

    <!-- 没有可预判的假期：本年已结束 / 次年待公布 -->
    <template v-else-if="plan.status === 'pending' || plan.status === 'none'">
      <div class="notice">
        {{ plan.message }}。
        <span v-if="plan.target?.newYear" class="block tiny">
          元旦是公历固定日期，在
          <span class="num trip-strong">{{ plan.target.newYear.days }}</span>
          天后；放假天数仍以官方公布为准。
        </span>
      </div>
      <p class="small muted">
        出行清单只用真实预报，而天气接口只覆盖未来 {{ FORECAST_HORIZON_DAYS }} 天。
        假期通常在几周之后，那时才拿得到当天的天气预报。
        这里不拿往年气候均值冒充预报——常年平均不等于那一天。
      </p>
      <div v-if="!showRange" class="stack-sm trip-cta">
        <button type="button" class="btn btn-sm trip-btn" @click="showRange = true">
          先看未来 {{ FORECAST_HORIZON_DAYS }} 天的出门准备
        </button>
        <span class="faint tiny">这部分是真实预报，不是假期</span>
      </div>
    </template>

    <!-- 假期存在但完全超出预报窗口 -->
    <template v-else-if="plan.status === 'tooFar'">
      <div class="notice">
        {{ plan.message }}。
        <span class="block tiny">
          {{ plan.target.holiday.name }} {{ dayLabel(plan.target.holiday.start) }} 起，
          共 {{ plan.target.length }} 天。
        </span>
      </div>
      <p class="small muted">
        等假期进入 {{ FORECAST_HORIZON_DAYS }} 天预报窗口后，这里会自动给出逐日的穿衣与雨具建议。
        在那之前只提示日期，不编造天气。
      </p>
      <div v-if="!showRange" class="stack-sm trip-cta">
        <button type="button" class="btn btn-sm trip-btn" @click="showRange = true">
          先看未来 {{ FORECAST_HORIZON_DAYS }} 天的出门准备
        </button>
      </div>
    </template>

    <!-- 正常：逐日建议 + 分组清单 -->
    <template v-else-if="plan.status === 'ok'">
      <div class="row-between trip-summary">
        <p class="small muted trip-summary-main">
          <template v-if="showRange">未来 {{ FORECAST_HORIZON_DAYS }} 天（{{ rangeLabel }}）的出门准备</template>
          <template v-else>
            {{ plan.target.holiday.name }} {{ dayLabel(plan.target.holiday.start) }} — {{ dayLabel(plan.target.holiday.end) }}，
            共 {{ plan.target.length }} 天
          </template>
        </p>
        <span class="faint tiny num trip-summary-note">{{ coverageText }}</span>
      </div>
      <p v-if="staleText" class="faint tiny">{{ staleText }}</p>

      <div class="day-list">
        <article v-for="day in plan.days" :key="day.date" class="day" :class="{ 'day-out': !day.inForecast }">
          <div class="day-head">
            <span class="day-date num">{{ dayLabel(day.date) }}</span>
            <span class="faint tiny">{{ day.weekday }}</span>
            <span v-if="day.inForecast" class="chip">{{ day.clothing.levelLabel }}</span>
            <span v-else class="chip chip-lv0">超出预报</span>
          </div>

          <template v-if="day.inForecast">
            <p class="small">{{ day.clothing.headline }}</p>
            <p class="faint tiny num">
              {{ fixed1(day.sample.tempMin) }}—{{ fixed1(day.sample.tempMax) }} ℃ ·
              降水 {{ fixed0(day.sample.precipProb) }}% ·
              风 {{ fixed1(day.sample.windSpeed) }} m/s
            </p>
            <p class="small muted">{{ day.umbrella.headline }}</p>
          </template>
          <p v-else class="small muted">
            {{ day.reason }}，临近再看。
          </p>
        </article>
      </div>

      <template v-if="totalItems > 0">
        <div class="divider" />
        <ActionList
          v-if="plan.checklist.outfit.length"
          :actions="plan.checklist.outfit"
          :storage-key="`${storageBase}:outfit`"
          title="衣物与随身装备（按这几天的温差全列出来）"
          dense
        />
        <ActionList
          v-if="plan.checklist.gear.length"
          :actions="plan.checklist.gear"
          :storage-key="`${storageBase}:gear`"
          :title="gearTitle"
          dense
        />
        <p class="faint tiny">
          清单由穿衣与带伞两条规则逐日跑出后汇总，共 {{ totalItems }} 项；勾选只存在本机。
        </p>
      </template>
    </template>

    <p v-if="showRange" class="faint tiny">
      <button type="button" class="btn-link" @click="showRange = false">回到假期视图</button>
    </p>

    <p class="faint tiny">
      逐日气温取当日逐小时均值（穿衣规则的体感公式吃的是当时气温，这里是按日均温估算）；
      降水概率与风速取当日最大值，按最坏时段判断要不要带伞。
    </p>
  </section>
</template>

<style scoped>
.section-flush {
  margin: 0;
}

.day-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.day {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2, var(--surface));
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.day-out {
  background: transparent;
  border-style: dashed;
}

.day-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.day-date {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.trip-strong {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.skeleton-bar {
  height: 14px;
  width: 60%;
}

.skeleton-card {
  height: 96px;
}

.btn-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  font-size: inherit;
  cursor: pointer;
  text-decoration: underline;
}

/* 按钮独占一行，避免和说明文字挤在同一行把文字压断 */
.trip-btn {
  white-space: nowrap;
}

/*
 * 信息行：宽屏左右分布，窄屏改成上下两行。
 * 不加这条的话，390px 下标题和「全部 7 天都有预报」会各自折成两行、互相挤。
 */
.trip-summary {
  flex-wrap: wrap;
  gap: 2px 12px;
}

.trip-summary-main {
  flex: 1 1 200px;
  margin: 0;
}

.trip-summary-note {
  white-space: nowrap;
}

@media (max-width: 430px) {
  .trip-summary {
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
  }

  /* 竖排时 flex-basis 会被当成高度，200px 会撑出一大块空白 */
  .trip-summary > * {
    flex: 0 0 auto;
  }

  .trip-summary-note {
    white-space: normal;
  }
}
</style>
