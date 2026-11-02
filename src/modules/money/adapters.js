/**
 * 花钱模块 · 结论适配
 *
 * 内核返回的是通用 DecisionResult：数值可能放在 meta 里，也可能以人类可读的字符串
 * 放在 evidence 里（「¥5,232.00」「20%」）。页面不允许猜规则内部结构，所以统一在这里
 * 抽出数字；任何字段缺失都返回 null，页面显示「—」，绝不显示 NaN。
 *
 * 注意：这里只做「读数」与「减法算差额」这类展示层运算，
 * 税额、税率、IRR 一律来自规则返回，不在页面重算。
 */

/** 金额字段：meta 的键名 + evidence 的中文标签都列出来，容忍规则实现命名差异 */
const SALARY_FIELDS = {
  gross: {
    keys: ['gross', 'income', 'grossIncome', 'monthlyIncome', 'totalIncome', 'incomeAmount'],
    labels: ['税前收入', '月收入', '收入'],
  },
  deduction: {
    keys: [
      'deductionTotal',
      'deduction',
      'deductions',
      'totalDeduction',
      'deductionAmount',
      'deductible',
    ],
    labels: ['扣除额', '扣除合计', '费用扣除', '减除费用'],
  },
  taxable: {
    keys: ['taxable', 'taxableIncome', 'taxableAmount', 'taxBase'],
    labels: ['应纳税所得额', '计税所得额', '计税依据'],
  },
  rate: {
    keys: ['rate', 'taxRate', 'appliedRate', 'applicableRate', 'withholdingRate'],
    labels: ['适用税率', '预扣率', '税率'],
    kind: 'taxRate',
  },
  quickDeduction: {
    keys: ['quickDeduction', 'quickDeductionAmount', 'quick'],
    labels: ['速算扣除数', '速算扣除'],
  },
  tax: {
    keys: ['tax', 'taxAmount', 'withheld', 'withholding', 'taxDue', 'prepaidTax'],
    labels: ['预扣税额', '应纳税额', '预扣税', '个税'],
  },
  net: {
    keys: ['net', 'netMonthly', 'netIncome', 'netPay', 'netAmount', 'takeHome', 'afterTax'],
    labels: ['到手金额', '到手', '实发', '税后'],
  },
}

/** 三种算法的显示名：规则返回英文 id 时兜底翻译 */
const METHOD_LABELS = {
  bisection: '二分法',
  bisect: '二分法',
  newton: '牛顿法',
  newtonRaphson: '牛顿法',
  scan: '扫描插值',
  scanInterpolation: '扫描插值',
  'scan-interpolation': '扫描插值',
  interpolation: '扫描插值',
}

/** 数字阈值：超过它就认为规则给的是「百分数数值」而不是小数比例 */
const RATE_PERCENT_THRESHOLD = {
  taxRate: 1,
  annualRate: 3,
  monthlyRate: 1,
}

function isPercentText(value) {
  return typeof value === 'string' && value.includes('%')
}

/**
 * 从任意写法里抠出数字：
 *   '¥5,232.00' → 5232；'13.03%' → 13.03；'约 36 元' → 36
 * 抠不出数字返回 null（不是 0，避免把「没给」当成「零」）。
 */
function toNumeric(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const text = raw.replace(/[,，\s]/g, '')
  const match = /-?\d+(?:\.\d+)?/.exec(text)
  if (!match) return null
  const num = Number(match[0])
  return Number.isFinite(num) ? num : null
}

/** evidence 同时按 key 与 label 建索引，两种命中方式互补 */
function indexEvidence(evidence) {
  const list = Array.isArray(evidence) ? evidence.filter((item) => item && typeof item === 'object') : []
  const byKey = new Map()
  for (const item of list) {
    if (item.key && !byKey.has(String(item.key))) byKey.set(String(item.key), item)
  }
  return { list, byKey }
}

function normalizeRate(value, isPercent, kind) {
  if (isPercent) return value / 100
  const threshold = RATE_PERCENT_THRESHOLD[kind] ?? 1
  return Math.abs(value) > threshold ? value / 100 : value
}

/** meta 可能是平铺的，也可能把明细塞在 detail / fields 里 */
function flattenMeta(meta) {
  if (!meta || typeof meta !== 'object') return {}
  const nested = [meta.detail, meta.fields, meta.breakdown].find(
    (item) => item && typeof item === 'object' && !Array.isArray(item),
  )
  return nested ? { ...meta, ...nested } : meta
}

function pickFromEvidence(spec, evidence) {
  for (const key of spec.keys) {
    const item = evidence.byKey.get(key)
    if (!item) continue
    const num = toNumeric(item.value)
    if (num === null) continue
    return spec.kind ? normalizeRate(num, isPercentText(item.value), spec.kind) : num
  }
  for (const hint of spec.labels) {
    const item = evidence.list.find((entry) => String(entry.label || '').includes(hint))
    if (!item) continue
    const num = toNumeric(item.value)
    if (num === null) continue
    return spec.kind ? normalizeRate(num, isPercentText(item.value), spec.kind) : num
  }
  return null
}

function pickField(spec, meta, evidence) {
  // 1. meta 同名字段（规则最可能的写法）
  for (const key of spec.keys) {
    const raw = meta[key]
    if (raw === undefined || raw === null) continue
    const num = toNumeric(raw)
    if (num === null) continue
    return spec.kind ? normalizeRate(num, isPercentText(raw), spec.kind) : num
  }
  // 2/3. evidence 的 key，再退到中文标签（规则换了命名也能对上）
  return pickFromEvidence(spec, evidence)
}

/**
 * 适配工资测算结论
 * @param {object|null} result engine.run('salary') 的返回
 * @param {object} [fallback] 本次使用的入参，用于规则没回填收入时兜底显示
 * @returns {{available:boolean, degraded:boolean, notWired:boolean, reason:string, fields:object|null}}
 */
export function adaptSalaryResult(result, fallback = {}) {
  const empty = {
    available: false,
    degraded: false,
    notWired: false,
    reason: '尚未测算',
    fields: null,
  }
  if (!result) return empty
  if (result.degraded) {
    return {
      available: false,
      degraded: true,
      // 引擎兜底的降级版本号固定 0.0.0，用来区分「规则没接入」与「规则算了但算不出」
      notWired: result.version === '0.0.0',
      reason: result.headline || '该规则尚未接入',
      fields: null,
    }
  }

  const meta = flattenMeta(result.meta)
  const evidence = indexEvidence(result.evidence)

  const fields = {}
  for (const [name, spec] of Object.entries(SALARY_FIELDS)) {
    fields[name] = pickField(spec, meta, evidence)
  }

  // 规则没回填收入时用本次入参兜底，明细表第一行不至于空着
  if (fields.gross === null && Number.isFinite(Number(fallback.gross))) {
    fields.gross = Number(fallback.gross)
  }

  if (fields.net === null) {
    return {
      available: false,
      degraded: false,
      notWired: false,
      reason: '规则返回的结果里没有到手金额，无法展示明细',
      fields,
    }
  }
  return { available: true, degraded: false, notWired: false, reason: '', fields }
}

/** 把 meta 里的三算法数据统一成 [{method, iterations, error, annualRate, monthlyRate}] */
function extractMethods(meta) {
  // 规则实现把三种算法的原始结果放在 meta.comparison 里，直接拿来渲染，不再重算
  const raw = meta.comparison || meta.methods || meta.algorithms || meta.compare || meta.solvers
  if (Array.isArray(raw)) return raw.map(normalizeMethod)
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([key, value]) =>
      normalizeMethod({
        method: key,
        ...(value && typeof value === 'object' ? value : { value }),
      }),
    )
  }
  // 兼容：规则把三种算法直接平铺在 meta 上（meta.bisection / meta.newton / meta.scan）
  const flat = []
  for (const key of ['bisection', 'newton', 'scan', 'scanInterpolation']) {
    const node = meta[key]
    if (node && typeof node === 'object') flat.push(normalizeMethod({ method: key, ...node }))
  }
  return flat
}

function firstNumber(...values) {
  for (const value of values) {
    const num = toNumeric(value)
    if (num !== null) return num
  }
  return null
}

function normalizeMethod(raw) {
  const item = raw && typeof raw === 'object' ? raw : {}
  const name = String(item.method || item.name || item.id || '')
  return {
    method: METHOD_LABELS[name] || name || '算法',
    iterations: firstNumber(item.iterations, item.iteration, item.iters, item.steps, item.count),
    error: firstNumber(item.error, item.residual, item.diff, item.delta, item.tolerance),
    annualRate: firstNumber(item.annualRate, item.annualizedRate, item.apr, item.yearRate),
    monthlyRate: firstNumber(item.monthlyRate, item.monthRate, item.irr, item.r),
  }
}

/**
 * 适配分期结论
 * @param {object|null} result engine.run('installment') 的返回
 * @param {object} [fallback] 本次入参（费率用百分数），用于兜底算名义成本
 * @returns {{available:boolean, degraded:boolean, notWired:boolean, reason:string,
 *   annualRate:number|null, monthlyRate:number|null, nominalRate:number|null,
 *   methods:object[], spread:number|null}}
 */
export function adaptInstallmentResult(result, fallback = {}) {
  const empty = {
    available: false,
    degraded: false,
    notWired: false,
    reason: '尚未计算',
    annualRate: null,
    monthlyRate: null,
    nominalRate: null,
    methods: [],
    spread: null,
  }
  if (!result) return empty
  if (result.degraded) {
    return {
      ...empty,
      degraded: true,
      // 0.0.0 是引擎兜底（规则未注册 / 配置没加载），其余是规则自己判的无解
      notWired: result.version === '0.0.0',
      reason: result.headline || '该规则尚未接入',
      methods: extractMethods(flattenMeta(result.meta)),
    }
  }

  const meta = flattenMeta(result.meta)
  const evidence = indexEvidence(result.evidence)

  const annualRate = pickField(
    {
      keys: ['annualRate', 'annualizedRate', 'realAnnualRate', 'apr', 'yearRate'],
      labels: ['真实年化', '年化', '实际年化'],
      kind: 'annualRate',
    },
    meta,
    evidence,
  )
  const monthlyRate = pickField(
    {
      keys: ['monthlyRate', 'monthRate', 'irr', 'monthlyIrr'],
      labels: ['月利率', '月化'],
      kind: 'monthlyRate',
    },
    meta,
    evidence,
  )

  // 名义年化优先取规则返回值（每期费率 × 12）；规则没给时按「费率 × 期数」兜底
  let nominalRate = pickField(
    {
      keys: ['nominalAnnualRate', 'nominalRate', 'nominal', 'flatRate', 'nominalCost'],
      labels: ['名义年化', '名义费率', '名义成本'],
      kind: 'annualRate',
    },
    meta,
    evidence,
  )
  if (nominalRate === null) {
    const feeRate = Number(fallback.feeRate)
    const periods = Number(fallback.periods)
    if (Number.isFinite(feeRate) && Number.isFinite(periods)) {
      nominalRate = (feeRate * periods) / 100
    }
  }

  const methods = extractMethods(meta)

  // 三种算法的结果差：用于页面动态写出「差 X 个百分点」
  const rates = methods.map((item) => item.annualRate).filter((value) => Number.isFinite(value))
  const spread = rates.length >= 2 ? Math.max(...rates) - Math.min(...rates) : null

  if (annualRate === null) {
    return {
      ...empty,
      reason: '规则未返回真实年化，无法展示结论',
      monthlyRate,
      nominalRate,
      methods,
      spread,
    }
  }
  return {
    available: true,
    degraded: false,
    notWired: false,
    reason: '',
    annualRate,
    monthlyRate,
    nominalRate,
    methods,
    spread,
  }
}

/**
 * 现金流：期初 +本金，此后每期 −(本金 / 期数 + 本金 × 每期费率)。
 * 这是需求书里写明的展示口径，只做四则运算，不涉及 IRR 求解。
 *
 * @returns {{rows: object[], perPeriod: number, total: number}|null}
 */
export function buildCashflow({ principal, periods, feeRate } = {}) {
  const p = Number(principal)
  const n = Number(periods)
  const rate = Number(feeRate) / 100
  if (!Number.isFinite(p) || !Number.isFinite(n) || !Number.isFinite(rate)) return null
  if (p <= 0 || n < 1 || !Number.isInteger(n) || rate < 0) return null

  const perPeriod = p / n + p * rate
  const rows = [{ period: 0, label: '期初', amount: p }]
  for (let i = 1; i <= n; i += 1) {
    rows.push({ period: i, label: `第 ${i} 期`, amount: -perPeriod })
  }
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  return { rows, perPeriod, total }
}
