/**
 * 内核层 · 返潮预警（P0）
 *
 * 深圳回南天不是“湿度高”这么简单：必须同时满足
 *   ① 空气的露点已经贴近室内表面温度（水汽一碰冷表面就结露）
 *   ② 高湿持续时间足够长（潮湿空气不断补进来，而不是一阵子）
 *   ③ 有持续的偏南风把海上水汽送进来
 * 三条缺一条都不构成返潮，所以这里不做加权求和，而是数命中条数。
 *
 * 阈值全部来自 indices.json#damp.thresholds，代码只负责比较。
 * 等级反向：3 条全中 → level 1（最差），0 条 → level 4（最安全），
 * 与契约“对用户越好分越高”一致；levels 的 min 就是命中条数，直接复用 pickLevel。
 */

import { dewPoint, toFinite } from '../utils/dewpoint.js'
import { pickLevel, round } from '../utils/normalize.js'

export const id = 'damp'
export const version = '1.0.0'

const TIME_RE = /(\d{1,2}):(\d{2})/

/** 从 "09:00" / "2026-11-02T09:00" 里取小时数，取不到返回 null */
function hourOf(text) {
  const match = TIME_RE.exec(String(text || ''))
  return match ? Number(match[1]) % 24 : null
}

/** 取第一个有效数值，用于“优先 indoorTemp，其次 pastMinTemp72h，最后兜底值” */
function firstFinite(...values) {
  for (const value of values) {
    const num = toFinite(value)
    if (num !== null) return num
  }
  return null
}

/**
 * 统计“相对湿度 ≥ 阈值”的最长连续小时数。
 *
 * 为什么要求时间连续：hourly 序列可能缺小时（接口丢数据），
 * 把 0 点、3 点、6 点三个高湿点当成连续 3 小时会高估返潮风险，
 * 所以相邻两条的时间必须正好差 1 小时；时间字段缺失时按“已排序逐小时”信任。
 *
 * @param {Array} hourly 逐小时序列
 * @param {number} humidityMin 湿度阈值
 * @returns {number} 最长连续小时数
 */
export function humidityStreak(hourly, humidityMin) {
  if (humidityMin === null) return 0
  const list = Array.isArray(hourly) ? hourly : []
  let best = 0
  let current = 0
  let prevHour = null

  for (const hour of list) {
    const rh = toFinite(hour?.humidity)
    const hourNum = hourOf(hour?.time)
    const continuous = prevHour === null || hourNum === null || (hourNum - prevHour + 24) % 24 === 1

    if (rh !== null && rh >= humidityMin) {
      current = continuous ? current + 1 : 1
    } else {
      current = 0
    }
    best = Math.max(best, current)
    prevHour = hourNum
  }

  return best
}

/** 按等级给可执行动作，文案与 indices.json 的等级用语对应 */
function actionsFor(level) {
  if (level <= 1) {
    return [
      '立刻关闭朝南、东南方向的窗户，隔断水汽来源',
      '开除湿机或空调除湿模式，别开窗“通风”',
      '地面墙面出现水珠马上擦干，防止打滑和霉斑',
      '衣物改室内烘干，别挂在阳台',
    ]
  }
  if (level === 2) {
    return ['关小朝南窗户，减少水汽进入', '开除湿机或空调除湿模式', '拖地后及时擦干，门口放吸水垫']
  }
  if (level === 3) {
    return ['留意朝南墙面与地板是否发潮', '湿度继续上升就关窗开除湿', '被子衣物先别拿到阳台晾']
  }
  return ['正常开窗通风即可', '暂不需要除湿']
}

/** 数据不足时的结论：明确说“判不了”，而不是硬给一个“无风险” */
function degradedResult(message, evidence = []) {
  return {
    level: 0,
    levelLabel: '数据不足',
    score: 0,
    headline: message,
    actions: ['补齐气温、湿度、风向风速后重新判断'],
    evidence,
    degraded: true,
  }
}

/**
 * @param {object} input {temp, humidity, windDir, windSpeed, hourly[], pastMinTemp72h, indoorTemp}
 * @param {object} ctx { config, index }
 */
export function evaluate(input = {}, ctx = {}) {
  const indexNode = ctx.index
  const thresholds = indexNode?.thresholds || {}
  const levels = indexNode?.levels || []

  const temp = toFinite(input.temp)
  const humidity = toFinite(input.humidity)
  const windSpeed = toFinite(input.windSpeed)
  const windDir = typeof input.windDir === 'string' ? input.windDir.toUpperCase() : null

  const margin = toFinite(thresholds.dewpointMargin)
  const humidityMin = toFinite(thresholds.humidityMin)
  const hoursRequired = toFinite(thresholds.humidityHours)
  const windMin = toFinite(thresholds.windSpeedMin)
  const windDirs = Array.isArray(thresholds.windDirs)
    ? thresholds.windDirs.map((item) => String(item).toUpperCase())
    : []

  // 室内表面温度没有实测，按配置约定依次退化：实测 > 过去 72 小时最低气温 > 默认值
  const indoorTemp = firstFinite(input.indoorTemp, input.pastMinTemp72h, thresholds.indoorTempDefault)
  const dew = dewPoint(temp, humidity)

  if (dew === null || indoorTemp === null || margin === null) {
    return degradedResult('缺少气温或湿度，无法计算露点，返潮风险暂不判定')
  }

  // 条件①：露点是否逼近室内表面温度
  const dewThreshold = indoorTemp - margin
  const dewHit = dew >= dewThreshold

  // 条件②：高湿是否持续足够久；没有 hourly 时只能用当前一个观测点，
  // 单点永远凑不满 6 小时，等同于“不能确认持续高湿”
  const streak =
    Array.isArray(input.hourly) && input.hourly.length > 0
      ? humidityStreak(input.hourly, humidityMin)
      : humidity !== null && humidityMin !== null && humidity >= humidityMin
        ? 1
        : 0
  const humidityHit = hoursRequired !== null && streak >= hoursRequired

  // 条件③：风向是否偏南且风速够大
  const windDirHit = windDir !== null && windDirs.includes(windDir)
  const windSpeedHit = windSpeed !== null && windMin !== null && windSpeed >= windMin
  const windHit = windDirHit && windSpeedHit

  const conditions = [
    {
      key: 'dewpoint',
      label: '露点贴近室内表面',
      hit: dewHit,
      ratio: dewHit ? 1 : 0,
      value: `露点 ${round(dew, 1)} ℃，判定线 ${round(dewThreshold, 1)} ℃（室内 ${round(indoorTemp, 1)} ℃ − 余量 ${round(margin, 1)} ℃）`,
    },
    {
      key: 'humidity',
      label: '持续高湿',
      hit: humidityHit,
      ratio: hoursRequired > 0 ? round(Math.min(1, streak / hoursRequired), 3) : 0,
      value:
        humidityMin === null || hoursRequired === null
          ? '缺少湿度阈值或持续时长配置，该条件不参与判定'
          : `连续 ${streak} 小时 ≥ ${round(humidityMin, 0)}%，要求 ${round(hoursRequired, 0)} 小时`,
    },
    {
      key: 'wind',
      label: '偏南风且风速够',
      hit: windHit,
      ratio: windHit ? 1 : 0,
      value:
        windDir === null || windSpeed === null
          ? '缺少风向或风速'
          : `${windDir} ${round(windSpeed, 1)} m/s（要求 ${windDirs.join('/') || '—'} 且 ≥ ${round(windMin ?? 0, 1)} m/s）`,
    },
  ]

  const hitCount = conditions.filter((item) => item.hit).length
  const levelHit = pickLevel(hitCount, levels)

  // 分数按命中条数线性折算：命中越多分越低，保证排序与等级同向
  const score = round((1 - hitCount / conditions.length) * 100, 1)
  const weight = round(1 / conditions.length, 3)

  const evidence = conditions.map((item) => ({
    key: item.key,
    label: item.label,
    value: `${item.hit ? '命中' : '未命中'}：${item.value}`,
    weight,
    contribution: round(item.hit ? weight : 0, 3),
    ratio: item.ratio,
    hit: item.hit,
  }))

  const missing = [
    temp === null ? '气温' : null,
    humidity === null ? '湿度' : null,
    windDir === null ? '风向' : null,
    windSpeed === null ? '风速' : null,
  ].filter(Boolean)

  return {
    level: levelHit.level,
    levelLabel: levelHit.label,
    score,
    headline: levelHit.headline,
    actions: actionsFor(levelHit.level),
    evidence,
    ...(missing.length > 0 ? { degraded: true } : {}),
    meta: {
      hitCount,
      conditions: conditions.map((item) => ({ key: item.key, hit: item.hit, value: item.value })),
      dewPoint: round(dew, 2),
      indoorTemp: round(indoorTemp, 2),
      humidityStreak: streak,
      missing,
      configVersion: indexNode?.version || null,
    },
  }
}
