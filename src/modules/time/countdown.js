/**
 * 时间模块 · 假期倒计时
 *
 * 只做「取政策数据 + 算天数」这两步，天数计算全部调用 policy.js，
 * 页面拿到的是已经排版好的字段，模板里不再算日期。
 */

// 用相对路径而不是 @ 别名：这个文件要能被 `node --test` 直接跑（内核层纪律同理）
import { daysBetween, formatDate, getYearNode, nextHoliday, weekdayLabel } from '../../services/policy.js'

/** 从 YYYY-MM-DD 取年份 */
export function yearOf(dateText) {
  const year = Number(String(dateText || '').slice(0, 4))
  return Number.isInteger(year) ? year : null
}

/**
 * 取校历条目。
 *
 * 优先读顶层 `schoolCalendar.terms`：一个学期只维护一次。
 * 早先的设计是把学期分散写在 `years.<年份>.schoolTerms` 里，跨年的寒假会出现两份，
 * 改了一处漏另一处，所以改成顶层单一来源，这里保留旧结构的兜底读取。
 */
export function schoolTerms(config) {
  const list = config?.holidays?.schoolCalendar?.terms
  if (Array.isArray(list) && list.length) return list
  const years = config?.holidays?.years || {}
  return Object.values(years)
    .flatMap((node) => node?.schoolTerms || [])
    .map((term) => ({ kind: 'term', ...term }))
}

/**
 * 学期节点状态（T-4）：今天在上课还是放假、距下一个假期或开学还有几天。
 *
 * 只回答一个问题——「还有几天」，不去推第几教学周：
 * 周次要以教务部的教学安排表为准，我们手上只有起止日期，硬算周次算错了
 * 反而比不给更糟。
 *
 * @param {object} config 已校验的配置
 * @param {string} [today] YYYY-MM-DD
 */
export function buildSchoolStatus(config, today = formatDate(new Date())) {
  const terms = schoolTerms(config)
    .filter((term) => term.start && term.end)
    .sort((a, b) => a.start.localeCompare(b.start))

  if (!terms.length) {
    return { state: 'unknown', message: '校历数据待补录', detail: '以深圳大学教务部公布为准。' }
  }

  const current = terms.find((term) => term.start <= today && today <= term.end) || null
  const nextTerm = terms.find((term) => (term.kind || 'term') === 'term' && term.start > today) || null
  const nextBreak = terms.find((term) => term.kind === 'break' && term.start >= today) || null

  // 正在放假：数还剩几天，并给出开学日期
  if (current && current.kind === 'break') {
    const left = daysBetween(today, current.end)
    return {
      state: 'onBreak',
      name: current.name,
      days: Math.max((left ?? 0) + 1, 0),
      lead: `正在放${current.name}，还剩`,
      detail: nextTerm
        ? `${current.name} ${current.start} 至 ${current.end}，${nextTerm.start}（${weekdayLabel(nextTerm.start)}）开学。`
        : `${current.name} ${current.start} 至 ${current.end}。`,
      term: current,
    }
  }

  // 正在上课：数距下一个假期（寒/暑假）还有几天
  if (current) {
    if (nextBreak) {
      return {
        state: 'inTerm',
        name: nextBreak.name,
        days: Math.max(daysBetween(today, nextBreak.start) ?? 0, 0),
        lead: `距${nextBreak.name}还有`,
        detail: `${current.name} ${current.start} 至 ${current.end}；${nextBreak.name} ${nextBreak.start} 起。`,
        term: current,
      }
    }
    return {
      state: 'inTerm',
      name: current.name,
      days: Math.max(daysBetween(today, current.end) ?? 0, 0),
      lead: '本学期还剩',
      detail: `${current.name} ${current.start} 至 ${current.end}；下学期校历待公布。`,
      term: current,
    }
  }

  // 学期刚结束、假期还没开始的空档（校历上通常是成绩周）：仍按"距假期还有几天"回答，
  // 不要在这两天掉进"不在校历范围内"，那会让页面在一年里最该看倒计时的几天变成空白。
  const lastTerm = [...terms]
    .reverse()
    .find((term) => (term.kind || 'term') === 'term' && term.end < today)
  if (lastTerm && nextBreak) {
    return {
      state: 'inTerm',
      name: nextBreak.name,
      days: Math.max(daysBetween(today, nextBreak.start) ?? 0, 0),
      lead: `距${nextBreak.name}还有`,
      detail: `${lastTerm.name} 已于 ${lastTerm.end} 结束；${nextBreak.name} ${nextBreak.start} 起。`,
      term: lastTerm,
      gap: true,
    }
  }

  // 不在任何时段内：只报下一个开学日，不猜
  if (nextTerm) {
    return {
      state: 'beforeTerm',
      name: nextTerm.name,
      days: Math.max(daysBetween(today, nextTerm.start) ?? 0, 0),
      lead: `距${nextTerm.name}开学还有`,
      detail: `${nextTerm.name} ${nextTerm.start} 至 ${nextTerm.end}。`,
      term: nextTerm,
    }
  }

  return { state: 'unknown', message: '下学期校历尚未公布', detail: '以深圳大学教务部公布为准。' }
}

/** 假期的完整天数（含首尾） */
export function holidayLength(holiday) {
  const span = daysBetween(holiday?.start, holiday?.end)
  return span === null ? 0 : span + 1
}

/** 假期的说明行：「10 月 1 日（周四）至 10 月 7 日（周三），共 7 天」 */
function rangeText(holiday) {
  const start = holiday?.start || ''
  const end = holiday?.end || ''
  return `${start} （${weekdayLabel(start)}）至 ${end} （${weekdayLabel(end)}），共 ${holidayLength(holiday)} 天`
}

/** 「10 月 7 日」，用于跨年说明里的收尾句 */
function monthDay(dateText) {
  const text = String(dateText || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return `${Number(text.slice(5, 7))} 月 ${Number(text.slice(8, 10))} 日`
}

/**
 * 生成倒计时结论。
 *
 * 三种正常状态：
 * - during    正在放假，还剩 X 天（含今天）
 * - upcoming  距某假期还有 X 天
 * - pending   本年度假期已全部结束，下一年度安排尚未公布
 *
 * @param {object} config 已校验的配置
 * @param {string} [today] YYYY-MM-DD，默认取本地今天
 */
export function buildCountdown(config, today = formatDate(new Date())) {
  const year = yearOf(today)
  const node = getYearNode(config, year)

  // 今天所在年度还没公布：直接给待公布状态，不做任何日期推断
  if (node.status === 'pending') {
    return {
      state: 'pending',
      year,
      nextYear: null,
      message: `${year} 年放假安排尚未公布`,
      detail: '国务院办公厅一般在每年 11—12 月发布次年安排，公布后此处会自动更新。',
    }
  }

  const holiday = nextHoliday(node, today)
  if (holiday) {
    const ongoing = holiday.start <= today && today <= holiday.end
    const days = ongoing ? daysBetween(today, holiday.end) + 1 : daysBetween(today, holiday.start)
    return {
      state: ongoing ? 'during' : 'upcoming',
      year,
      name: holiday.name,
      days: Math.max(days, 0),
      start: holiday.start,
      end: holiday.end,
      lead: ongoing ? '正在放假，还剩' : `距${holiday.name}还有`,
      detail: rangeText(holiday),
    }
  }

  // 本年已无假期：跨年看下一年度，避免「没有结果」的空白页
  const nextYear = year + 1
  const nextNode = getYearNode(config, nextYear)
  const nextList = [...(nextNode.holidays || [])].sort((a, b) => a.start.localeCompare(b.start))
  const pastList = [...(node.holidays || [])].filter((item) => item.end < today).sort((a, b) => a.start.localeCompare(b.start))
  const last = pastList[pastList.length - 1]

  if (nextNode.status === 'pending' || nextList.length === 0) {
    // 元旦是公历固定日期，可以给一个标注清楚的参考天数；放假天数仍以公布为准
    const newYearDate = `${nextYear}-01-01`
    const refDays = daysBetween(today, newYearDate)
    return {
      state: 'pending',
      year,
      nextYear,
      message: `${year} 年假期已全部结束，${nextYear} 年安排待公布`,
      detail: last
        ? `${year} 年最后一个假期是${last.name}（${monthDay(last.end)} 结束）。${nextYear} 年的放假安排公布后，这里会自动接续倒计时。`
        : `${nextYear} 年的放假安排公布后，这里会自动接续倒计时。`,
      reference: refDays !== null && refDays >= 0 ? { days: refDays, date: newYearDate } : null,
    }
  }

  const first = nextList[0]
  return {
    state: 'upcoming',
    year: nextYear,
    name: first.name,
    days: Math.max(daysBetween(today, first.start) || 0, 0),
    start: first.start,
    end: first.end,
    lead: `距${first.name}还有`,
    detail: rangeText(first),
    crossYear: true,
  }
}

export default { buildCountdown, buildSchoolStatus, yearOf, holidayLength, schoolTerms }
