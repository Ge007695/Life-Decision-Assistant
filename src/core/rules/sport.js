/**
 * 内核层 · 运动适宜度（O-9 / P2）
 *
 * 四个维度各自打分再加权，不是直接对原始值做归一化——这是本规则和
 * drying / umbrella 最不一样的地方，原因在温度上：
 *   晾晒分越高越干爽，降水概率越低越好，都是单调的；
 *   但运动适宜度里的气温是「中间最好」——18 ℃ 适宜，-3 ℃ 和 35 ℃ 都不适宜。
 *   normalize(value, [劣端, 优端]) 是线性单调映射，喂进去会把 18 ℃ 判成中间分。
 *   所以先把每个维度折成分项分（0—100），再按权重合成。
 *
 * 缺失维度的处理与 weightedScore 一致：按剩余权重重新归一，
 * 并在 evidence 里标 `missing`，不让「没取到 AQI」变成「空气差」。
 *
 * 阈值全部放 indices.json：AQI 和紫外线是分档表，气温湿度是舒适区间 + 每度扣分，
 * 换一套标准（比如改按中国 AQI 分级）只改配置。
 */

import { clamp, pickLevel, round } from '../utils/normalize.js'
import { toFinite } from '../utils/dewpoint.js'

export const id = 'sport'
export const version = '1.0.0'

/**
 * 区间型维度（气温、湿度）：落在 [idealMin, idealMax] 内满分，
 * 偏离每单位扣 penalty，扣到 0 为止。
 */
function scoreByIdeal(value, spec) {
  if (value === null) return { score: null, detail: null }
  const min = Number(spec?.idealMin)
  const max = Number(spec?.idealMax)
  const penalty = Number(spec?.penaltyPerDegree)
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(penalty)) {
    return { score: null, detail: null }
  }
  let deviation = 0
  if (value < min) deviation = min - value
  else if (value > max) deviation = value - max
  const score = clamp(100 - deviation * penalty, 0, 100)
  const direction = value < min ? 'low' : value > max ? 'high' : 'ideal'
  return { score: round(score, 1), detail: { deviation: round(deviation, 1), direction, min, max } }
}

/** 分档型维度（AQI、紫外线）：取第一个 value <= max 的档，跳出范围用最后一档 */
function scoreByBands(value, bands) {
  if (value === null) return null
  const list = Array.isArray(bands) ? bands : []
  if (list.length === 0) return null
  for (const band of list) {
    if (value <= band.max) return band
  }
  return list[list.length - 1]
}

/**
 * @param {object} input {temp, humidity, aqi, uv}
 * @param {object} ctx {config, index}
 */
export function evaluate(input = {}, ctx = {}) {
  const node = ctx.index
  const thresholds = node?.thresholds || {}
  const weights = node?.weights || {}

  const temp = toFinite(input.temp)
  const humidity = toFinite(input.humidity)
  const aqi = toFinite(input.aqi)
  const uv = toFinite(input.uv)

  const tempPart = scoreByIdeal(temp, thresholds.temp)
  const humidityPart = scoreByIdeal(humidity, thresholds.humidity)
  const aqiBand = scoreByBands(aqi, thresholds.aqi?.bands)
  const uvBand = scoreByBands(uv, thresholds.uv?.bands)

  /** 四个维度的原始分，null 表示这项没数据 */
  const dimensions = [
    { key: 'temp', label: '气温', value: temp, unit: '℃', score: tempPart.score, extra: tempPart.detail },
    { key: 'humidity', label: '湿度', value: humidity, unit: '%', score: humidityPart.score, extra: humidityPart.detail },
    { key: 'aqi', label: '空气质量', value: aqi, unit: '', score: aqiBand ? aqiBand.score : null, band: aqiBand },
    { key: 'uv', label: '紫外线', value: uv, unit: '', score: uvBand ? uvBand.score : null, band: uvBand },
  ]

  const present = dimensions.filter((item) => typeof item.score === 'number' && Number.isFinite(item.score))
  const missing = dimensions.filter((item) => !present.includes(item))
  const weightTotal = present.reduce((sum, item) => sum + (Number(weights[item.key]) || 0), 0)

  const evidence = []
  const actions = []
  let score = 0

  for (const item of present) {
    const rawWeight = Number(weights[item.key]) || 0
    // 权重按「现存维度」重新归一：缺 AQI 时不该按 30% 的空缺直接扣分
    const effectiveWeight = weightTotal > 0 ? rawWeight / weightTotal : 0
    const contribution = (item.score / 100) * effectiveWeight
    score += contribution

    let display = '缺失'
    if (typeof item.value === 'number') {
      display = item.unit ? `${round(item.value, 1)} ${item.unit}` : `${round(item.value, 1)}`
    }
    if (item.band?.label) display += `（${item.band.label}）`

    evidence.push({
      key: item.key,
      label: item.label,
      value: display,
      weight: round(effectiveWeight, 3),
      contribution: round(contribution, 3),
      ratio: round(item.score / 100, 3),
    })

    if (item.band?.advice) actions.push(item.band.advice)
    if (item.key === 'temp' && item.extra) {
      if (item.extra.direction === 'high' && thresholds.temp?.tooHotAdvice) {
        actions.push(thresholds.temp.tooHotAdvice)
      }
      if (item.extra.direction === 'low' && thresholds.temp?.tooColdAdvice) {
        actions.push(thresholds.temp.tooColdAdvice)
      }
    }
    if (item.key === 'humidity' && item.extra) {
      if (item.extra.direction === 'high' && thresholds.humidity?.tooHumidAdvice) {
        actions.push(thresholds.humidity.tooHumidAdvice)
      }
      if (item.extra.direction === 'low' && thresholds.humidity?.tooDryAdvice) {
        actions.push(thresholds.humidity.tooDryAdvice)
      }
    }
  }

  for (const item of missing) {
    evidence.push({
      key: item.key,
      label: item.label,
      value: '缺失',
      weight: round(Number(weights[item.key]) || 0, 3),
      contribution: 0,
      ratio: null,
      missing: true,
    })
  }

  const finalScore = round(score * 100, 1)

  // 一个维度都没取到：按数据不足返回，不给「适宜运动」这种无依据结论
  if (present.length === 0) {
    return {
      level: 0,
      levelLabel: '数据不足',
      score: 0,
      headline: '气温、湿度、空气质量与紫外线都没取到，暂时无法判断运动适宜度',
      actions: [],
      evidence,
      degraded: true,
      meta: { dimensions, missing: missing.map((item) => item.key), weightTotal },
    }
  }

  const levelInfo = pickLevel(finalScore, node?.levels || [])
  // 分最低的那一项才是用户真正需要知道的，headline 必须点名
  const weakest = present.reduce((acc, item) => (!acc || item.score < acc.score ? item : acc), null)
  const weakestText = weakest && weakest.score < 80 ? `，主要受${weakest.label}影响` : ''
  // 缺维度时不能只说「适合户外运动」：AQI 没取到就断言空气没问题，是替接口打包票
  const missingNote =
    missing.length > 0 ? `（${missing.map((item) => item.label).join('、')}未取到，结论不完整）` : ''

  return {
    level: levelInfo.level,
    levelLabel: levelInfo.label,
    score: finalScore,
    headline: `${levelInfo.headline || levelInfo.label}${weakestText}${missingNote}`,
    actions: [...new Set(actions.filter(Boolean))],
    evidence,
    degraded: missing.length > 0,
    meta: {
      dimensions,
      missing: missing.map((item) => item.key),
      weightTotal: round(weightTotal, 3),
      weakest: weakest?.key || null,
    },
  }
}

export default { id, version, evaluate }
