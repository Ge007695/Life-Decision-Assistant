/**
 * 出门模块 · 历史同期对比（O-11 / P2）
 *
 * 把今年未来 7 天预报，与去年同月同日那 7 天的实际记录逐日对齐。
 * 位置对齐（第 1 天对第 1 天）而不是按星期对齐：
 * 「同期」问的是「这个时候通常什么天气」，按日期对齐才是同一时节。
 *
 * 这个功能最容易骗人的地方在口径上，所以三条都写在这里：
 *   1. 去年那 7 天是**实际观测**（再分析数据），今年这 7 天是**预报**。
 *      拿预报与实况直接比，本身就有一层误差，页面上必须说明。
 *   2. 只有 7 天样本，不足以谈「气候」。说是「同期对比」，不是「气候变化趋势」。
 *   3. 去年某天缺数据（再分析也有空洞）时，那天的差值一律不给，
 *      不当成 0 参与平均。
 */

const DEFAULT_DAYS = 7

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function mean(list) {
  const nums = (Array.isArray(list) ? list : []).filter((value) => typeof value === 'number')
  if (nums.length === 0) return null
  return nums.reduce((sum, value) => sum + value, 0) / nums.length
}

function round1(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null
}

/**
 * 今年未来 N 天的预报（过滤掉接口带回来的过去日期）
 * @param {Array} daily weather.js 的 data.daily
 * @param {string} today YYYY-MM-DD
 * @param {number} days
 */
export function upcoming(daily, today, days = DEFAULT_DAYS) {
  const rows = (Array.isArray(daily) ? daily : []).filter((day) => day?.date && (!today || day.date >= today))
  return rows.slice(0, days)
}

/**
 * @param {{config?: object, forecastDaily: Array, historyDaily: Array, today: string, days?: number}} options
 */
export function buildHistory({ forecastDaily, historyDaily, today, days = DEFAULT_DAYS } = {}) {
  const thisDays = upcoming(forecastDaily, today, days)
  const lastDays = (Array.isArray(historyDaily) ? historyDaily : []).slice(0, days)

  const rows = []
  const count = Math.max(thisDays.length, lastDays.length)
  for (let i = 0; i < count; i += 1) {
    const now = thisDays[i] || null
    const last = lastDays[i] || null
    const thisMax = num(now?.tempMax)
    const lastMax = num(last?.tempMax)
    const thisMin = num(now?.tempMin)
    const lastMin = num(last?.tempMin)
    rows.push({
      index: i,
      thisDate: now?.date || '',
      lastDate: last?.date || '',
      thisMax,
      lastMax,
      thisMin,
      lastMin,
      // 今年预报的日级字段是降水概率 precipProb；去年归档给的是降水量 precip（mm）。
      // 两个不是一回事，字段名不能混用——混了会让「今年有几天雨」恒为 0。
      thisProb: num(now?.precipProb),
      lastPrecip: num(last?.precip),
      // 两边都有数据才给差值，缺一边就是 null，页面上显示「—」
      deltaMax: thisMax !== null && lastMax !== null ? round1(thisMax - lastMax) : null,
      deltaMin: thisMin !== null && lastMin !== null ? round1(thisMin - lastMin) : null,
    })
  }

  // 平均值只统计「两边都有值」的日子。
  // 各自独立求平均会在缺数据时出问题：今年 3 天、去年 1 天，两个均值相减比的是不同批日子，
  // 差值看着有数、实际没有意义。配对后再平均，差值是同一批日子的差。
  const paired = rows.filter((row) => row.thisMax !== null && row.lastMax !== null)

  const thisMaxes = paired.map((row) => row.thisMax)
  const lastMaxes = paired.map((row) => row.lastMax)
  const thisMins = paired.map((row) => row.thisMin)
  const lastMins = paired.map((row) => row.lastMin)

  // 降水：今年预报只有概率，去年归档是降水量，两者口径不同，所以分开统计：
  //   今年按「概率 ≥50% 记为有雨」，去年按「降水量 ≥0.1 mm 记为有雨」
  const thisRainDays = rows.filter((row) => typeof row.thisProb === 'number' && row.thisProb >= 50).length
  const lastRainDays = rows.filter((row) => typeof row.lastPrecip === 'number' && row.lastPrecip >= 0.1).length
  const lastPrecipSum = rows.reduce((sum, row) => (typeof row.lastPrecip === 'number' ? sum + row.lastPrecip : sum), 0)

  const summary = {
    thisAvgMax: round1(mean(thisMaxes)),
    lastAvgMax: round1(mean(lastMaxes)),
    thisAvgMin: round1(mean(thisMins)),
    lastAvgMin: round1(mean(lastMins)),
    thisRainDays,
    lastRainDays,
    lastPrecipSum: Math.round(lastPrecipSum * 10) / 10,
    thisCount: thisDays.length,
    lastCount: lastDays.length,
  }

  summary.deltaMax =
    summary.thisAvgMax !== null && summary.lastAvgMax !== null
      ? round1(summary.thisAvgMax - summary.lastAvgMax)
      : null
  summary.deltaMin =
    summary.thisAvgMin !== null && summary.lastAvgMin !== null
      ? round1(summary.thisAvgMin - summary.lastAvgMin)
      : null
  summary.deltaRainDays =
    thisDays.length > 0 && lastDays.length > 0 ? thisRainDays - lastRainDays : null

  return {
    rows,
    summary,
    status: thisDays.length === 0 || lastDays.length === 0 ? 'insufficient' : 'ok',
  }
}

/** 一句话结论：只陈述差异，不下「今年更热」这种气候判断 */
export function describe(summary) {
  if (!summary) return ''
  const parts = []
  if (summary.deltaMax !== null && Math.abs(summary.deltaMax) >= 0.5) {
    parts.push(`平均最高温${summary.deltaMax > 0 ? '高' : '低'} ${Math.abs(summary.deltaMax)} ℃`)
  }
  if (summary.deltaMin !== null && Math.abs(summary.deltaMin) >= 0.5) {
    parts.push(`平均最低温${summary.deltaMin > 0 ? '高' : '低'} ${Math.abs(summary.deltaMin)} ℃`)
  }
  if (summary.deltaRainDays !== null && summary.deltaRainDays !== 0) {
    parts.push(`有雨的天数${summary.deltaRainDays > 0 ? '多' : '少'} ${Math.abs(summary.deltaRainDays)} 天`)
  }
  if (parts.length === 0) return '和去年同期基本持平'
  return `和去年同期比，${parts.join('，')}`
}

export default { buildHistory, describe, upcoming, DEFAULT_DAYS }
