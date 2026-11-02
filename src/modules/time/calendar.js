/**
 * 时间模块 · 日历查表与图例
 *
 * 页面模板不写任何判断：日期类型由 policy.buildYearGrid() 给出，
 * 这里只把 type 映射成「文案 + 配色类名」，模板直接取值渲染（工作指导书 5.2）。
 */
import { weekdayLabel } from '@/services/policy.js'

/**
 * 日期类型 → 展示信息。
 * 配色一律用 main.css 的等级变量，不允许写死色值。
 * 优先级与 policy.buildDateMap() 一致：调休上班 > 假期 > 周末 > 工作日。
 */
export const TYPE_META = {
  holiday: { key: 'holiday', label: '假期', className: 't-holiday', chip: 'chip-lv1' },
  makeup: { key: 'makeup', label: '调休上班', className: 't-makeup', chip: 'chip-lv0' },
  weekend: { key: 'weekend', label: '周末', className: 't-weekend', chip: 'chip-lv3' },
  workday: { key: 'workday', label: '工作日', className: 't-workday', chip: 'chip-lv0' },
}

/** 图例顺序：从最需要注意的排到最平常的 */
export const LEGEND = [
  { ...TYPE_META.holiday, hint: '法定假期' },
  { ...TYPE_META.makeup, hint: '周末补班' },
  { ...TYPE_META.weekend, hint: '正常休息' },
  { ...TYPE_META.workday, hint: '正常上班' },
]

/** 周一为每周第一天，与 policy.buildYearGrid() 的排布一致 */
export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/**
 * 给每月格子补上展示信息。
 * @param {Array} grid policy.buildYearGrid() 的返回值
 * @returns {Array} [{ month, label, cells }]，cells 内 null 表示月初空位
 */
export function withMeta(grid = []) {
  return grid.map((month) => ({
    month: month.month,
    label: `${month.month} 月`,
    cells: month.cells.map((cell) => {
      if (!cell) return null
      return { ...cell, meta: TYPE_META[cell.type] || TYPE_META.workday }
    }),
  }))
}

/** 某天的完整说明：「10 月 1 日（周四）· 假期（国庆节）」 */
export function describeCell(cell) {
  if (!cell) return '点击日期查看当天安排'
  const type = cell.name ? `${cell.meta.label}（${cell.name}）` : cell.meta.label
  return `${shortDate(cell.date)}（${weekdayLabel(cell.date)}）· ${type}`
}

/** 底部说明行用的短句：类型已由色块标签表达，这里只补日期与假期名 */
export function describeShort(cell) {
  if (!cell) return '点击任意日期查看当天安排'
  const weekday = weekdayLabel(cell.date)
  const name = cell.name ? ` · ${cell.name}` : ''
  return `${shortDate(cell.date)}（${weekday}）${name}`
}

/** 「10 月 1 日」这种不带年份的短格式，取自 policy 已给的 YYYY-MM-DD */
export function shortDate(dateText) {
  const text = String(dateText || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const [, month, day] = text.split('-')
  return `${Number(month)} 月 ${Number(day)} 日`
}

export default { TYPE_META, LEGEND, WEEKDAYS, withMeta, describeCell, describeShort, shortDate }
