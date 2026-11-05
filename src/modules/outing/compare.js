/**
 * 出门模块 · 两地对比（O-10 / P2）
 *
 * 两个城市各跑一遍同样的四条规则，再逐项摆出来。
 * 这里不重写任何一条指数的算法——两地结论必须来自同一份代码，
 * 否则「深圳晾晒 82 分、广州 76 分」这种对比本身就没意义。
 *
 * 不判「哪个城市更好」：
 *   好坏取决于用户要干什么——要晒被子，晾晒分高的好；
 *   要跑步，体感舒适的好；要避雨，就看降水。给一个总分排名属于替用户做决定。
 *   所以只给差异事实（谁高谁低、差多少），结论留给用户。
 */

import { runBatch } from '../../core/engine.js'
import { buildWeatherInput, resolveIndoorTemp } from './weatherInput.js'

/** 对比的指数：与首页四条一致 */
export const COMPARE_INDICES = ['drying', 'damp', 'umbrella', 'clothing']

/** 逐项对比的当日指标；unit 用于拼出「高 3.2 ℃」这类文案 */
const METRICS = [
  { key: 'temp', label: '气温', unit: '℃', digits: 1, kind: 'number' },
  { key: 'humidity', label: '相对湿度', unit: '%', digits: 0, kind: 'number' },
  { key: 'precipProb', label: '降水概率', unit: '%', digits: 0, kind: 'percent' },
  { key: 'windSpeed', label: '风速', unit: 'm/s', digits: 1, kind: 'number' },
]

function pick(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatValue(value, digits) {
  if (value === null) return '—'
  return digits === 0 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
}

/** 差距文案：温度说「高 3.2 ℃」，概率说「高 35 个百分点」 */
function describeDelta(delta, metric) {
  if (delta === null || Math.abs(delta) < 0.05) return '持平'
  const direction = delta > 0 ? '高' : '低'
  const size = formatValue(Math.abs(delta), metric.digits)
  const unit = metric.kind === 'percent' ? ' 个百分点' : ` ${metric.unit}`
  return `${direction} ${size}${unit}`
}

/** 7 天预报的汇总：最高温、最低温、有降水的天数 */
function weekSummary(daily, today) {
  const rows = (Array.isArray(daily) ? daily : []).filter((day) => day?.date && (!today || day.date >= today))
  const week = rows.slice(0, 7)
  const maxes = week.map((day) => pick(day.tempMax)).filter((value) => value !== null)
  const mins = week.map((day) => pick(day.tempMin)).filter((value) => value !== null)
  const probs = week.map((day) => pick(day.precipProb)).filter((value) => value !== null)
  return {
    days: week.length,
    tempMax: maxes.length ? Math.max(...maxes) : null,
    tempMin: mins.length ? Math.min(...mins) : null,
    rainyDays: probs.filter((value) => value >= 50).length,
    probDays: probs.length,
  }
}

/** 一条指数在两个城市的结果，供并排展示 */
function compareIndices(config, weatherA, weatherB, settings) {
  const indoorTemp = resolveIndoorTemp(settings, config)
  const runOne = (weather) => {
    if (!weather) return []
    const input = buildWeatherInput(weather, { indoorTemp, feedbackOffset: 0 })
    return runBatch(COMPARE_INDICES, input, config)
  }

  const listA = runOne(weatherA)
  const listB = runOne(weatherB)

  return COMPARE_INDICES.map((id, index) => {
    const a = listA[index] || null
    const b = listB[index] || null
    return {
      id,
      label: config?.indices?.[id]?.label || id,
      a: a ? { level: a.level, label: a.levelLabel, score: a.score, degraded: a.degraded } : null,
      b: b ? { level: b.level, label: b.levelLabel, score: b.score, degraded: b.degraded } : null,
      // 差值只在两边都算出来时才有意义；一边降级就不给差值，免得拿假数比较
      delta:
        a && b && !a.degraded && !b.degraded ? Math.round((b.score - a.score) * 10) / 10 : null,
    }
  })
}

/**
 * @param {{config: object, left: {city: object, weather: object}, right: {city: object, weather: object}, settings?: object}} options
 */
export function buildCompare({ config, left, right, settings = {} } = {}) {
  const today = left?.weather?.date || right?.weather?.date || ''
  const weatherA = left?.weather || null
  const weatherB = right?.weather || null

  const metrics = METRICS.map((metric) => {
    const a = pick(weatherA?.[metric.key])
    const b = pick(weatherB?.[metric.key])
    const delta = a !== null && b !== null ? Math.round((b - a) * 10) / 10 : null
    return {
      key: metric.key,
      label: metric.label,
      unit: metric.unit,
      a: formatValue(a, metric.digits),
      b: formatValue(b, metric.digits),
      delta,
      deltaText: delta === null ? '' : describeDelta(delta, metric),
    }
  })

  const weekA = weekSummary(weatherA?.daily, today)
  const weekB = weekSummary(weatherB?.daily, today)
  const weekRows = [
    {
      key: 'tempMax',
      label: '7 天最高',
      unit: '℃',
      a: formatValue(weekA.tempMax, 0),
      b: formatValue(weekB.tempMax, 0),
      deltaText:
        weekA.tempMax !== null && weekB.tempMax !== null
          ? describeDelta(weekB.tempMax - weekA.tempMax, { unit: '℃', digits: 0 })
          : '',
    },
    {
      key: 'tempMin',
      label: '7 天最低',
      unit: '℃',
      a: formatValue(weekA.tempMin, 0),
      b: formatValue(weekB.tempMin, 0),
      deltaText:
        weekA.tempMin !== null && weekB.tempMin !== null
          ? describeDelta(weekB.tempMin - weekA.tempMin, { unit: '℃', digits: 0 })
          : '',
    },
    {
      key: 'rainyDays',
      // 标签要短：96px 的指标列放不下「降水概率 ≥50% 的天数」，会折成两行
      label: '有雨天数',
      unit: '天',
      a: weekA.probDays ? `${weekA.rainyDays}` : '—',
      b: weekB.probDays ? `${weekB.rainyDays}` : '—',
      deltaText:
        weekA.probDays && weekB.probDays
          ? weekB.rainyDays === weekA.rainyDays
            ? '持平'
            : `相差 ${Math.abs(weekB.rainyDays - weekA.rainyDays)} 天`
          : '',
    },
  ]

  // 最大差异项：只说事实，不说谁更好
  const candidates = metrics.filter((metric) => metric.delta !== null && Math.abs(metric.delta) > 0)
  const biggest = candidates.reduce(
    (acc, metric) => (!acc || Math.abs(metric.delta) > Math.abs(acc.delta) ? metric : acc),
    null,
  )

  const summary =
    left?.city && right?.city && biggest
      ? `${right.city.name}${biggest.label}比${left.city.name}${biggest.deltaText}`
      : ''

  return {
    left: { city: left?.city || null, weather: weatherA, week: weekA },
    right: { city: right?.city || null, weather: weatherB, week: weekB },
    metrics,
    weekRows,
    indices: compareIndices(config, weatherA, weatherB, settings),
    summary,
  }
}

export default { COMPARE_INDICES, buildCompare }
