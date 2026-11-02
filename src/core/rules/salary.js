/**
 * 内核层 · 实习到手工资测算（P0）
 *
 * 两种口径，先算哪个由 input.mode 决定：
 *   service（劳务报酬预扣预缴）——实习协议、兼职、一次性劳务费的常见形式。
 *     应纳税所得额 = 收入 − 扣除额（收入 ≤ 阈值减定额，否则减比例）
 *     预扣税额     = 应纳税所得额 × 预扣率 − 速算扣除数
 *   salary（工资薪金累计预扣）——签劳动合同的正式/实习员工。
 *     应纳税所得额 = 累计收入 − 基本减除费用×月数 − 累计专项附加扣除
 *     预扣税额     = 应纳税所得额 × 预扣率 − 速算扣除数
 *
 * 代码里只有公式，没有税率：所有阈值、档位、速算扣除数都来自 tax-rules.json。
 * 税率会随政策调整，硬编码的数字过期后不会报错，只会安静地算错。
 *
 * 年度汇算部分一律带免责声明：汇算要考虑全年多笔收入、专项附加扣除凭证、
 * 退税补税规则，这里只是按月薪外推的估算，必须说清楚。
 */

import { toFinite } from '../utils/dewpoint.js'
import { round } from '../utils/normalize.js'

export const id = 'salary'
export const version = '1.0.0'
export const requiresIndex = false
export const configRef = 'tax-rules.json'

/** 兜底免责声明：正常应从 tax-rules.json 读取，配置缺失时也不能丢掉这句提示 */
const DEFAULT_DISCLAIMER = '本结果为估算，实际以税务部门年度汇算为准'

/** 全年月份数，用于“按月薪外推全年”的年度汇算估算 */
const MONTHS_PER_YEAR = 12

/**
 * 按应纳税所得额查税率档位。档位 upper 严格递增，最后一档 upper 为 null。
 * 用“不超过该档上限的第一个档”命中，即分段临界点归入低档。
 */
export function lookupBracket(brackets, taxable) {
  if (!Array.isArray(brackets) || brackets.length === 0) return null
  for (const bracket of brackets) {
    if (bracket.upper === null || taxable <= bracket.upper) return bracket
  }
  return brackets[brackets.length - 1]
}

/** 应纳税额 = 所得额 × 税率 − 速算扣除数，负数按 0 处理 */
function taxOf(brackets, taxable) {
  const bracket = lookupBracket(brackets, taxable)
  if (!bracket) return { bracket: null, tax: 0 }
  const tax = Math.max(0, taxable * bracket.rate - bracket.quickDeduction)
  return { bracket, tax }
}

function yuan(value) {
  return `${round(value, 2).toFixed(2)} 元`
}

function percent(rate) {
  return `${round(rate * 100, 2)}%`
}

function invalidResult(message, evidence = []) {
  return {
    level: 0,
    levelLabel: '待输入',
    score: 0,
    headline: message,
    actions: ['填写税前收入，或填写日薪与工作天数'],
    evidence,
    degraded: true,
  }
}

/**
 * @param {object} input {gross?, mode, months?, specialDeduction?, dayRate?, workDays?}
 * @param {object} ctx { config }
 */
export function evaluate(input = {}, ctx = {}) {
  const taxRules = ctx?.config?.taxRules || {}
  const service = taxRules.serviceIncome
  const salary = taxRules.salaryIncome
  const annual = taxRules.annualSettlement
  const disclaimer = annual?.disclaimer || DEFAULT_DISCLAIMER

  const mode = input.mode === 'salary' ? 'salary' : input.mode === 'service' ? 'service' : null
  if (!mode) {
    return invalidResult('请选择计算口径：劳务报酬或工资薪金')
  }

  // 收入：直接给月收入，或用日薪 × 工作天数折算
  const dayRate = toFinite(input.dayRate)
  const workDays = toFinite(input.workDays)
  const grossInput = toFinite(input.gross)
  const gross = grossInput ?? (dayRate !== null && workDays !== null ? dayRate * workDays : null)

  if (gross === null || !(gross > 0)) {
    return invalidResult(
      '请输入大于 0 的税前收入',
      dayRate !== null || workDays !== null
        ? [{ key: 'dayRate', label: '日薪 × 工作日', value: `${dayRate ?? '缺失'} × ${workDays ?? '缺失'}`, weight: null, contribution: null, ratio: null }]
        : [],
    )
  }

  const monthsRaw = toFinite(input.months)
  const months = monthsRaw !== null && Number.isInteger(monthsRaw) && monthsRaw > 0 ? monthsRaw : 1
  const specialMonthly = Math.max(0, toFinite(input.specialDeduction) ?? 0)

  const evidence = []
  /** 累计口径原值：工资薪金按月数累计计算，页面明细表按月度展示，两者都留一份 */
  let cumulative = null
  let taxable = 0
  let deductionTotal = 0
  let bracket = null
  let withheld = 0
  let netMonthly = 0

  if (mode === 'service') {
    if (!service) return invalidResult('配置缺少劳务报酬税率表，暂无法计算')

    // 扣除额：收入不超过阈值减定额，超过按比例减除
    const flat = service.deduction?.flat ?? 0
    const rate = service.deduction?.rate ?? 0
    deductionTotal = gross <= service.threshold ? flat : gross * rate
    taxable = Math.max(0, gross - deductionTotal)

    const result = taxOf(service.brackets, taxable)
    bracket = result.bracket
    withheld = result.tax
    netMonthly = gross - withheld

    evidence.push(
      { key: 'gross', label: '税前收入（每次）', value: yuan(gross), weight: null, contribution: null, ratio: null },
      { key: 'deduction', label: '扣除额', value: `${yuan(deductionTotal)}（${gross <= service.threshold ? '定额减除' : '按比例减除'}）`, weight: null, contribution: null, ratio: null },
      { key: 'taxable', label: '应纳税所得额', value: yuan(taxable), weight: null, contribution: null, ratio: null },
      { key: 'rate', label: '适用税率', value: bracket ? percent(bracket.rate) : '—', weight: null, contribution: null, ratio: null },
      { key: 'quickDeduction', label: '速算扣除数', value: bracket ? yuan(bracket.quickDeduction) : '—', weight: null, contribution: null, ratio: null },
      { key: 'withheld', label: '预扣税额', value: yuan(withheld), weight: null, contribution: null, ratio: null },
      { key: 'net', label: '到手金额', value: yuan(netMonthly), weight: null, contribution: null, ratio: null },
    )
  } else {
    if (!salary) return invalidResult('配置缺少工资薪金税率表，暂无法计算')

    const basicMonthly = salary.basicDeductionMonthly ?? 0
    const cumulativeIncome = gross * months
    const cumulativeDeduction = basicMonthly * months + specialMonthly * months
    deductionTotal = cumulativeDeduction
    taxable = Math.max(0, cumulativeIncome - cumulativeDeduction)

    const result = taxOf(salary.brackets, taxable)
    bracket = result.bracket
    withheld = result.tax

    // 累计预扣法：累计税额 ÷ 月数 = 各月税额（收入恒定时精确相等），
    // 页面明细表与「劳务 vs 工资」对比都按月口径展示，所以这里统一折成月均。
    const monthlyTaxable = taxable / months
    const monthlyDeduction = cumulativeDeduction / months
    const monthlyWithheld = withheld / months
    netMonthly = (cumulativeIncome - withheld) / months
    cumulative = {
      income: round(cumulativeIncome, 2),
      deduction: round(cumulativeDeduction, 2),
      taxable: round(taxable, 2),
      withheld: round(withheld, 2),
      net: round(cumulativeIncome - withheld, 2),
    }

    evidence.push(
      { key: 'gross', label: '税前收入（月）', value: yuan(gross), weight: null, contribution: null, ratio: null },
      { key: 'deduction', label: '扣除额（月）', value: `${yuan(monthlyDeduction)}（基本减除 ${yuan(basicMonthly)} + 专项附加 ${yuan(specialMonthly)}）`, weight: null, contribution: null, ratio: null },
      { key: 'taxable', label: '应纳税所得额（月均）', value: yuan(monthlyTaxable), weight: null, contribution: null, ratio: null },
      { key: 'rate', label: '适用税率', value: bracket ? percent(bracket.rate) : '—', weight: null, contribution: null, ratio: null },
      { key: 'quickDeduction', label: '速算扣除数', value: bracket ? yuan(bracket.quickDeduction) : '—', weight: null, contribution: null, ratio: null },
      { key: 'withheld', label: '预扣税额（月均）', value: yuan(monthlyWithheld), weight: null, contribution: null, ratio: null },
      { key: 'net', label: '到手金额（月均）', value: yuan(netMonthly), weight: null, contribution: null, ratio: null },
      { key: 'cumulative', label: `累计口径（${months} 个月）`, value: `收入 ${yuan(cumulativeIncome)}，扣除 ${yuan(cumulativeDeduction)}，应税 ${yuan(taxable)}，预扣 ${yuan(withheld)}`, weight: null, contribution: null, ratio: null },
    )
  }

  // ——— 年度汇算估算：按当前收入水平持续 12 个月外推 ———
  const annualIncome = gross * MONTHS_PER_YEAR
  const annualDeduction =
    (annual?.basicDeductionYearly ?? 0) + specialMonthly * MONTHS_PER_YEAR
  const annualTaxable = Math.max(0, annualIncome - annualDeduction)
  const annualResult = taxOf(annual?.brackets, annualTaxable)
  // 已预扣：工资口径按累计预扣法算满 12 个月的累计税额（与税局口径一致）；
  // 劳务口径按“同样一笔收入发生 12 次”外推，因为劳务是按次预扣
  const annualWithheld =
    mode === 'salary'
      ? taxOf(
          salary.brackets,
          Math.max(0, gross * MONTHS_PER_YEAR - (salary.basicDeductionMonthly ?? 0) * MONTHS_PER_YEAR - specialMonthly * MONTHS_PER_YEAR),
        ).tax
      : withheld * MONTHS_PER_YEAR
  const annualDiff = annualWithheld - annualResult.tax

  evidence.push(
    {
      key: 'annualTaxable',
      label: '全年应纳税所得额（估算）',
      value: yuan(annualTaxable),
      weight: null,
      contribution: null,
      ratio: null,
    },
    {
      key: 'annualTax',
      label: '年度汇算应纳税额（估算）',
      value: yuan(annualResult.tax),
      weight: null,
      contribution: null,
      ratio: null,
    },
    {
      key: 'annualDiff',
      label: annualDiff >= 0 ? '预计可退税额（估算）' : '预计需补税额（估算）',
      value: yuan(Math.abs(annualDiff)),
      weight: null,
      contribution: null,
      ratio: null,
    },
    {
      key: 'disclaimer',
      label: '说明',
      value: disclaimer,
      weight: null,
      contribution: null,
      ratio: null,
    },
  )

  const netRatio = gross > 0 ? netMonthly / gross : 0

  // 页面明细表与“劳务 vs 工资”对比都按月口径：工资薪金算出的累计值在此折成月均，
  // 累计原值另存 meta.cumulative，核对时不会丢信息。
  const displayTaxable = mode === 'salary' ? taxable / months : taxable
  const displayDeduction = mode === 'salary' ? deductionTotal / months : deductionTotal
  const displayWithheld = mode === 'salary' ? withheld / months : withheld

  const actions = [
    mode === 'service'
      ? '劳务报酬按次预扣，年度汇算时并入综合所得，可能产生退税'
      : '专项附加扣除按月累计，记得在个税 App 里及时更新',
    annualDiff >= 0
      ? `年度汇算时预计可退约 ${yuan(annualDiff)}`
      : `年度汇算时预计需补约 ${yuan(Math.abs(annualDiff))}`,
    disclaimer,
  ]

  return {
    level: 4,
    levelLabel: mode === 'service' ? '劳务报酬' : '工资薪金',
    // 信息类规则不表达好坏，分数用“到手比例”填，页面能看出税负轻重
    score: round(Math.min(1, Math.max(0, netRatio)) * 100, 1),
    headline: `税前 ${yuan(gross)}，预扣 ${yuan(displayWithheld)}，到手 ${yuan(netMonthly)}`,
    actions,
    evidence,
    meta: {
      mode,
      months,
      gross: round(gross, 2),
      taxable: round(displayTaxable, 2),
      // deduction / net 同时给出：页面适配器按这两个键名读明细表
      deduction: round(displayDeduction, 2),
      deductionTotal: round(displayDeduction, 2),
      rate: bracket?.rate ?? null,
      quickDeduction: bracket?.quickDeduction ?? null,
      withheld: round(displayWithheld, 2),
      net: round(netMonthly, 2),
      netMonthly: round(netMonthly, 2),
      netRatio: round(netRatio, 4),
      ...(cumulative ? { cumulative } : {}),
      annual: {
        income: round(annualIncome, 2),
        taxable: round(annualTaxable, 2),
        tax: round(annualResult.tax, 2),
        withheld: round(annualWithheld, 2),
        diff: round(annualDiff, 2),
      },
      disclaimer,
      taxRulesVersion: ctx?.config?.versions?.taxRules || null,
    },
  }
}
