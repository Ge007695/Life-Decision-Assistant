<script setup>
/**
 * 出门模块 · 一周衣物准备（O-8 / P2）
 *
 * 只看当前城市的 7 天日级预报，把「每天穿什么」汇总成「要备几套」。
 * 日级数据从首页传进来——首页已经取过一次天气，这里不再重复请求。
 *
 * 组件不算件数、不查穿衣表：那些都在 core/rules/weeklyWear.js，
 * 页面只负责把 bands 画出来。
 */
import { computed, inject } from 'vue'
import ActionList from '@/components/ActionList.vue'
import { run } from '@/core/engine.js'
import { weekdayLabel } from '@/services/policy.js'

const props = defineProps({
  /** weather.js 的 data.daily，含过去 3 天（接口 past_days），需要自己筛掉 */
  daily: { type: Array, default: () => [] },
  /** 今天的本地日期 YYYY-MM-DD */
  today: { type: String, default: '' },
})

const config = inject('config', {})

const WEEK_DAYS = 7

/** 只取今天起的 7 天：接口带 past_days，不过滤会把昨天的气温算进打包清单 */
const weekDays = computed(() => {
  const today = props.today || new Date().toISOString().slice(0, 10)
  const rows = props.daily.filter((day) => day?.date && day.date >= today)
  return rows.slice(0, WEEK_DAYS)
})

const result = computed(() => {
  if (weekDays.value.length === 0) return null
  return run('weeklyWear', { days: weekDays.value }, config)
})

const bands = computed(() => result.value?.meta?.bands || [])
const coveredText = computed(() => {
  const meta = result.value?.meta
  if (!meta) return ''
  if (meta.covered === meta.total) return `全部 ${meta.total} 天都有预报`
  return `${meta.total} 天里 ${meta.covered} 天有数据`
})

/** 勾选状态按这一周的第一天隔离，跨周自动换新清单 */
const storageKey = computed(() => {
  const first = weekDays.value[0]?.date
  return first ? `checklist:weekly:${first}` : ''
})

const changeEvery = computed(() => result.value?.meta?.changeEvery ?? 2)
const maxPerBand = computed(() => result.value?.meta?.maxPerBand ?? 3)

/** '2026-11-05' → '11-05 周四' */
function dayShort(date) {
  const text = String(date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return `${text.slice(5)} ${weekdayLabel(text)}`
}
</script>

<template>
  <section class="card stack-sm">
    <div class="row-between">
      <h2 class="section-title section-flush">一周衣物准备</h2>
      <span v-if="result" class="chip" :class="result.degraded ? 'chip-lv1' : 'chip-lv4'">
        {{ result.levelLabel }}
      </span>
    </div>

    <p v-if="!result" class="small faint">未来一周的日级预报还没取到，暂时算不出要备几套。</p>

    <template v-else>
      <p class="small">{{ result.headline }}</p>
      <p v-if="coveredText" class="faint tiny">{{ coveredText }}</p>

      <div class="band-list">
        <article v-for="band in bands" :key="band.label" class="band">
          <div class="band-head">
            <span class="band-label">{{ band.label }}</span>
            <span class="faint tiny num">{{ band.days }} 天</span>
            <span class="num band-pieces">{{ band.pieces }} 套</span>
          </div>
          <p class="small muted band-outfit">{{ band.outfit }}</p>
          <p class="faint tiny num">{{ band.dates.map(dayShort).join('、') }}</p>
        </article>
      </div>

      <ActionList
        v-if="result.actions.length"
        :actions="result.actions"
        :storage-key="storageKey"
        title="打包清单"
        dense
      />

      <p class="faint tiny">
        按日均气温（当日最高与最低的中值）查穿衣表，不是体感温度——日级预报没有逐时湿度与风速。
        件数按 {{ changeEvery }} 天一换、同类最多 {{ maxPerBand }} 套估算，勾选只存在本机。
      </p>
    </template>
  </section>
</template>

<style scoped>
.section-flush {
  margin: 0;
}

.band-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.band {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2, var(--surface));
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.band-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.band-label {
  font-size: 15px;
  font-weight: 700;
}

/* 套数推到右端，扫一眼就能看到要带几套 */
.band-pieces {
  margin-left: auto;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.band-outfit {
  margin: 0;
}

@media (max-width: 430px) {
  .band-head {
    flex-wrap: wrap;
    gap: 4px 8px;
  }
}
</style>
