/**
 * IRR 三算法测试
 *
 * 重点不是“能不能算出一个数”，而是三件事：
 *   1) 数值对不对（6000 元 / 12 期 / 每期 0.6% 的真实年化远高于名义 7.2%）
 *   2) 三种算法是否互相印证（年化差 < 0.01 个百分点，但迭代次数完全不同）
 *   3) 边界是否都能给出原因而不是 NaN
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  solveIrr,
  irrBisection,
  irrNewton,
  irrScan,
  buildCashflows,
  npv,
  MAX_PERIODS,
} from '../src/core/utils/irr.js'

const CASES = [
  { principal: 6000, periods: 12, feeRate: 0.006 },
  { principal: 3000, periods: 6, feeRate: 0.005 },
  { principal: 20000, periods: 24, feeRate: 0.0075 },
]

test('现金流严格按期初 +P、此后每期 −(P/n + P×feeRate) 构造', () => {
  const flows = buildCashflows(6000, 12, 0.006)
  assert.equal(flows.length, 13)
  assert.equal(flows[0], 6000)
  assert.ok(Math.abs(flows[1] + (500 + 36)) < 1e-9)
})

test('典型值：6000 元 / 12 期 / 每期 0.6% 的真实年化明显高于 7.2%', () => {
  const result = solveIrr(6000, 12, 0.006)
  assert.equal(result.ok, true)
  assert.ok(result.annualRate > 0.13, `真实年化 ${result.annualRate}`)
  assert.ok(result.annualRate > 0.072 * 1.8, '应当接近名义费率的两倍')
  assert.ok(Math.abs(npv(result.monthlyRate, buildCashflows(6000, 12, 0.006))) < 1e-3)
})

test('三算法互相印证：年化差 < 0.01 个百分点，迭代次数各不相同', () => {
  for (const item of CASES) {
    const flows = buildCashflows(item.principal, item.periods, item.feeRate)
    const results = [irrBisection(flows), irrNewton(flows), irrScan(flows)]
    for (const one of results) assert.equal(one.ok, true, `${one.method} 应求得解`)

    const annuals = results.map((one) => (1 + one.rate) ** 12 - 1)
    const spread = (Math.max(...annuals) - Math.min(...annuals)) * 100
    assert.ok(spread < 0.01, `年化极差 ${spread} 个百分点，超过 0.01`)

    const iterations = results.map((one) => one.iterations)
    assert.equal(new Set(iterations).size, 3, `迭代次数应互不相同：${iterations.join(', ')}`)
    assert.ok(iterations[1] < iterations[0], '牛顿法迭代次数应少于二分法')
    assert.ok(iterations[2] > 1000, '扫描法迭代次数应是千级')
  }
})

test('每种算法都返回迭代次数与最终误差', () => {
  for (const fn of [irrBisection, irrNewton, irrScan]) {
    const result = fn({ principal: 6000, periods: 12, feeRate: 0.006 })
    assert.equal(typeof result.iterations, 'number')
    assert.ok(result.iterations > 0)
    assert.equal(typeof result.error, 'number')
    assert.ok(result.error >= 0)
    assert.equal(typeof result.method, 'string')
  }
})

test('边界：0 期返回明确原因，不返回 NaN', () => {
  const zero = solveIrr(6000, 0, 0.006)
  assert.equal(zero.ok, false)
  assert.equal(zero.reason, 'invalid-periods')
  assert.match(zero.message, /期数/)
  assert.equal(zero.annualRate, null)
})

test('边界：负本金、零本金、非小数期数都被拦下', () => {
  const negative = solveIrr(-5000, 12, 0.006)
  assert.equal(negative.ok, false)
  assert.equal(negative.reason, 'invalid-principal')
  assert.match(negative.message, /本金/)

  assert.equal(solveIrr(0, 12, 0.006).reason, 'invalid-principal')
  assert.equal(solveIrr(6000, 12.5, 0.006).reason, 'invalid-periods')
})

test('边界：期数过大不做硬算', () => {
  const result = solveIrr(6000, MAX_PERIODS + 1, 0.006)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'periods-too-large')
  assert.match(result.message, /期数/)
})

test('边界：负数费率与百分数误填被拦下', () => {
  assert.equal(solveIrr(6000, 12, -0.006).reason, 'invalid-fee-rate')
  assert.equal(solveIrr(6000, 12, 0.6).reason, 'invalid-fee-rate')
})

test('边界：现金流没有符号变化 → 无解', () => {
  const result = irrBisection([-100, -100, -100])
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-sign-change')
  assert.equal(result.rate, null)

  assert.equal(irrNewton([100, 100]).reason, 'no-sign-change')
  assert.equal(irrScan([100, 100]).reason, 'no-sign-change')
})

test('边界：正负交替的现金流检测到多解', () => {
  // 1 − 5x + 6x² = 0 → x = 0.5 / 0.3333 → r = 100% / 200%
  const flows = [1, -5, 6]
  const scan = irrScan(flows)
  assert.equal(scan.ok, false)
  assert.equal(scan.reason, 'multiple-roots')
  assert.ok(scan.roots.length >= 2)
  assert.equal(irrBisection(flows).reason, 'multiple-roots')
})

test('边界：非法现金流数组直接拒绝', () => {
  assert.equal(irrBisection([]).reason, 'invalid-cashflows')
  assert.equal(irrBisection([1, NaN]).reason, 'invalid-cashflows')
  assert.equal(solveIrr('abc', 12, 0.006).ok, false)
  assert.equal(solveIrr(null, null, null).ok, false)
})

test('费率为 0 时真实年化应为 0', () => {
  const result = solveIrr(6000, 12, 0)
  assert.equal(result.ok, true)
  assert.ok(Math.abs(result.annualRate) < 1e-6, `实际 ${result.annualRate}`)
})
