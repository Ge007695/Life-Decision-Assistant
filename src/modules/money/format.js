/**
 * 花钱模块 · 金额与百分比格式化
 *
 * 全模块只走这一个出口，避免各页面各写一套，出现「3,840.00」「3840」「¥3840」三种写法。
 * 所有函数对非有限数返回破折号——页面上永远不会出现 NaN。
 */

const currencyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const integerFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 0,
})

/** 只接受真正有值的数字：null / undefined / '' / NaN 一律视为「没有」 */
function toFinite(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/** 金额 → ¥3,840.00；负数显示 -¥1.00，负号在币种前 */
export function money(value) {
  const num = toFinite(value)
  if (num === null) return '—'
  return `${num < 0 ? '-' : ''}¥${currencyFormatter.format(Math.abs(num))}`
}

/** 带符号金额 → +¥6,000.00 / -¥536.00，现金流表用 */
export function signedMoney(value) {
  const num = toFinite(value)
  if (num === null) return '—'
  return `${num >= 0 ? '+' : '-'}${money(Math.abs(num))}`
}

/** 计数（期数、迭代次数）→ 千分位整数 */
export function count(value) {
  const num = toFinite(value)
  if (num === null) return '—'
  return integerFormatter.format(num)
}

/** 去掉小数末尾多余的 0：'13.00' → '13'，'1.80' → '1.8' */
function trimZeros(text) {
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}

/** 小数比例 → 百分数文本：0.1303 → 13.03%，20 传入 0.2 */
export function percent(ratio, digits = 2) {
  const num = toFinite(ratio)
  if (num === null) return '—'
  return `${trimZeros((num * 100).toFixed(digits))}%`
}

/** 输入框里的百分数（0.6 表示 0.6%）→ 小数比例 */
export function percentInputToRatio(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num / 100
}

/** ISO 时间 → HH:mm，用于「输入已保存」提示 */
export function clockTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
