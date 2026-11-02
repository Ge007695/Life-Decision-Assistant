/**
 * 内核层 · 假期倒计时（P0）
 *
 * 读 config.holidays（holidays.json），只做三件事：
 *   1) 今天在不在假期里 → 正在放假还剩几天
 *   2) 不在假期里 → 距下一个假期还有几天
 *   3) 顺带提醒调休补班日
 *
 * 日期差用“本地日期中午 12 点”做基准，不做时区换算：
 * 用 UTC 或时间戳直接相减，会在夏令时/时区边界差一天；
 * 取中午再四舍五入到整天，跨时区也不会抖。
 *
 * 2027 这类 status='pending' 的年份是正常状态（国务院次年安排 11—12 月才发布），
 * 必须返回“待公布”而不是抛异常或白屏——这是契约第四节明确要求的行为。
 */

import { toFinite } from '../utils/dewpoint.js'

export const id = 'holiday'
export const version = '1.0.0'
export const requiresIndex = false
export const configRef = 'holidays.json'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86400000
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 解析 YYYY-MM-DD 为本地日期（中午 12 点，躲开夏令时与月末边界），非法返回 null */
function parseDate(text) {
  const match = DATE_RE.exec(String(text || ''))
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day, 12, 0, 0, 0)
  if (Number.isNaN(date.getTime())) return null
  // 回读校验：2026-13-45 会被 Date 自动进位上溢成次年，必须当成非法日期拦下
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null
  return date
}

/** 本地日期格式化回 YYYY-MM-DD */
function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 两个日期相距的整天数（b − a），四舍五入吸收 23/25 小时的日子 */
function diffDays(fromText, toText) {
  const from = parseDate(fromText)
  const to = parseDate(toText)
  if (!from || !to) return null
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

/** 中文星期，如 周日 */
function weekdayLabel(text) {
  const date = parseDate(text)
  return date ? WEEKDAYS[date.getDay()] : ''
}

/** 中文月日，如 1 月 4 日 */
function monthDayLabel(text) {
  const date = parseDate(text)
  if (!date) return ''
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

/** 今天：优先用入参（测试/回放可复现），其次用注入的时钟，最后才取系统时间 */
function resolveToday(inputToday, now) {
  const given = parseDate(inputToday)
  if (given) return formatDate(given)
  const fromCtx = now ? new Date(now) : new Date()
  const date = Number.isNaN(fromCtx.getTime()) ? new Date() : fromCtx
  return formatDate(date)
}

/** 年份：入参优先，否则取今天的年份 */
function resolveYear(inputYear, today) {
  const year = toFinite(inputYear)
  if (year !== null && Number.isInteger(year) && year > 1900 && year < 2200) return year
  return Number(today.slice(0, 4))
}

/** 该年份的假期节点；缺失时造一个合法的 pending 节点，调用方不用判空 */
function yearNodeOf(config, year) {
  const node = config?.holidays?.years?.[String(year)]
  if (!node) return { status: 'pending', holidays: [], makeupWorkdays: [] }
  return node
}

function sortedHolidays(node) {
  return [...(node?.holidays || [])]
    .filter((item) => DATE_RE.test(String(item?.start || '')) && DATE_RE.test(String(item?.end || '')))
    .sort((a, b) => a.start.localeCompare(b.start))
}

/** 待公布年份的统一结论：level 0、降级、不抛异常 */
function pendingResult(year, today, note) {
  return {
    level: 0,
    levelLabel: '待公布',
    score: 0,
    headline: `${year} 年安排待公布`,
    actions: ['等国务院办公厅发布次年安排后再来看', '已知的假期可在设置页手动录入'],
    evidence: [
      { key: 'today', label: '今天', value: today, weight: null, contribution: null, ratio: null },
      { key: 'year', label: '查询年份', value: String(year), weight: null, contribution: null, ratio: null },
      { key: 'status', label: '数据状态', value: note || '尚未公布', weight: null, contribution: null, ratio: null },
    ],
    degraded: true,
    meta: { year, status: 'pending' },
  }
}

/** 调休提醒：只列今天及以后的补班日 */
function makeupActions(node, today) {
  const list = [...(node?.makeupWorkdays || [])].filter((day) => DATE_RE.test(String(day))).sort()
  return list
    .filter((day) => day >= today)
    .map((day) => `${monthDayLabel(day)}（${weekdayLabel(day)}）需补班`)
}

/** 假期起止：如 元旦：1 月 1 日—1 月 3 日（3 天） */
function spanText(holiday) {
  const days = Number.isFinite(holiday.days) ? holiday.days : diffDays(holiday.start, holiday.end) + 1
  return `${holiday.name}：${monthDayLabel(holiday.start)}—${monthDayLabel(holiday.end)}（${days} 天）`
}

/**
 * @param {object} input {year?, today?}
 * @param {object} ctx { config, now }
 */
export function evaluate(input = {}, ctx = {}) {
  const config = ctx.config
  const today = resolveToday(input.today, ctx.now)
  const year = resolveYear(input.year, today)
  const node = yearNodeOf(config, year)

  // 待公布：不查假期、不报错，直接给“待公布”
  if (node.status === 'pending') {
    return pendingResult(year, today)
  }

  const holidays = sortedHolidays(node)
  if (holidays.length === 0) {
    // 有节点却没有假期数据，等同于待公布，避免“距 undefined 还有 0 天”
    return pendingResult(year, today, node.status === 'partial' ? '仅采集到部分安排' : '尚未采集')
  }

  const ongoing = holidays.find((item) => item.start <= today && today <= item.end)
  if (ongoing) {
    // 含今天：今天 1 月 2 日、假期 1 月 1—3 日 → 还剩 2 天（今天 + 明天）
    const remaining = diffDays(today, ongoing.end) + 1
    return {
      level: 4,
      levelLabel: '休假中',
      score: 100,
      headline: `正在放${ongoing.name}假，还剩 ${remaining} 天`,
      actions: [spanText(ongoing), ...makeupActions(node, ongoing.end)],
      evidence: [
        { key: 'today', label: '今天', value: `${today}（${weekdayLabel(today)}）`, weight: null, contribution: null, ratio: null },
        { key: 'holiday', label: '当前假期', value: spanText(ongoing), weight: null, contribution: null, ratio: null },
        { key: 'remaining', label: '剩余天数', value: `${remaining} 天（含今天）`, weight: null, contribution: null, ratio: null },
        { key: 'source', label: '数据来源', value: node.source || '配置内置', weight: null, contribution: null, ratio: null },
      ],
      meta: { year, status: node.status, ongoing: ongoing.name, remaining },
    }
  }

  const upcoming = holidays.find((item) => item.start > today)
  if (upcoming) {
    const days = diffDays(today, upcoming.start)
    return {
      level: 4,
      levelLabel: '有安排',
      score: 100,
      headline: `距${upcoming.name}还有 ${days} 天`,
      actions: [spanText(upcoming), ...makeupActions(node, today)],
      evidence: [
        { key: 'today', label: '今天', value: `${today}（${weekdayLabel(today)}）`, weight: null, contribution: null, ratio: null },
        { key: 'holiday', label: '下一个假期', value: spanText(upcoming), weight: null, contribution: null, ratio: null },
        { key: 'countdown', label: '倒计时', value: `${days} 天`, weight: null, contribution: null, ratio: null },
        { key: 'source', label: '数据来源', value: node.source || '配置内置', weight: null, contribution: null, ratio: null },
      ],
      meta: { year, status: node.status, next: upcoming.name, days },
    }
  }

  // 本年度假期已经过完，看次年：有数据就跨年倒计时，没数据就如实说“待公布”
  const nextYear = year + 1
  const nextNode = yearNodeOf(config, nextYear)
  const nextHolidays = sortedHolidays(nextNode)

  if (nextNode.status !== 'pending' && nextHolidays.length > 0) {
    const first = nextHolidays[0]
    const days = diffDays(today, first.start)
    return {
      level: 4,
      levelLabel: '有安排',
      score: 100,
      headline: `距${first.name}还有 ${days} 天`,
      actions: [spanText(first), ...makeupActions(nextNode, today)],
      evidence: [
        { key: 'today', label: '今天', value: `${today}（${weekdayLabel(today)}）`, weight: null, contribution: null, ratio: null },
        { key: 'holiday', label: '下一个假期', value: spanText(first), weight: null, contribution: null, ratio: null },
        { key: 'countdown', label: '倒计时', value: `${days} 天`, weight: null, contribution: null, ratio: null },
        { key: 'source', label: '数据来源', value: nextNode.source || '配置内置', weight: null, contribution: null, ratio: null },
      ],
      meta: { year: nextYear, status: nextNode.status, next: first.name, days, crossYear: true },
    }
  }

  return pendingResult(nextYear, today, `${year} 年假期已结束，${nextYear} 年安排尚未公布`)
}

export { parseDate, formatDate, diffDays, weekdayLabel }
