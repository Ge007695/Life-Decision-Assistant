/**
 * 花钱模块 · 输入校验（纯函数，可单独用 node 调用）
 *
 * 纪律：
 *   1. 只做「用户输入 → 规则入参」的转换与友好提示，不抛异常、不读存储、不依赖 Vue；
 *   2. 所有阈值集中在本文件的 LIMITS 里，页面与组合式函数都从这里取；
 *   3. 税额与 IRR 一律不在这里算——那是内核规则的职责，重复实现会让回测口径失真。
 *
 * 边界用例（可直接跑）：
 *   node -e "import('./src/modules/money/validate.js').then(m => console.log(m.validateSalaryInput({ gross: 0 })))"
 */

import { money } from './format.js'

/** 工资测算的输入边界，与需求书一致 */
export const SALARY_LIMITS = Object.freeze({
  /** 月收入上限（含日薪 × 工作日换算后的月收入） */
  maxIncome: 1000000,
  minMonths: 1,
  maxMonths: 12,
  maxSpecialDeduction: 100000,
  minWorkDays: 1,
  maxWorkDays: 31,
})

/** 分期的输入边界 */
export const INSTALLMENT_LIMITS = Object.freeze({
  maxPrincipal: 1000000,
  minPeriods: 1,
  maxPeriods: 60,
  minFeeRate: 0,
  maxFeeRate: 10,
})

const SALARY_MODES = ['service', 'salary']

/** 空表单：首次进入与「重置」都用它，避免两处默认值不一致 */
export function blankSalaryInput() {
  return {
    gross: '',
    mode: 'service',
    months: '1',
    specialDeduction: '0',
    dayRate: '',
    workDays: '',
  }
}

/** 是否空着没填（0 不算空） */
function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

/**
 * 读数字：空 → null，非数字 → NaN。
 * 区分这两种情况，才能给出「请填写」与「只能填数字」两种不同提示。
 */
function readNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN
  const text = String(value).trim()
  if (text === '') return null
  const num = Number(text)
  return Number.isFinite(num) ? num : Number.NaN
}

function positiveAmountError(label, value, max) {
  if (value === null) return `请填写${label}`
  if (Number.isNaN(value)) return `${label}只能填数字`
  if (value <= 0) return `${label}需大于 0（当前 ${money(value)}）`
  if (value > max) return `${label} ${money(value)} 超出上限 ${money(max)}`
  return ''
}

function nonNegativeAmountError(label, value, max) {
  if (value === null) return ''
  if (Number.isNaN(value)) return `${label}只能填数字`
  if (value < 0) return `${label}不能为负数（当前 ${money(value)}）`
  if (value > max) return `${label} ${money(value)} 超出上限 ${money(max)}`
  return ''
}

function integerError(label, value, min, max) {
  if (value === null) return `请填写${label}`
  if (Number.isNaN(value)) return `${label}只能填数字`
  if (!Number.isInteger(value)) return `${label}需为 ${min}—${max} 的整数（当前 ${value}）`
  if (value < min || value > max) return `${label}需在 ${min}—${max} 之间（当前 ${value}）`
  return ''
}

function roundMoney(value) {
  return Math.round(value * 100) / 100
}

/**
 * 校验工资测算输入。
 *
 * @param {object} raw 表单原始值（字符串居多）
 * @returns {{ok: boolean, errors: Record<string,string>, value: object|null}}
 *   value 只在 ok 为 true 时有值，结构即 engine.run('salary', value) 的入参
 */
export function validateSalaryInput(raw = {}) {
  const errors = {}

  // 口径：留空按劳务报酬处理（更保守的默认），非法值单独提示
  const mode = SALARY_MODES.includes(raw.mode) ? raw.mode : 'service'
  if (!isBlank(raw.mode) && !SALARY_MODES.includes(raw.mode)) {
    errors.mode = '计税口径只能是劳务报酬或工资薪金'
  }

  // 填了日薪或工作日就走「日薪 × 工作日」，两者都填才算数
  const useDaily = !isBlank(raw.dayRate) || !isBlank(raw.workDays)
  let gross = null

  if (useDaily) {
    const dayRate = readNumber(raw.dayRate)
    const workDays = readNumber(raw.workDays)

    const dayRateError = positiveAmountError('日薪', dayRate, SALARY_LIMITS.maxIncome)
    if (dayRateError) errors.dayRate = dayRateError

    const workDaysError = integerError(
      '工作日',
      workDays,
      SALARY_LIMITS.minWorkDays,
      SALARY_LIMITS.maxWorkDays,
    )
    if (workDaysError) errors.workDays = workDaysError

    if (!errors.dayRate && !errors.workDays) {
      gross = roundMoney(dayRate * workDays)
      if (gross > SALARY_LIMITS.maxIncome) {
        errors.dayRate = `日薪 × 工作日 = ${money(gross)}，超出月收入上限 ${money(
          SALARY_LIMITS.maxIncome,
        )}`
      }
    }
  } else {
    const value = readNumber(raw.gross)
    const grossError = positiveAmountError('月收入', value, SALARY_LIMITS.maxIncome)
    if (grossError) errors.gross = grossError
    else gross = value
  }

  const months = readNumber(raw.months)
  const monthsError = integerError(
    '实习月数',
    months,
    SALARY_LIMITS.minMonths,
    SALARY_LIMITS.maxMonths,
  )
  if (monthsError) errors.months = monthsError

  const specialRaw = isBlank(raw.specialDeduction) ? 0 : readNumber(raw.specialDeduction)
  const specialError = nonNegativeAmountError(
    '专项附加扣除',
    specialRaw,
    SALARY_LIMITS.maxSpecialDeduction,
  )
  if (specialError) errors.specialDeduction = specialError

  const ok = Object.keys(errors).length === 0
  if (!ok) return { ok: false, errors, value: null }

  const value = {
    gross,
    mode,
    months,
    specialDeduction: specialRaw,
  }
  if (useDaily) {
    value.dayRate = readNumber(raw.dayRate)
    value.workDays = readNumber(raw.workDays)
  }
  return { ok: true, errors, value }
}

/**
 * 校验分期输入。
 *
 * @param {object} raw 表单原始值
 * @returns {{ok: boolean, errors: Record<string,string>, value: object|null}}
 *   value 结构即 engine.run('installment', value) 的入参，feeRate 用百分数（0.6 表示 0.6%）
 */
export function validateInstallmentInput(raw = {}) {
  const errors = {}

  const principal = readNumber(raw.principal)
  const principalError = positiveAmountError(
    '本金',
    principal,
    INSTALLMENT_LIMITS.maxPrincipal,
  )
  if (principalError) errors.principal = principalError

  const periods = readNumber(raw.periods)
  const periodsError = integerError(
    '期数',
    periods,
    INSTALLMENT_LIMITS.minPeriods,
    INSTALLMENT_LIMITS.maxPeriods,
  )
  if (periodsError) errors.periods = periodsError

  const feeRate = readNumber(raw.feeRate)
  if (feeRate === null) {
    errors.feeRate = '请填写每期费率'
  } else if (Number.isNaN(feeRate)) {
    errors.feeRate = '每期费率只能填数字'
  } else if (feeRate < INSTALLMENT_LIMITS.minFeeRate || feeRate > INSTALLMENT_LIMITS.maxFeeRate) {
    errors.feeRate = `每期费率需在 ${INSTALLMENT_LIMITS.minFeeRate}%—${INSTALLMENT_LIMITS.maxFeeRate}% 之间（当前 ${feeRate}%）`
  }

  const ok = Object.keys(errors).length === 0
  if (!ok) return { ok: false, errors, value: null }

  return { ok: true, errors, value: { principal, periods, feeRate } }
}
