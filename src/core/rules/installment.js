/**
 * 内核层 · 分期真实年化（P0）
 *
 * 输入只有三个数：本金、期数、每期费率。其余全部由 utils/irr.js 算出。
 * 页面“三种算法对比表”直接用 meta.methods，不需要前端再算一遍。
 *
 * 费率单位：按表单口径收百分数（0.6 表示每期 0.6%），与花钱模块的输入校验一致；
 * 也接受 input.feeRateUnit = 'decimal' 的小数口径（0.006），方便脚本与测试直接调用。
 * 单位必须显式，不做“看着像小数就除以 100”的猜测——猜错一次，年化就差 100 倍。
 *
 * 换算关系：
 *   名义年化   = 每期费率 × 12（平台宣传口径，隐含“本金整年不还”的错误假设）
 *   名义成本   = 每期费率 × 期数（整笔分期的手续费占比）
 *   真实年化   = (1 + 月利率)^12 − 1（按逐期还本付息后的实际资金占用算）
 *   倍数       = 真实年化 ÷ 名义年化，用来点破“每期 0.6% 很便宜”的错觉
 *
 * 边界（无解、期数非法、本金非法）一律给中文原因，绝不出现“年化 NaN%”。
 */

import { solveIrr } from '../utils/irr.js'
import { toFinite } from '../utils/dewpoint.js'
import { round } from '../utils/normalize.js'

export const id = 'installment'
export const version = '1.0.0'
export const requiresIndex = false
export const configRef = 'formula:irr'

/** 每期费率上限（百分数口径）：与表单一致的 10%，超过基本是把年费率填成了每期 */
const MAX_FEE_PERCENT = 10

/** 倍数分档：用于选一句最贴切的 headline，阈值是文案分界而非业务阈值 */
const RATIO_DOUBLE = 2
const RATIO_NEAR_DOUBLE = 1.5

/**
 * 真实年化的成本分档，只用于给结论卡上色（level）。
 * 参考区间：信用卡分期常见 13%—18%；民间借贷利率司法保护上限约 4 倍 LPR（≈15%）。
 * 这些是“用户的感受阈值”，不是计算依据，所以放在规则里并写清来源。
 */
const COST_BANDS = [
  { maxAnnual: 0.08, level: 4, label: '成本较低' },
  { maxAnnual: 0.15, level: 3, label: '成本中等' },
  { maxAnnual: 0.24, level: 2, label: '成本偏高' },
  { maxAnnual: Infinity, level: 1, label: '成本很高' },
]

/**
 * 分数换算的上限：真实年化到这个水平记 0 分。
 * 36% 是司法实践中长期沿用的高利贷警戒线，超过它“成本很高”已经没有区分度。
 */
const SCORE_ZERO_ANNUAL = 0.36

function percentText(rate) {
  return `${round(rate * 100, 2)}%`
}

function bandOf(annualRate) {
  return COST_BANDS.find((band) => annualRate < band.maxAnnual) || COST_BANDS[COST_BANDS.length - 1]
}

/**
 * 把入参费率统一成小数口径。
 * @returns {{ok: true, value: number} | {ok: false, message: string}}
 */
function resolveFeeRate(raw, unit) {
  if (raw === null) return { ok: false, message: '每期费率必须是数字（0.6 表示每期 0.6%）' }
  if (raw < 0) return { ok: false, message: '每期费率不能为负数' }

  if (unit === 'decimal') {
    if (raw > MAX_FEE_PERCENT / 100) {
      return { ok: false, message: `每期费率超过 ${MAX_FEE_PERCENT}%，请确认单位` }
    }
    return { ok: true, value: raw }
  }

  if (raw > MAX_FEE_PERCENT) {
    return { ok: false, message: `每期费率需在 0—${MAX_FEE_PERCENT}% 之间（当前 ${raw}%）` }
  }
  return { ok: true, value: raw / 100 }
}

/** 无解时的统一结论：说清楚为什么算不出来，并给出下一步动作 */
function failedResult(solution, evidence) {
  return {
    level: 0,
    levelLabel: '无法计算',
    score: 0,
    headline: `无法计算真实年化：${solution.message || solution.reason || '参数不合法'}`,
    actions: ['检查本金、期数、每期费率是否填对', '期数必须是正整数，费率按“每期百分比”填写（0.6 表示 0.6%）'],
    evidence,
    degraded: true,
    meta: {
      ok: false,
      reason: solution.reason || null,
      methods: solution.comparison || [],
      comparison: solution.comparison || [],
    },
  }
}

/**
 * @param {object} input {principal, periods, feeRate, feeRateUnit?}
 * @param {object} _ctx 本规则不读配置（公式全部在 irr.js 里），保留形参以符合契约签名
 */
export function evaluate(input = {}, _ctx = {}) {
  const principal = toFinite(input.principal)
  const periods = toFinite(input.periods)
  const feeInput = toFinite(input.feeRate)
  const unit = input.feeRateUnit === 'decimal' ? 'decimal' : 'percent'

  const baseEvidence = [
    { key: 'principal', label: '本金', value: principal === null ? '缺失' : `${round(principal, 2)} 元`, weight: null, contribution: null, ratio: null },
    { key: 'periods', label: '期数', value: periods === null ? '缺失' : `${periods} 期`, weight: null, contribution: null, ratio: null },
    { key: 'feeRate', label: '每期费率', value: feeInput === null ? '缺失' : `${round(feeInput, 2)}%`, weight: null, contribution: null, ratio: null },
  ]

  // 按“本金 → 期数 → 费率”的顺序报错：用户从第一个框开始填，
  // 一次只提示最靠前的那个问题，比一口气列三条更好改。
  if (principal === null || !(principal > 0)) {
    return failedResult({ reason: 'invalid-principal', message: '本金必须是大于 0 的数字' }, baseEvidence)
  }
  if (periods === null || !(periods > 0) || !Number.isInteger(periods)) {
    return failedResult({ reason: 'invalid-periods', message: '期数必须是大于 0 的整数' }, baseEvidence)
  }

  const fee = resolveFeeRate(feeInput, unit)
  if (!fee.ok) {
    return failedResult({ reason: 'invalid-fee-rate', message: fee.message }, baseEvidence)
  }

  const feeRate = fee.value
  // 单位归一后按小数口径显示，避免“0.006%”这种把小数当百分数的错觉
  baseEvidence[2] = { ...baseEvidence[2], value: percentText(feeRate) }
  const solution = solveIrr(principal, periods, feeRate)

  if (!solution.ok) {
    return failedResult(solution, baseEvidence)
  }

  const payment = principal / periods + principal * feeRate
  const totalFee = principal * feeRate * periods
  const nominalAnnual = solution.nominalAnnualRate
  const realAnnual = solution.annualRate
  // 名义成本与页面口径一致：每期费率 × 期数（整笔的手续费占比）
  const nominalCost = solution.totalFeeRate
  const ratio = nominalAnnual > 0 ? realAnnual / nominalAnnual : null
  const band = bandOf(realAnnual)

  const headline = (() => {
    const real = percentText(realAnnual)
    const nominal = percentText(nominalAnnual)
    if (ratio === null) return `真实年化 ${real}，名义费率 ${nominal}`
    if (ratio >= RATIO_DOUBLE) return `真实年化 ${real}，是名义 ${nominal} 的两倍多`
    if (ratio >= RATIO_NEAR_DOUBLE) return `真实年化 ${real}，接近名义 ${nominal} 的两倍`
    if (ratio >= 1) return `真实年化 ${real}，高于名义 ${nominal}`
    return `真实年化 ${real}，低于名义 ${nominal}`
  })()

  const evidence = [
    ...baseEvidence,
    { key: 'payment', label: '每期还款', value: `${round(payment, 2)} 元（本金 ${round(principal / periods, 2)} + 手续费 ${round(principal * feeRate, 2)}）`, weight: null, contribution: null, ratio: null },
    { key: 'totalFee', label: '总手续费', value: `${round(totalFee, 2)} 元（占总本金 ${percentText(totalFee / principal)}）`, weight: null, contribution: null, ratio: null },
    { key: 'nominal', label: '名义年化', value: `${percentText(nominalAnnual)}（每期费率 × 12）`, weight: null, contribution: null, ratio: null },
    { key: 'nominalCost', label: '名义成本', value: `${percentText(nominalCost)}（每期费率 × 期数）`, weight: null, contribution: null, ratio: null },
    { key: 'realMonthly', label: '真实月利率', value: percentText(solution.monthlyRate), weight: null, contribution: null, ratio: null },
    { key: 'realAnnual', label: '真实年化', value: percentText(realAnnual), weight: null, contribution: null, ratio: null },
    { key: 'ratio', label: '真实 / 名义', value: ratio === null ? '—' : `${round(ratio, 2)} 倍`, weight: null, contribution: null, ratio: null },
  ]

  return {
    level: band.level,
    levelLabel: band.label,
    // 成本越高分越低：真实年化 36% 时归零，保证分数与等级同向
    score: round(Math.max(0, Math.min(100, (1 - realAnnual / SCORE_ZERO_ANNUAL) * 100)), 1),
    headline,
    actions: [
      `把“每期 ${round(payment, 2)} 元”乘以 ${periods} 期看总支出，别只比名义费率`,
      '提前还款前先确认剩余手续费是否减免，很多平台照收',
      '同一笔消费先看能否用免息期，再考虑分期',
    ],
    evidence,
    meta: {
      ok: true,
      monthlyRate: solution.monthlyRate,
      annualRate: realAnnual,
      nominalAnnualRate: nominalAnnual,
      // 页面按“名义成本 = 费率 × 期数”展示，这里直接给到位，避免前端再乘一次
      nominalRate: nominalCost,
      totalFeeRate: nominalCost,
      ratio,
      payment,
      method: solution.method,
      iterations: solution.iterations,
      error: solution.error,
      // 三种算法的对比数据：methods 是页面适配器读取的键名，comparison 为同义别名
      methods: solution.comparison,
      comparison: solution.comparison,
    },
  }
}
