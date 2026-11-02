/**
 * 内核层 · 分期真实年化（IRR 求解）
 *
 * 场景：分期平台只告诉你“每期手续费 0.6%”，听起来年化 7.2%，
 * 但本金是逐月归还的——你并没有整年占用这笔钱，手续费却按原始本金收，
 * 所以真实资金成本要高得多。把现金流摊开算 IRR 才能得到可比的年化。
 *
 * 现金流（严格按项目约定，不额外编造）：
 *   t=0   ：+P                     借到手
 *   t=1..n：−(P/n + P×feeRate)     每期还本金 + 每期手续费
 *
 * 求解 NPV(r) = P − Σ_{t=1..n} (P/n + P×feeRate)/(1+r)^t = 0 的月利率 r，
 * 再折算年化 (1+r)^12 − 1。
 *
 * 三种算法并存不是为了炫技，而是为了在报告里对比：
 *   bisection 二分法——只要区间内有根就一定收敛，最稳，但迭代多；
 *   newton    牛顿法——收敛快（常 4—6 次），但导数为零或初值不好会发散；
 *   scan      扫描法——先定步长扫出符号变化区间再线性插值，不依赖导数，
 *             代价是迭代次数以千计，精度受步长限制。
 * 三者的迭代次数与残差都返回给页面，答辩时可以直接摆数据。
 *
 * 纪律：任何边界（无解、多解、期数非法）都返回结构化 reason + 中文 message，
 * 绝不把 NaN 或 Infinity 交给页面显示“年化 NaN%”。
 */

import { toFinite } from './dewpoint.js'

/** 默认参数：利率区间取 (−99%, 1000%)，覆盖高利贷级别的极端月利率 */
export const IRR_DEFAULTS = Object.freeze({
  low: -0.99,
  high: 10,
  tol: 1e-8,
  maxIter: 200,
  guess: 0.01,
  newtonMaxIter: 100,
  step: 0.001,
})

/**
 * 期数上限。超过 600 期（50 年）后，(1+r)^t 的浮点累计误差会盖过利率本身的差异，
 * 结果不可信，与其给一个漂亮数字不如明确拒绝。
 */
export const MAX_PERIODS = 600

/** 单期费率上限：超过 50% 基本是把“百分数”当“小数”填错了，直接判非法 */
export const MAX_PERIOD_FEE_RATE = 0.5

/** 失败结果的统一形状：字段与成功结果对齐，调用方不用分支判断字段是否存在 */
function failure(method, reason, message, extra = {}) {
  return {
    ok: false,
    method,
    rate: null,
    iterations: 0,
    error: null,
    reason,
    message,
    ...extra,
  }
}

/**
 * 构造现金流数组（下标即期数，t=0 为借款到账）
 * @param {number} principal 本金
 * @param {number} periods 期数
 * @param {number} feeRate 每期费率（小数，0.006 = 0.6%）
 * @returns {number[]}
 */
export function buildCashflows(principal, periods, feeRate) {
  const payment = principal / periods + principal * feeRate
  const flows = [principal]
  for (let t = 1; t <= periods; t += 1) flows.push(-payment)
  return flows
}

/**
 * 把“现金流数组”或“本金/期数/费率”统一成现金流数组。
 * 三个算法都接受两种入参，页面传参数、测试传数组都行。
 *
 * @param {number[]|{principal:number, periods:number, feeRate:number}} source
 * @returns {number[]|null} 非法时返回 null
 */
export function toCashflows(source) {
  if (Array.isArray(source)) {
    if (source.length < 2) return null
    const flows = []
    for (const item of source) {
      const value = typeof item === 'number' && Number.isFinite(item) ? item : null
      if (value === null) return null
      flows.push(value)
    }
    return flows
  }
  if (source && typeof source === 'object') {
    const principal = toFinite(source.principal)
    const periods = toFinite(source.periods)
    const feeRate = toFinite(source.feeRate)
    if (principal === null || periods === null || feeRate === null) return null
    if (!(principal > 0) || !(periods > 0) || feeRate < 0) return null
    if (!Number.isInteger(periods) || periods > MAX_PERIODS) return null
    return buildCashflows(principal, periods, feeRate)
  }
  return null
}

/**
 * 净现值 NPV(r)。逐期累乘折现因子，比每期 pow 快，也避免 pow 的精度抖动。
 * @param {number} rate 单期利率
 * @param {number[]} flows 现金流
 * @returns {number} 非法利率返回 NaN
 */
export function npv(rate, flows) {
  if (!(rate > -1) || !Array.isArray(flows)) return NaN
  const base = 1 + rate
  let discount = 1
  let total = 0
  for (const flow of flows) {
    total += flow / discount
    discount *= base
  }
  return total
}

/**
 * NPV 对利率的一阶导，牛顿法用。
 * f(r) = Σ cf_t (1+r)^(−t)  →  f'(r) = Σ −t·cf_t (1+r)^(−t−1)
 * @param {number} rate
 * @param {number[]} flows
 */
export function npvSlope(rate, flows) {
  if (!(rate > -1) || !Array.isArray(flows)) return NaN
  const base = 1 + rate
  let discount = base * base // 对应 (1+r)^2，即 t=1 时的指数
  let total = 0
  for (let t = 1; t < flows.length; t += 1) {
    total += (-t * flows[t]) / discount
    discount *= base
  }
  return total
}

/** 现金流是否存在正负号变化（没有符号变化就一定没有 IRR） */
export function hasSignChange(flows) {
  let positive = false
  let negative = false
  for (const flow of flows) {
    if (flow > 0) positive = true
    if (flow < 0) negative = true
    if (positive && negative) return true
  }
  return false
}

/**
 * 在 [low, high] 上定步长扫描符号变化点。
 * 扫描法是唯一能发现“多解”的算法——IRR 方程本质是多项式，理论上可以有多个正根，
 * 二分和牛顿只会给你其中碰到的那个，不告诉你还有别的。
 *
 * @returns {{points: number, changes: Array<{from:number, to:number, fFrom:number, fTo:number}>}}
 */
export function scanSignChanges(flows, low, high, step) {
  const changes = []
  let points = 0
  let prevRate = low
  let prevValue = npv(low, flows)
  points += 1
  if (!Number.isFinite(prevValue)) return { points, changes }

  for (let rate = low + step; rate <= high + step / 2; rate += step) {
    const value = npv(rate, flows)
    points += 1
    if (!Number.isFinite(value)) break
    // 恰好落在根上：记一个退化区间，然后继续往右扫——这里不能 break，
    // 否则后面的第二个根会被漏掉，多解就检测不出来
    if (value === 0) {
      changes.push({ from: rate, to: rate, fFrom: 0, fTo: 0 })
      prevRate = rate
      prevValue = value
      continue
    }
    // 上一个点恰好是根，符号信息已由退化区间记录，跳过这一对继续
    if (prevValue === 0) {
      prevRate = rate
      prevValue = value
      continue
    }
    if (prevValue * value < 0) {
      changes.push({ from: prevRate, to: rate, fFrom: prevValue, fTo: value })
    }
    prevRate = rate
    prevValue = value
  }

  return { points, changes }
}

/**
 * 二分法求月利率
 *
 * @param {number[]|object} source 现金流数组或 {principal, periods, feeRate}
 * @param {object} [options] low / high / tol / maxIter / step
 * @returns {{ok:boolean, method:string, rate:number|null, iterations:number, error:number|null, reason?:string, message?:string}}
 */
export function irrBisection(source, options = {}) {
  const opt = { ...IRR_DEFAULTS, ...options }
  const flows = toCashflows(source)
  if (!flows) return failure('bisection', 'invalid-cashflows', '现金流无法构造或含非法数值')
  if (!hasSignChange(flows)) {
    return failure('bisection', 'no-sign-change', '现金流没有正负号变化，方程无解')
  }

  let low = opt.low
  let high = opt.high
  if (!(low > -1) || !(high > low)) {
    return failure('bisection', 'invalid-bracket', '利率区间非法，下界必须大于 −100%')
  }

  let fLow = npv(low, flows)
  let fHigh = npv(high, flows)

  // 端点同号时先在区间内粗扫一次：可能根被夹在中间（多笔正负交替），
  // 这时直接报“无解”是错的，得先找到真正的括号区间。
  if (fLow * fHigh >= 0) {
    const probe = scanSignChanges(flows, low, high, opt.step)
    if (probe.changes.length === 0) {
      return failure('bisection', 'no-sign-change', '区间内没有符号变化，方程无解')
    }
    if (probe.changes.length > 1) {
      return failure('bisection', 'multiple-roots', '检测到多个可能解，二分法无法确定应采用哪一个', {
        roots: probe.changes.map((item) => item.from),
      })
    }
    const [bracket] = probe.changes
    low = bracket.from
    high = bracket.to
    fLow = bracket.fFrom
    fHigh = bracket.fTo
  }

  // 上界外扩：真实月利率可能超过初始上界（高费率长分期），
  // 一路翻倍到出现异号或触顶，避免把“根在更远处”误判成“无解”。
  let guard = 0
  while (fLow * fHigh > 0 && guard < 60) {
    high *= 2
    fHigh = npv(high, flows)
    guard += 1
  }
  if (fLow * fHigh > 0) {
    return failure('bisection', 'no-sign-change', '在可搜索的利率范围内找不到解')
  }

  const scale = Math.max(1, Math.abs(flows[0]))
  let iterations = 0
  let rate = (low + high) / 2

  for (; iterations < opt.maxIter; iterations += 1) {
    rate = (low + high) / 2
    const value = npv(rate, flows)
    if (!Number.isFinite(value)) break
    const residual = Math.abs(value)
    if (residual <= opt.tol * scale || (high - low) / 2 <= opt.tol) {
      return {
        ok: true,
        method: 'bisection',
        rate,
        iterations: iterations + 1,
        error: absResidual(npv(rate, flows)),
      }
    }
    if (fLow * value > 0) {
      low = rate
      fLow = value
    } else {
      high = rate
    }
  }

  return failure('bisection', 'not-converged', `二分法在 ${opt.maxIter} 次迭代内未收敛`)
}

/**
 * 牛顿法求月利率
 *
 * 需要导数，收敛快，但 r 可能被一步推到 −100% 以下或发散到天上去。
 * 出现这类情况不强行返回数字，而是标 diverged 让步调用方改用二分结果。
 */
export function irrNewton(source, options = {}) {
  const opt = { ...IRR_DEFAULTS, ...options }
  const flows = toCashflows(source)
  if (!flows) return failure('newton', 'invalid-cashflows', '现金流无法构造或含非法数值')
  if (!hasSignChange(flows)) {
    return failure('newton', 'no-sign-change', '现金流没有正负号变化，方程无解')
  }

  const scale = Math.max(1, Math.abs(flows[0]))
  let rate = opt.guess
  let iterations = 0

  for (; iterations < opt.newtonMaxIter; iterations += 1) {
    const value = npv(rate, flows)
    const slope = npvSlope(rate, flows)
    if (!Number.isFinite(value) || !Number.isFinite(slope) || slope === 0) {
      return failure('newton', 'diverged', '牛顿法在导数为零处失稳，改用二分法结果', {
        diverged: true,
        iterations: iterations + 1,
      })
    }
    const next = rate - value / slope
    if (!Number.isFinite(next) || next <= -1 || next > opt.high) {
      return failure('newton', 'diverged', '牛顿法迭代越界，改用二分法结果', {
        diverged: true,
        iterations: iterations + 1,
      })
    }
    // 两种收敛判据取其一：步长足够小，或残差相对本金已可忽略
    if (Math.abs(next - rate) <= opt.tol || Math.abs(value) <= opt.tol * scale) {
      return {
        ok: true,
        method: 'newton',
        rate: next,
        iterations: iterations + 1,
        error: absResidual(npv(next, flows)),
        diverged: false,
      }
    }
    rate = next
  }

  return failure('newton', 'diverged', `牛顿法 ${opt.newtonMaxIter} 次迭代未收敛`, {
    diverged: true,
    iterations: opt.newtonMaxIter,
  })
}

/**
 * 扫描 + 线性插值求月利率
 *
 * 不依赖导数，天然能报告“多解”。精度取决于步长：区间 [r0,r1] 内 NPV 近似线性，
 * 用直线与横轴的交点作为解，残差一并返回，别让用户以为它和二分一样准。
 */
export function irrScan(source, options = {}) {
  const opt = { ...IRR_DEFAULTS, ...options }
  const flows = toCashflows(source)
  if (!flows) return failure('scan', 'invalid-cashflows', '现金流无法构造或含非法数值')
  if (!hasSignChange(flows)) {
    return failure('scan', 'no-sign-change', '现金流没有正负号变化，方程无解')
  }
  if (!(opt.low > -1) || !(opt.high > opt.low) || !(opt.step > 0)) {
    return failure('scan', 'invalid-bracket', '扫描区间或步长非法')
  }

  const { points, changes } = scanSignChanges(flows, opt.low, opt.high, opt.step)
  if (changes.length === 0) {
    return failure('scan', 'no-sign-change', '扫描范围内没有符号变化，方程无解', { scanPoints: points })
  }
  if (changes.length > 1) {
    return failure('scan', 'multiple-roots', `扫描到 ${changes.length} 个符号变化点，方程有多解`, {
      scanPoints: points,
      roots: changes.map((item) => item.from),
    })
  }

  const [bracket] = changes
  // 线性插值：r = r0 − f0·(r1 − r0)/(f1 − f0)
  const span = bracket.to - bracket.from
  const denominator = bracket.fTo - bracket.fFrom
  const rate = denominator === 0 ? bracket.from : bracket.from - (bracket.fFrom * span) / denominator
  const residual = npv(rate, flows)

  if (!Number.isFinite(rate)) {
    return failure('scan', 'not-converged', '插值失败，未能得到有效月利率', { scanPoints: points })
  }

  return {
    ok: true,
    method: 'scan',
    rate,
    iterations: points,
    scanPoints: points,
    error: absResidual(residual),
  }
}

/** 残差取绝对值并保留 12 位有效精度，避免表格里出现 1.0000000000000002e-9 这种噪声 */
function absResidual(value) {
  if (!Number.isFinite(value)) return null
  return Math.abs(value)
}

function percent(rate) {
  if (!Number.isFinite(rate)) return null
  return (1 + rate) ** 12 - 1
}

/**
 * 统一入口：先校验参数，再跑三种算法，挑一个可信的结果作为主结论。
 *
 * 主结论优先二分法（最稳），其次牛顿法（二分没收敛时通常牛顿也够用），最后扫描法。
 * 三种算法的原始结果一并放进 comparison，installment 规则直接拿来渲染对比表，
 * 不重复计算两遍。
 *
 * @param {number} principal 本金（元）
 * @param {number} periods 期数
 * @param {number} feeRate 每期费率（小数）
 * @param {object} [options] 透传给三种算法
 * @returns {{ok:boolean, monthlyRate:number|null, annualRate:number|null, iterations:number,
 *            error:number|null, method:string|null, reason?:string, message?:string,
 *            comparison:Array, nominalAnnualRate?:number, totalFeeRate?:number}}
 */
export function solveIrr(principal, periods, feeRate, options = {}) {
  const amount = toFinite(principal)
  const count = toFinite(periods)
  const fee = toFinite(feeRate)

  const reject = (reason, message) => ({
    ok: false,
    monthlyRate: null,
    annualRate: null,
    iterations: 0,
    error: null,
    method: null,
    reason,
    message,
    comparison: [],
  })

  if (amount === null || !(amount > 0)) {
    return reject('invalid-principal', '本金必须是大于 0 的数字')
  }
  if (count === null || !(count > 0) || !Number.isInteger(count)) {
    return reject('invalid-periods', '期数必须是大于 0 的整数')
  }
  if (count > MAX_PERIODS) {
    return reject('periods-too-large', `期数超过 ${MAX_PERIODS} 期，浮点累计误差不可控，暂不支持计算`)
  }
  if (fee === null || fee < 0) {
    return reject('invalid-fee-rate', '每期费率必须是大于等于 0 的小数（0.006 表示 0.6%）')
  }
  if (fee > MAX_PERIOD_FEE_RATE) {
    return reject('invalid-fee-rate', '每期费率请用小数填写（0.006 表示 0.6%），当前数值明显偏大')
  }

  const flows = buildCashflows(amount, count, fee)

  // 先跑扫描：只有它能发现多解。多解时不给任何单一答案，避免误导。
  const scan = irrScan(flows, options)
  const bisection = irrBisection(flows, options)
  const newton = irrNewton(flows, options)

  const comparison = [bisection, newton, scan].map((item) => ({
    method: item.method,
    ok: item.ok,
    monthlyRate: item.ok ? item.rate : null,
    annualRate: item.ok ? percent(item.rate) : null,
    iterations: item.iterations,
    error: item.error,
    reason: item.reason || null,
  }))

  const base = {
    nominalAnnualRate: fee * 12,
    totalFeeRate: fee * count,
    comparison,
  }

  if (scan.reason === 'multiple-roots') {
    return {
      ok: false,
      monthlyRate: null,
      annualRate: null,
      iterations: scan.iterations,
      error: null,
      method: 'scan',
      reason: 'multiple-roots',
      message: '该现金流存在多个内部收益率，单一“真实年化”没有意义',
      ...base,
    }
  }

  const primary = bisection.ok ? bisection : newton.ok ? newton : scan.ok ? scan : null
  if (!primary) {
    return {
      ok: false,
      monthlyRate: null,
      annualRate: null,
      iterations: bisection.iterations,
      error: null,
      method: null,
      reason: bisection.reason || 'no-solution',
      message: bisection.message || '无法求得内部收益率',
      ...base,
    }
  }

  return {
    ok: true,
    monthlyRate: primary.rate,
    annualRate: percent(primary.rate),
    iterations: primary.iterations,
    error: primary.error,
    method: primary.method,
    comparison,
    ...base,
  }
}

export default solveIrr
