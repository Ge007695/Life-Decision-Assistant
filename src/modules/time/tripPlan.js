/**
 * 时间模块 · 假期出行准备清单（T-5）
 *
 * 这是工作指导书 8.2 跨模块联动的第一条：时间模块选中假期后，
 * 调内核的 clothing / umbrella 两条规则，把结论拼成可勾选的出行清单。
 *
 * 为什么不在本文件里重算体感温度或带伞判断：
 *   跨模块只能消费对方结论，不能复制对方的算法。复制一份以后，
 *   内核改了阈值这边不会跟着变，两边结论迟早对不上。
 *
 * 关于「多远能预测」——这是本功能的设计前提，必须写在代码里：
 *   天气接口只给未来 7 天逐小时预报。假期往往在数周之后，
 *   拿不到那几天的真实天气。因此本模块**只对预报范围内的日子给建议**，
 *   超出范围的日子显式写「临近再看」。
 *   不用往年气候均值填空：那是常年平均，不是预报，
 *   混在一起会让用户以为「系统知道那天会下雨」，属于过度承诺。
 */

import { run } from '../../core/engine.js'
import { daysBetween, formatDate, getYearNode, nextHoliday, weekdayLabel } from '../../services/policy.js'

/**
 * 预报窗口天数。
 * 与 services/weather.js 的 forecast_days 保持一致——那边改了这里要同步，
 * 否则文案会说「7 天内可预判」但实际只有 5 天数据。
 */
export const FORECAST_HORIZON_DAYS = 7

/** 逐日清单最多展示几天（避免长假把页面拉得过长；14 天足够覆盖调休长假） */
const MAX_PLAN_DAYS = 14

function numbers(list) {
  return (Array.isArray(list) ? list : []).filter((value) => typeof value === 'number' && Number.isFinite(value))
}

function mean(list) {
  const nums = numbers(list)
  if (nums.length === 0) return null
  return nums.reduce((sum, value) => sum + value, 0) / nums.length
}

function maxOf(list) {
  const nums = numbers(list)
  return nums.length === 0 ? null : Math.max(...nums)
}

function minOf(list) {
  const nums = numbers(list)
  return nums.length === 0 ? null : Math.min(...nums)
}

function isDateText(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(text || ''))
}

/**
 * 把逐小时序列按本地日期分组。
 * 直接切字符串前 10 位，不做时区换算——接口已用 timezone=Asia/Shanghai 返回本地时间。
 *
 * @param {Array} hourlyAll weather.js 的 data.hourlyAll
 * @returns {Map<string, Array>} 'YYYY-MM-DD' → 该日逐小时
 */
export function groupByDate(hourlyAll) {
  const map = new Map()
  for (const hour of hourlyAll || []) {
    const date = String(hour?.time || '').slice(0, 10)
    if (!isDateText(date)) continue
    if (!map.has(date)) map.set(date, [])
    map.get(date).push(hour)
  }
  return map
}

/**
 * 把一天的逐小时压成一个可喂给规则的样本。
 *
 * 聚合口径（每条都有理由，换口径会改变结论）：
 *   temp      逐小时气温均值。clothing 的体感公式吃的是「当时气温」，
 *             这里拿日均温近似，页面上必须标注「按日均温估算」。
 *   humidity  均值。
 *   windSpeed 当日最大值。判断「要不要带伞」要看最坏时段，
 *             用均值会把午后阵风抹平，得出「不用带伞」的错误结论。
 *   precipProb 当日最大值，同上。
 *   solar     均值，本模块不用，留给以后接晾晒类建议。
 *
 * @param {string} date
 * @param {Array} hours
 * @returns {object|null} 无有效数据时返回 null
 */
export function summariseDay(date, hours) {
  const list = Array.isArray(hours) ? hours : []
  if (list.length === 0) return null

  const temps = list.map((hour) => hour.temp)
  const humidity = mean(list.map((hour) => hour.humidity))
  const windSpeed = maxOf(list.map((hour) => hour.windSpeed))
  const precipProb = maxOf(list.map((hour) => hour.precipProb))

  const temp = mean(temps)
  // 气温与湿度缺一项，体感温度就算不出来；降水概率与风速缺一项，
  // 带伞结论也没有意义。任一缺失都按「这天没数据」处理，不硬凑。
  if (temp === null || humidity === null || windSpeed === null || precipProb === null) return null

  return {
    date,
    weekday: weekdayLabel(date),
    temp,
    tempMax: maxOf(temps),
    tempMin: minOf(temps),
    humidity,
    windSpeed,
    precipProb,
    solar: mean(list.map((hour) => hour.solar)),
    hourCount: list.length,
  }
}

/** 展开假期覆盖的每一天（含首尾），最多 MAX_PLAN_DAYS 天 */
export function holidayDates(holiday) {
  if (!holiday?.start || !holiday?.end) return []
  const span = daysBetween(holiday.start, holiday.end)
  if (span === null || span < 0) return []
  const dates = []
  for (let i = 0; i <= Math.min(span, MAX_PLAN_DAYS - 1); i += 1) {
    dates.push(shiftDate(holiday.start, i))
  }
  return dates
}

/** 'YYYY-MM-DD' 加 n 天，返回同格式（用 Date 做，避免月份天数手写） */
export function shiftDate(dateText, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ''))
  if (!match) return ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

/**
 * 找「这次要给出行清单的假期」。
 *
 * 四步，每一步都不猜：
 *   1. 本年还有未结束的假期 → 就用它（含正在进行中的）
 *   2. 本年结束但次年已公布 → 用次年第一个假期，并标 crossYear
 *   3. 次年待公布 → status: 'pending'，不给任何日期推断
 *      （元旦是公历固定日期，可以给一个参考天数，但放假天数仍以公布为准）
 *   4. 配置里两年都没有 → status: 'none'
 *
 * @param {object} config 已校验配置
 * @param {string} today YYYY-MM-DD
 */
export function resolveTarget(config, today = formatDate(new Date())) {
  const year = Number(String(today).slice(0, 4))
  if (!Number.isInteger(year)) {
    return { status: 'none', year: null, holiday: null, note: '日期无效，无法判断假期' }
  }

  const node = getYearNode(config, year)
  const holiday = node.status === 'pending' ? null : nextHoliday(node, today)

  if (holiday) {
    const daysUntil = daysBetween(today, holiday.start)
    const length = (daysBetween(holiday.start, holiday.end) ?? 0) + 1
    return {
      status: 'ok',
      year,
      holiday,
      ongoing: holiday.start <= today && today <= holiday.end,
      daysUntil: Math.max(daysUntil ?? 0, 0),
      length,
      crossYear: false,
      note: '',
    }
  }

  const nextYear = year + 1
  const nextNode = getYearNode(config, nextYear)
  const nextList = [...(nextNode.holidays || [])].sort((a, b) => a.start.localeCompare(b.start))

  if (nextNode.status !== 'pending' && nextList.length > 0) {
    const first = nextList[0]
    const daysUntil = daysBetween(today, first.start)
    return {
      status: 'ok',
      year: nextYear,
      holiday: first,
      ongoing: false,
      daysUntil: Math.max(daysUntil ?? 0, 0),
      length: (daysBetween(first.start, first.end) ?? 0) + 1,
      crossYear: true,
      note: `${first.name}属于 ${nextYear} 年，倒计时已跨年计算。`,
    }
  }

  const newYearDate = `${nextYear}-01-01`
  const newYearDays = daysBetween(today, newYearDate)
  return {
    status: 'pending',
    year: nextYear,
    holiday: null,
    daysUntil: null,
    length: 0,
    crossYear: true,
    // 元旦是公历固定日期，可以给天数；放假天数未公布，所以只说「元旦」不说「假期」
    newYear: newYearDays !== null && newYearDays >= 0 ? { date: newYearDate, days: newYearDays } : null,
    note: `${nextYear} 年放假安排尚未公布`,
  }
}

/**
 * 逐日生成建议：每天跑一次 clothing 与 umbrella，各自只消费结论。
 *
 * @param {string[]} dates 要出建议的日期（升序）
 * @param {Map} byDate groupByDate 的结果
 * @param {object} config
 * @param {number} feedbackOffset 用户体感校准偏移
 */
export function buildDays(dates, byDate, config, feedbackOffset = 0) {
  return (dates || []).map((date) => {
    const sample = summariseDay(date, byDate.get(date))
    if (!sample) {
      return {
        date,
        weekday: weekdayLabel(date),
        inForecast: false,
        reason: '超出预报范围',
      }
    }

    const clothing = run(
      'clothing',
      { temp: sample.temp, humidity: sample.humidity, windSpeed: sample.windSpeed, feedbackOffset },
      config,
    )
    const umbrella = run('umbrella', { precipProb: sample.precipProb, windSpeed: sample.windSpeed }, config)

    return {
      date,
      weekday: weekdayLabel(date),
      inForecast: true,
      sample,
      clothing,
      umbrella,
      degraded: Boolean(clothing.degraded || umbrella.degraded),
    }
  })
}

/**
 * 从多天建议里汇总出打包清单。
 *
 * 两类建议的汇总规则不一样，这是本函数最需要注意的地方：
 *
 *   衣物 —— 取并集。假期里温度会变，冷了要外套、热了要短袖，
 *           全列出来才叫打包清单。
 *
 *   雨具 —— 只取「天气最差那天」的结论，不能取并集。
 *           取并集会同时得到「非必要推迟出门」和「不用带伞」，
 *           这是不同天的结论，堆在一张单子上就是自相矛盾。
 *           打包只关心「带不带伞」，按最坏的一天准备，
 *           多带一把伞的成本远低于淋一场雨。
 *
 *   另外分成两组而不是一张单子：穿衣表里有「遮阳伞」，带伞规则里有「不用带伞」，
 *   并排列出来同样读着别扭，各自有标题就清楚了。
 *
 * @param {Array} days buildDays 的结果
 * @returns {{outfit: string[], gear: string[], worstDay: string|null}}
 */
export function mergeChecklist(days) {
  const covered = (days || []).filter((day) => day.inForecast)

  const outfit = []
  for (const day of covered) {
    for (const action of day.clothing?.actions || []) {
      if (action && !outfit.includes(action)) outfit.push(action)
    }
  }

  // 数据不足（degraded / level 0）不参与「最坏」评比，否则取数失败会被当成暴雨天
  const usable = covered.filter(
    (day) => day.umbrella && !day.umbrella.degraded && typeof day.umbrella.level === 'number' && day.umbrella.level >= 1,
  )
  const worst = usable.reduce((acc, day) => {
    if (!acc) return day
    return day.umbrella.level < acc.umbrella.level ? day : acc
  }, null)

  return {
    outfit,
    gear: [...(worst?.umbrella?.actions || [])],
    worstDay: worst?.date || null,
  }
}

/** 清单总条数，页面用来显示「共 N 项」 */
export function checklistCount(checklist) {
  if (!checklist) return 0
  return (checklist.outfit?.length || 0) + (checklist.gear?.length || 0)
}

/**
 * 主入口：生成假期出行准备清单。
 *
 * @param {{config: object, today: string, hourlyAll: Array, feedbackOffset?: number}} options
 * @returns {object} 见返回值注释
 */
export function buildTripPlan({ config, today, hourlyAll = [], feedbackOffset = 0 } = {}) {
  const target = resolveTarget(config, today)
  const byDate = groupByDate(hourlyAll)

  if (target.status === 'pending') {
    return {
      status: 'pending',
      target,
      days: [],
      checklist: { outfit: [], gear: [], worstDay: null },
      coverage: { inForecast: 0, total: 0 },
      message: `${target.note}，无法生成出行清单`,
    }
  }

  if (target.status === 'none') {
    return {
      status: 'none',
      target,
      days: [],
      checklist: { outfit: [], gear: [], worstDay: null },
      coverage: { inForecast: 0, total: 0 },
      message: target.note,
    }
  }

  const dates = holidayDates(target.holiday)
  const days = buildDays(dates, byDate, config, feedbackOffset)
  const inForecast = days.filter((day) => day.inForecast)
  const coverage = { inForecast: inForecast.length, total: days.length }

  // 一天都落不进预报窗口，有两种完全不同的原因，不能混成一句话：
  //   - 假期确实还很远 → tooFar，提示「临近再看」
  //   - 假期就在窗口内、但天气没取到 → noWeather，提示「数据没取到，稍后重试」
  // 把后者说成前者，等于把网络失败包装成「本来就预测不了」，属于误导。
  if (inForecast.length === 0) {
    const tooFar = target.daysUntil > FORECAST_HORIZON_DAYS
    return {
      status: tooFar ? 'tooFar' : 'noWeather',
      target,
      days,
      checklist: { outfit: [], gear: [], worstDay: null },
      coverage,
      message: tooFar
        ? `距${target.holiday.name}还有 ${target.daysUntil} 天，超出 ${FORECAST_HORIZON_DAYS} 天预报范围`
        : `天气数据没取到，暂时算不出${target.holiday.name}的出行准备`,
    }
  }

  return {
    status: 'ok',
    target,
    days,
    checklist: mergeChecklist(days),
    coverage,
    message: '',
  }
}

/**
 * 降级入口：当前没有可预判的假期时的「未来 N 天」准备清单。
 *
 * 用途是让功能在假期空窗期仍然可用（现在就是这种时段：本年假期已结束、
 * 次年安排待公布）。给的是真实预报，不是气候推测，
 * 所以页面上必须标注「这不是假期，是未来几天的出门准备」。
 *
 * @param {{config: object, today: string, hourlyAll: Array, feedbackOffset?: number, count?: number}} options
 */
export function buildRangePlan({ config, today, hourlyAll = [], feedbackOffset = 0, count = FORECAST_HORIZON_DAYS } = {}) {
  const safeCount = Math.max(1, Math.min(count, MAX_PLAN_DAYS))
  const dates = []
  for (let i = 0; i < safeCount; i += 1) dates.push(shiftDate(today, i))

  const days = buildDays(dates, groupByDate(hourlyAll), config, feedbackOffset)
  const inForecast = days.filter((day) => day.inForecast)

  return {
    status: inForecast.length === 0 ? 'noWeather' : 'ok',
    days,
    checklist: mergeChecklist(days),
    coverage: { inForecast: inForecast.length, total: days.length },
    message: inForecast.length === 0 ? '天气数据还没取到，暂时给不出准备清单' : '',
  }
}

export default {
  FORECAST_HORIZON_DAYS,
  groupByDate,
  summariseDay,
  holidayDates,
  shiftDate,
  resolveTarget,
  buildDays,
  mergeChecklist,
  buildTripPlan,
  buildRangePlan,
}
