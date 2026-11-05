#!/usr/bin/env node
/**
 * 验收标准逐条核对
 *
 * 把工作指导书里写明的验收口径变成可执行的断言，答辩时直接跑一遍：
 *   4.5 出门模块 / 5.3 时间模块 / 6.4 花钱模块 / 11.1 单元测试
 *
 * 运行：node scripts/verify-acceptance.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createConfig } from '../src/core/config.js'
import { configure, run } from '../src/core/engine.js'
import { buildDateMap, getYearNode } from '../src/services/policy.js'
import { buildTripPlan, shiftDate } from '../src/modules/time/tripPlan.js'
import { buildSchoolStatus, schoolTerms } from '../src/modules/time/countdown.js'
import { buildCompare } from '../src/modules/outing/compare.js'
import { buildHistory } from '../src/modules/outing/history.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'public', 'data')
const readJson = (file) => JSON.parse(readFileSync(join(DATA, file), 'utf8'))

const raw = {
  indices: readJson('indices.json'),
  holidays: readJson('holidays.json'),
  taxRules: readJson('tax-rules.json'),
  clothingTable: readJson('clothing-table.json'),
  cities: readJson('cities.json'),
  checklists: readJson('checklists.json'),
}
const config = createConfig(raw, { now: Date.now() })
configure(config)

const results = []
function check(id, title, passed, detail) {
  results.push({ id, title, passed, detail })
  const mark = passed ? '✓' : '✗'
  console.log(`  ${mark} [${id}] ${title}`)
  if (detail) console.log(`       ${detail}`)
}

const GOOD_WEATHER = {
  temp: 24.1,
  humidity: 60,
  windSpeed: 3.1,
  windDir: 'SE',
  precipProb: 10,
  solar: 520,
  hourly: Array.from({ length: 24 }, (_, i) => ({
    time: `${String(i).padStart(2, '0')}:00`,
    temp: 24,
    humidity: 60,
    windSpeed: 3,
    windDir: 'SE',
    precipProb: 10,
    solar: i >= 7 && i <= 18 ? 520 : 0,
  })),
}

console.log('=== 4.5 出门模块验收 ===')

// ① 配置生效：改权重，结论必须跟着变
const drying = run('drying', GOOD_WEATHER)
const patchedRaw = {
  ...raw,
  indices: {
    ...raw.indices,
    indices: {
      ...raw.indices.indices,
      drying: {
        ...raw.indices.indices.drying,
        weights: { temp: 0.2, humidity: 0.5, windSpeed: 0.2, precipProb: 0.05, solar: 0.05 },
      },
    },
  },
}
const patched = run('drying', GOOD_WEATHER, createConfig(patchedRaw))
check(
  '4.5-1',
  '手工改 drying 权重为 0.5，结论随之变化',
  drying.score !== patched.score,
  `默认 ${drying.score} 分 → 改权重后 ${patched.score} 分`,
)

// ② 依据可展开：evidence 必须带权重与贡献
const evOk =
  drying.evidence.length > 0 &&
  drying.evidence.some((item) => typeof item.weight === 'number') &&
  drying.evidence.some((item) => typeof item.contribution === 'number')
check(
  '4.5-2',
  '结论卡“依据”有内容，且每项带权重与贡献',
  evOk,
  `${drying.evidence.length} 项依据，例：${drying.evidence.find((e) => e.weight !== null)?.label} 权重 ${drying.evidence.find((e) => e.weight !== null)?.weight}`,
)

// ③ 断网降级：配置缺失时返回降级结论而不是抛异常
let degradeSafe = true
try {
  const lonely = run('drying', {})
  degradeSafe = typeof lonely.headline === 'string' && lonely.headline.length > 0
} catch {
  degradeSafe = false
}
check('4.5-3', '入参全缺失时不抛异常，返回可读的降级结论', degradeSafe, run('drying', {}).headline)

// ④ 边界高湿：湿度 84% 不得判为“适宜”
const humid = run('drying', { ...GOOD_WEATHER, humidity: 84 })
check(
  '4.5-4',
  '湿度 84%（其余晴好）不出现“适宜”',
  humid.level <= 3 && !humid.headline.includes('适合晾晒'),
  `${humid.score} 分 / ${humid.levelLabel}`,
)

console.log('\n=== 5.3 时间模块验收 ===')

// ① pending 年份不报错
let pendingSafe = true
let pendingText = ''
try {
  const result = run('holiday', { year: 2027, today: '2026-11-02' })
  pendingText = result.headline
  pendingSafe = result.headline.includes('待公布')
} catch (error) {
  pendingSafe = false
  pendingText = String(error)
}
check('5.3-1', '切到 2027（无数据）显示“待公布”而不是报错', pendingSafe, pendingText)

// ② 手改 makeupWorkdays，日历立即显示灰色补班日
const year2026 = getYearNode(config, 2026)
const withExtra = { ...year2026, makeupWorkdays: [...year2026.makeupWorkdays, '2026-11-07'] }
const mapBefore = buildDateMap(year2026)
const mapAfter = buildDateMap(withExtra)
check(
  '5.3-2',
  '手工往 makeupWorkdays 加一天，日历当天变为补班日',
  mapAfter['2026-11-07']?.type === 'makeup' && !mapBefore['2026-11-07'],
  `加之前 ${mapBefore['2026-11-07']?.type || '无记录'} → 加之后 ${mapAfter['2026-11-07']?.type}`,
)

// ③ 假期日正确标红（数据驱动查表）
check(
  '5.3-3',
  '国庆假期区间内每天都能查到 holiday 类型',
  mapBefore['2026-10-01']?.type === 'holiday' && mapBefore['2026-10-07']?.type === 'holiday',
  `10-01 ${mapBefore['2026-10-01']?.name} / 10-07 ${mapBefore['2026-10-07']?.name}`,
)

// ④ 调休优先于假期
check(
  '5.3-4',
  '调休上班日优先级高于周末与假期',
  mapBefore['2026-10-10']?.type === 'makeup',
  `2026-10-10 → ${mapBefore['2026-10-10']?.type}`,
)

// ⑤ T-5 假期出行清单：只在预报窗口内给建议（A 方案的核心约束）
function fakeForecast(start, days, override = {}) {
  const out = []
  for (let d = 0; d < days; d += 1) {
    const date = shiftDate(start, d)
    const day = override[d] || {}
    for (let h = 0; h < 24; h += 1) {
      out.push({
        time: `${date}T${String(h).padStart(2, '0')}:00`,
        temp: day.temp ?? 26,
        humidity: day.humidity ?? 60,
        windSpeed: day.windSpeed ?? 2,
        windDir: 'NNE',
        precipProb: day.precipProb ?? 10,
        solar: 0,
      })
    }
  }
  return out
}

const tripNear = buildTripPlan({ config, today: '2026-09-28', hourlyAll: fakeForecast('2026-09-28', 7) })
check(
  '5.3-5',
  'T-5：假期落在 7 天预报内时，逐日给出穿衣与带伞建议',
  tripNear.status === 'ok' &&
    tripNear.coverage.inForecast === 4 &&
    tripNear.days.every((day) => !day.inForecast || (day.clothing && day.umbrella)),
  `国庆 7 天里 ${tripNear.coverage.inForecast} 天有预报，其余标超出范围`,
)

const tripFar = buildTripPlan({ config, today: '2026-09-01', hourlyAll: fakeForecast('2026-09-01', 7) })
check(
  '5.3-6',
  'T-5：假期超出预报窗口时不给任何建议，不拿气候均值顶替',
  tripFar.status === 'tooFar' &&
    tripFar.days.every((day) => !day.inForecast) &&
    tripFar.checklist.outfit.length === 0 &&
    tripFar.checklist.gear.length === 0,
  tripFar.message,
)

const tripPending = buildTripPlan({ config, today: '2026-11-03', hourlyAll: fakeForecast('2026-11-03', 7) })
check(
  '5.3-7',
  'T-5：次年安排待公布时不报错、不产出清单',
  tripPending.status === 'pending' && tripPending.days.length === 0,
  tripPending.message,
)

const tripMixed = buildTripPlan({
  config,
  today: '2026-09-28',
  hourlyAll: fakeForecast('2026-09-28', 7, { 3: { precipProb: 95, windSpeed: 9 } }),
})
const mixedGear = tripMixed.checklist.gear
check(
  '5.3-8',
  'T-5：雨具清单按最坏一天汇总，「带伞」与「不用带伞」不同时出现',
  mixedGear.some((item) => item.includes('伞')) && !mixedGear.includes('不用带伞'),
  `按 ${tripMixed.checklist.worstDay} 准备：${mixedGear.join(' / ')}`,
)

// T-4 学期节点：指导书要求「距寒暑假还有几天，开学/放假日期」
const terms = schoolTerms(config)
const termNames = terms.map((term) => term.name)
const hasTerms = terms.length >= 4 && terms.some((term) => term.kind === 'break')
const schoolMid = buildSchoolStatus(config, '2026-11-05')
check(
  '5.3-9',
  'T-4：校历已录入开学与寒暑假日期，学期中能给出「距寒假还有几天」',
  hasTerms && schoolMid.state === 'inTerm' && Number.isFinite(schoolMid.days),
  `${termNames.join(' / ')}；2026-11-05 → ${schoolMid.lead}${schoolMid.days}天`,
)

const schoolGap = buildSchoolStatus(config, '2027-01-23')
const schoolOut = buildSchoolStatus(config, '2028-05-01')
check(
  '5.3-10',
  'T-4：学期末到假期之间的空档与校历范围之外都不报错，且不推测',
  schoolGap.days === 2 && schoolOut.state === 'unknown',
  `2027-01-23 空档给 ${schoolGap.days} 天；2028-05-01 → ${schoolOut.message}`,
)

console.log('\n=== 5.4 出门模块 P2 功能验收 ===')

const WEEK_DAYS = [
  { date: '2026-11-05', tempMax: 30, tempMin: 24 },
  { date: '2026-11-06', tempMax: 29, tempMin: 23 },
  { date: '2026-11-07', tempMax: 22, tempMin: 14 },
  { date: '2026-11-08', tempMax: 18, tempMin: 9 },
  { date: '2026-11-09', tempMax: 26, tempMin: 20 },
  { date: '2026-11-10', tempMax: 27, tempMin: 21 },
  { date: '2026-11-11', tempMax: 25, tempMin: 19 },
]
const wear = run('weeklyWear', { days: WEEK_DAYS })
check(
  '5.4-1',
  'O-8：7 天预报汇总成衣物件数清单，按穿衣档位分组并给套数',
  wear.actions.length > 0 && wear.meta.totalPieces > 0 && wear.meta.bands.length > 0,
  `${wear.meta.bands.length} 类穿搭共 ${wear.meta.totalPieces} 套：${wear.actions.join(' / ')}`,
)

const sportIdeal = run('sport', { temp: 18, humidity: 50, aqi: 30, uv: 1.5 })
const sportBad = run('sport', { temp: 18, humidity: 50, aqi: 220, uv: 9 })
const sportMissing = run('sport', { temp: 18, humidity: 50 })
check(
  '5.4-2',
  'O-9：温度/湿度/AQI/紫外线四维分项评分，空气差时降分，缺维度时降级并说明',
  sportIdeal.score > sportBad.score && sportMissing.degraded === true && sportIdeal.evidence.length >= 4,
  `理想 ${sportIdeal.score} 分 → 重污染+强紫外线 ${sportBad.score} 分；缺 AQI/UV 时 degraded=${sportMissing.degraded}`,
)

const cmpWeather = (temp, precipProb) => ({
  date: '2026-11-05',
  temp,
  humidity: 60,
  windSpeed: 2,
  precipProb,
  solar: 500,
  hourly: Array.from({ length: 12 }, (_, i) => ({
    time: `2026-11-05T${String(9 + i).padStart(2, '0')}:00`,
    temp: 26,
    humidity: 55,
    windSpeed: 3,
    windDir: 'S',
    precipProb,
    solar: 500,
  })),
  daily: [
    { date: '2026-11-05', tempMax: temp + 2, tempMin: temp - 4, precipProb },
    { date: '2026-11-06', tempMax: temp + 1, tempMin: temp - 5, precipProb },
  ],
})
const cmp = buildCompare({
  config,
  left: { city: { id: 'a', name: '深圳' }, weather: cmpWeather(26, 10) },
  right: { city: { id: 'b', name: '广州' }, weather: cmpWeather(30, 60) },
  settings: {},
})
check(
  '5.4-3',
  'O-10：两地并排对比，给出逐项差值与四项指数，且不评判哪边更好',
  cmp.metrics.length === 4 && cmp.indices.length === 4 && Boolean(cmp.summary) && !/更好|更优/.test(cmp.summary),
  cmp.summary,
)

const hist = buildHistory({
  forecastDaily: [
    { date: '2026-11-05', tempMax: 28, tempMin: 22, precipProb: 80 },
    { date: '2026-11-06', tempMax: 27, tempMin: 21, precipProb: 60 },
    { date: '2026-11-07', tempMax: 26, tempMin: 20, precipProb: 10 },
  ],
  historyDaily: [
    { date: '2025-11-05', tempMax: 25, tempMin: 18, precip: 0 },
    { date: '2025-11-06', tempMax: 26, tempMin: 19, precip: 3.2 },
    { date: '2025-11-07', tempMax: 24, tempMin: 17, precip: 0.4 },
  ],
  today: '2026-11-05',
})
check(
  '5.4-4',
  'O-11：历史同期逐日对齐，今年用降水概率、去年用降水量，口径分开统计',
  hist.status === 'ok' && hist.summary.thisRainDays === 2 && hist.summary.lastRainDays === 2,
  `今年 ${hist.summary.thisRainDays} 天有雨（概率≥50%）/ 去年 ${hist.summary.lastRainDays} 天有雨（≥0.1mm）`,
)

console.log('\n=== 6.4 花钱模块验收 ===')
const PLAN = { principal: 6000, periods: 12, feeRate: 0.6 }
const inst = run('installment', PLAN)
const annual = inst.meta?.annualRate ?? NaN
const nominal = 0.6 * 12 // 名义：每期费率 × 12 期

check(
  '6.4-1',
  '本金 6000 / 12 期 / 每期 0.6%，真实年化明显高于名义 7.2%',
  Number.isFinite(annual) && annual * 100 > nominal * 1.3,
  `真实年化 ${(annual * 100).toFixed(2)}% vs 名义 ${nominal.toFixed(1)}%，约 ${(annual * 100 / nominal).toFixed(1)} 倍`,
)

const methods = inst.meta?.methods || inst.meta?.comparison || []
const rates = methods.map((m) => (m.annualRate ?? m.rate) * 100)
const spread = rates.length > 1 ? Math.max(...rates) - Math.min(...rates) : Infinity
const iterations = methods.map((m) => m.iterations)
const iterDistinct = new Set(iterations).size === iterations.length

check(
  '6.4-2',
  '三种算法结果差 < 0.01 个百分点，但迭代次数不同',
  spread < 0.01 && iterDistinct,
  methods.map((m) => `${m.method} ${m.iterations} 次`).join(' / ') + `，极差 ${spread.toFixed(4)} 个百分点`,
)

const badCases = [
  ['期数为 0', { principal: 6000, periods: 0, feeRate: 0.6 }],
  ['负本金', { principal: -100, periods: 12, feeRate: 0.6 }],
  ['费率为负', { principal: 6000, periods: 12, feeRate: -1 }],
]
const badResults = badCases.map(([label, input]) => {
  let text = ''
  let safe = true
  try {
    const result = run('installment', input)
    text = result.headline
    safe = !/NaN|undefined|Infinity/.test(result.headline) && result.headline.length > 0
  } catch (error) {
    safe = false
    text = String(error)
  }
  return { label, text, safe }
})
check(
  '6.4-3',
  '非法输入（0 期、负本金、负费率）有友好提示，不显示 NaN',
  badResults.every((item) => item.safe),
  badResults.map((item) => `${item.label}：${item.text}`).join(' | '),
)

const salary = run('salary', { gross: 6000, mode: 'service' })
const hasDisclaimer = [...salary.actions, ...salary.evidence.map((e) => e.value)].some((text) =>
  String(text).includes('以税务部门年度汇算为准'),
)
check(
  '6.4-4',
  '工资测算给出“本结果为估算”的免责说明',
  hasDisclaimer,
  salary.headline,
)

console.log('\n=== 11.2 配置校验 ===')
check('11.2-1', '六份配置零错误', config.errors.length === 0, config.errors.join('；') || '无错误')

const brokenWeights = createConfig({
  ...raw,
  indices: {
    ...raw.indices,
    indices: {
      ...raw.indices.indices,
      drying: { ...raw.indices.indices.drying, weights: { temp: 0.9, humidity: 0.9, windSpeed: 0, precipProb: 0, solar: 0 } },
    },
  },
})
check(
  '11.2-2',
  '权重之和不为 1 时被拦下，不静默降级',
  brokenWeights.errors.some((error) => error.includes('权重之和')),
  brokenWeights.errors.find((error) => error.includes('权重之和')) || '（未拦下）',
)

const brokenRange = createConfig({
  ...raw,
  indices: {
    ...raw.indices,
    indices: {
      ...raw.indices.indices,
      drying: {
        ...raw.indices.indices.drying,
        normalize: { ...raw.indices.indices.drying.normalize, temp: [20, 20] },
      },
    },
  },
})
check(
  '11.2-3',
  'normalize 区间两端相等时被拦下',
  brokenRange.errors.some((error) => error.includes('两端不能相等')),
  brokenRange.errors.find((error) => error.includes('两端不能相等')) || '（未拦下）',
)

const passed = results.filter((item) => item.passed).length
console.log(`\n=== 汇总：${passed} / ${results.length} 项通过 ===`)
if (passed !== results.length) {
  console.log('未通过项：')
  for (const item of results.filter((entry) => !entry.passed)) {
    console.log(`  - [${item.id}] ${item.title}（${item.detail}）`)
  }
  process.exitCode = 1
}
