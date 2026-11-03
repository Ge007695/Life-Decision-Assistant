<script setup>
/**
 * 时间页 · 假期倒计时 / 年度日历 / 调休提醒 / 学期节点
 *
 * 页面只做排版与交互：日期类型来自 policy.buildYearGrid()，倒计时天数来自
 * policy.daysBetween()，假期结论来自内核 engine.run('holiday')。
 * 没有数据（status: 'pending'）时显示「待公布」，不推测、不白屏。
 */
import { computed, inject, ref } from 'vue'
import DecisionCard from '@/components/DecisionCard.vue'
import ActionList from '@/components/ActionList.vue'
import { run } from '@/core/engine.js'
import * as policy from '@/services/policy.js'
import { LEGEND, WEEKDAYS, withMeta, shortDate } from '@/modules/time/calendar.js'
import { buildCountdown, yearOf } from '@/modules/time/countdown.js'
import CalendarGrid from '@/modules/time/CalendarGrid.vue'
import TripPlan from '@/modules/time/TripPlan.vue'

const config = inject('config', {})

const today = policy.formatDate(new Date())
const todayYear = yearOf(today)

/** 可用年份：配置里有什么就列出什么，配置为空时至少保住今天所在年份 */
const years = computed(() => {
  const list = policy.availableYears(config)
  return list.length > 0 ? list : [todayYear]
})

const selectedYear = ref(years.value.includes(todayYear) ? todayYear : years.value[years.value.length - 1])

const yearNode = computed(() => policy.getYearNode(config, selectedYear.value))
const isPending = computed(() => yearNode.value.status === 'pending')
const isPartial = computed(() => yearNode.value.status === 'partial')

/** 倒计时始终针对「今天」所在年度：切到别的年份时不制造跨年假结论 */
const countdown = computed(() => buildCountdown(config, today))

/** 内核结论：入参按契约 { year, today }，无数据年份返回「待公布」而不抛异常 */
const holidayResult = computed(() => run('holiday', { year: todayYear, today }))

const months = computed(() => (isPending.value ? [] : withMeta(policy.buildYearGrid(selectedYear.value, yearNode.value))))

const makeupDates = computed(() => policy.makeupList(yearNode.value))
const makeupActions = computed(() =>
  makeupDates.value.map((date) => `${shortDate(date)}（${policy.weekdayLabel(date)}）补班`),
)
const makeupKey = computed(() => `checklist:makeup:${selectedYear.value}`)

const schoolTerms = computed(() => yearNode.value.schoolTerms || [])
const schoolNote = computed(() => yearNode.value.schoolTermsNote || '校历以深圳大学教务处公布为准')

const holidayCount = computed(() => (yearNode.value.holidays || []).length)
const source = computed(() => policy.policySource(yearNode.value))
const collectedAt = computed(() => yearNode.value.collectedAt || '')
const holidaysVersion = computed(() => config?.versions?.holidays || '—')
</script>

<template>
  <div class="page stack">
    <header class="row-between head">
      <div class="stack-sm">
        <h1 class="card-title">时间</h1>
        <p class="faint tiny">今天 {{ today }}（{{ policy.weekdayLabel(today) }}）· 假期与调休以国务院办公厅公布为准</p>
      </div>
    </header>

    <!-- 年份切换 -->
    <section class="card-flat stack-sm">
      <div class="row-between">
        <span class="card-sub">查看年份</span>
        <span v-if="isPending" class="chip chip-lv2">待公布</span>
        <span v-else-if="isPartial" class="chip chip-lv2">部分公布</span>
        <span v-else class="chip chip-lv4">已公布</span>
      </div>
      <div class="year-row" role="tablist" aria-label="年份切换">
        <button
          v-for="year in years"
          :key="year"
          type="button"
          role="tab"
          class="btn btn-sm year-btn"
          :class="{ 'btn-primary': year === selectedYear }"
          :aria-selected="year === selectedYear"
          @click="selectedYear = year"
        >
          {{ year }} 年
        </button>
      </div>
    </section>

    <!-- 待公布年份：整页只给一块说明，不显示空日历 -->
    <section v-if="isPending" class="card stack-sm">
      <div class="row-between">
        <h2 class="pending-title">{{ selectedYear }} 年安排待公布</h2>
        <span class="chip chip-lv2">待公布</span>
      </div>
      <p class="muted small">
        国务院办公厅一般在每年 11—12 月发布次年部分节假日安排，发布后更新
        <code>holidays.json</code> 即可生效。本页不用往年日期推算填充，避免把猜测当成政策。
      </p>

      <div class="divider" />

      <p class="card-sub">手工录入入口（占位）</p>
      <p class="small muted">
        后续版本支持逐条录入「假期名称 / 起始日期 / 结束日期 / 补班日期」，录入结果只保存在本机，
        并标注「手工录入」，不覆盖政策配置。
      </p>
      <div class="row">
        <button type="button" class="btn btn-sm" disabled>手工录入（待接入）</button>
        <span class="faint tiny">当前版本请等待官方公布后更新配置</span>
      </div>
    </section>

    <template v-else>
      <!-- T-1 假期倒计时 -->
      <template v-if="countdown.state === 'during' || countdown.state === 'upcoming'">
        <section class="card cd">
          <p class="cd-lead">{{ countdown.lead }}</p>
          <p class="cd-num">
            <span class="num">{{ countdown.days }}</span>
            <span class="cd-unit">天</span>
          </p>
          <p class="cd-detail small muted">{{ countdown.detail }}</p>
          <p v-if="countdown.crossYear" class="faint tiny">
            {{ countdown.name }}属于 {{ countdown.year }} 年，倒计时已跨年计算。
          </p>
        </section>

        <DecisionCard
          v-if="holidayResult"
          :result="holidayResult"
          title="假期结论"
          :show-actions="true"
          :show-evidence="true"
        />
      </template>

      <div v-else class="notice">
        {{ countdown.message }}
        <span class="block tiny">{{ countdown.detail }}</span>
        <span v-if="countdown.reference" class="block cd-ref small">
          参考：<span class="num cd-ref-num">{{ countdown.reference.days }}</span> 天后是
          {{ countdown.nextYear }} 年 1 月 1 日元旦（公历固定日期），放假天数仍以官方公布为准。
        </span>
      </div>

      <!-- T-2 年度日历 -->
      <section class="card stack-sm">
        <div class="row-between">
          <h2 class="section-title section-flush">{{ selectedYear }} 年日历</h2>
          <span class="faint tiny num">假期 {{ holidayCount }} 段 · 补班 {{ makeupDates.length }} 天</span>
        </div>
        <CalendarGrid :year="selectedYear" :months="months" :today="today" />
      </section>

      <!-- T-3 调休提醒 -->
      <section class="card stack-sm">
        <div class="row-between">
          <h2 class="section-title section-flush">调休提醒</h2>
          <span class="faint tiny num">{{ makeupActions.length }} 天</span>
        </div>
        <ActionList
          v-if="makeupActions.length"
          :actions="makeupActions"
          :storage-key="makeupKey"
          title="需要上班的补班日（勾选作为备忘）"
          dense
        />
        <p v-else class="muted small">本年度配置中没有补班日。</p>
        <p class="faint tiny">补班日与假期同源，来自 {{ source }}。</p>
      </section>
    </template>

    <!-- T-5 假期出行准备：跨模块联动，调内核穿衣与带伞规则 -->
    <TripPlan />

    <!-- T-4 学期节点 -->
    <section class="card stack-sm">
      <h2 class="section-title section-flush">学期节点</h2>
      <template v-if="schoolTerms.length">
        <ul class="stack-sm">
          <li v-for="term in schoolTerms" :key="term.name" class="row-between term">
            <span>{{ term.name }}</span>
            <span class="small muted num">
              {{ term.start }} — {{ term.end }}
            </span>
          </li>
        </ul>
      </template>
      <div v-else class="notice">
        校历数据待补录，以深圳大学教务处公布为准。
        <span class="block tiny">{{ schoolNote }}</span>
      </div>
    </section>

    <footer class="policy-foot stack-sm">
      <p class="faint tiny">政策依据：{{ source || '暂无来源记录' }}</p>
      <p v-if="collectedAt" class="faint tiny num">采集日期：{{ collectedAt }} · 假期配置版本 v{{ holidaysVersion }}</p>
      <p v-if="yearNode.sourceUrl" class="faint tiny break">
        原文链接：<a :href="yearNode.sourceUrl" target="_blank" rel="noopener">{{ yearNode.sourceUrl }}</a>
      </p>
      <p class="faint tiny">日历优先级：{{ LEGEND.map((item) => item.label).join(' > ') }}；每周从{{ WEEKDAYS[0] }}开始排列。</p>
    </footer>
  </div>
</template>

<style scoped>
.head {
  align-items: flex-start;
}

.section-flush {
  margin: 0;
}

.year-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.year-btn {
  min-width: 88px;
}

.pending-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

/* 倒计时大数字：一屏内最醒目的元素 */
.cd {
  background: var(--surface);
  border-left: 3px solid var(--lv1);
}

.cd-lead {
  font-size: 14px;
  color: var(--text-2);
}

.cd-num {
  display: flex;
  align-items: baseline;
  gap: 6px;
  line-height: 1.05;
  color: var(--lv1);
}

.cd-num .num {
  font-size: 62px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.cd-unit {
  font-size: 18px;
  font-weight: 600;
}

.cd-detail {
  margin-top: 4px;
}

.block {
  display: block;
  margin-top: 2px;
}

.cd-ref {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--line-strong);
}

.cd-ref-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}

.term {
  padding: 6px 0;
  border-bottom: 1px dashed var(--line);
}

.term:last-child {
  border-bottom: none;
}

.policy-foot {
  padding: 4px 2px 0;
}

.break {
  word-break: break-all;
}

@media (max-width: 420px) {
  .cd-num .num {
    font-size: 52px;
  }
}
</style>
