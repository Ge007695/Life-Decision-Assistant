/**
 * 服务层 · 政策配置读取
 *
 * 节假日与税率属于外部规则，会变。做法是配置文件加版本号，页面显示依据
 * （工作指导书 3.3）。本文件只做“把配置摊平成页面好用的形状”，
 * 不含任何业务判断——判断留在内核层。
 */

/** 把 YYYY-MM-DD 解析成本地日期对象（中午 12 点，避开时区与夏令时边界） */
export function parseDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text || ''))) return null
  const [y, m, d] = text.split('-').map(Number)
  const date = new Date(y, m - 1, d, 12, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 两个 YYYY-MM-DD 之间的整天数（b − a） */
export function daysBetween(a, b) {
  const start = parseDate(a)
  const end = parseDate(b)
  if (!start || !end) return null
  return Math.round((end.getTime() - start.getTime()) / 86400000)
}

function expandRange(start, end) {
  const from = parseDate(start)
  const to = parseDate(end)
  if (!from || !to || from > to) return []
  const days = []
  const cursor = new Date(from.getTime())
  let guard = 0
  while (cursor <= to && guard < 400) {
    days.push(formatDate(cursor))
    cursor.setDate(cursor.getDate() + 1)
    guard += 1
  }
  return days
}

/** 配置里有哪些年份可用（升序） */
export function availableYears(config) {
  return Object.keys(config?.holidays?.years || {})
    .map(Number)
    .filter((year) => Number.isInteger(year))
    .sort((a, b) => a - b)
}

/** 取某一年的政策节点；不存在时返回一个合法的 pending 节点，避免页面报错 */
export function getYearNode(config, year) {
  const node = config?.holidays?.years?.[String(year)]
  if (node) return node
  return {
    status: 'pending',
    source: '',
    holidays: [],
    makeupWorkdays: [],
    schoolTerms: [],
    schoolTermsNote: '该年份安排尚未采集',
  }
}

/**
 * 把一年的数据展开成 { 'YYYY-MM-DD': type } 字典。
 * 日历渲染时查表，不在模板里写判断逻辑（工作指导书 5.2）。
 * 优先级：调休上班 > 假期 > 周末 > 工作日
 */
export function buildDateMap(yearNode) {
  const map = {}
  for (const holiday of yearNode?.holidays || []) {
    for (const day of expandRange(holiday.start, holiday.end)) {
      map[day] = { type: 'holiday', name: holiday.name }
    }
  }
  for (const day of yearNode?.makeupWorkdays || []) {
    map[day] = { type: 'makeup', name: '补班' }
  }
  return map
}

/** 某年 12 个月的日历网格（周一为每周第一天） */
export function buildYearGrid(year, yearNode) {
  const dateMap = buildDateMap(yearNode)
  const months = []
  for (let month = 0; month < 12; month += 1) {
    const first = new Date(year, month, 1)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const offset = (first.getDay() + 6) % 7 // 周一 → 0
    const cells = []
    for (let i = 0; i < offset; i += 1) cells.push(null)
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day, 12)
      const key = formatDate(date)
      const weekday = date.getDay()
      const override = dateMap[key]
      let type = 'workday'
      if (weekday === 0 || weekday === 6) type = 'weekend'
      if (override) type = override.type
      cells.push({ day, date: key, type, name: override?.name || '' })
    }
    months.push({ month: month + 1, cells })
  }
  return months
}

/** 从今天起最近的假期（含正在进行中的） */
export function nextHoliday(yearNode, today = formatDate(new Date())) {
  const holidays = [...(yearNode?.holidays || [])].sort((a, b) => a.start.localeCompare(b.start))
  for (const holiday of holidays) {
    if (holiday.end >= today) return holiday
  }
  return null
}

/** 某年的全部调休上班日，升序 */
export function makeupList(yearNode) {
  return [...(yearNode?.makeupWorkdays || [])].sort()
}

/** 税率配置段 */
export function taxSection(config, key) {
  return config?.taxRules?.[key] || null
}

/** 政策来源说明，页面要显示依据 */
export function policySource(yearNode) {
  if (!yearNode) return ''
  if (yearNode.status === 'pending') return '该年度安排尚未公布'
  return yearNode.source || ''
}

/** 星期中文 */
export function weekdayLabel(dateText) {
  const date = parseDate(dateText)
  if (!date) return ''
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
}

export default {
  parseDate,
  formatDate,
  daysBetween,
  availableYears,
  getYearNode,
  buildDateMap,
  buildYearGrid,
  nextHoliday,
  makeupList,
  taxSection,
  policySource,
  weekdayLabel,
}
