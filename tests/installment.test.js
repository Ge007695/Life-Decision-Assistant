/**
 * 分期真实年化测试
 *
 * 这是“花钱模块”的核心说服点：平台说每期 0.6%，真实年化接近 13.8%。
 * 测试要保证三件事：
 *   · 数值站得住（真实年化明显高于名义 7.2%）
 *   · 页面要展示的三算法对比数据是完整的
 *   · 边界情况给中文原因，任何地方都不能出现 NaN
 *
 * 费率单位按表单口径传百分数（0.6 = 每期 0.6%），与页面输入框一致。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { runRule, assertNoNaN } from './_helpers.mjs'

const BASE = { principal: 6000, periods: 12, feeRate: 0.6 }

test('典型值：6000 元 / 12 期 / 每期 0.6% → 真实年化远高于名义 7.2%', () => {
  const result = runRule('installment', BASE)
  assert.equal(result.meta.ok, true)
  assert.ok(Math.abs(result.meta.nominalAnnualRate - 0.072) < 1e-12)
  assert.ok(result.meta.annualRate > 0.13, `真实年化 ${result.meta.annualRate}`)
  assert.ok(result.meta.ratio > 1.8)
  assert.match(result.headline, /真实年化 13\.\d+%/)
  assert.match(result.headline, /名义 7\.2%/)
  assertNoNaN(result)
})

test('每期还款与总手续费可核对', () => {
  const result = runRule('installment', BASE)
  assert.equal(result.meta.payment, 536)
  const fee = result.evidence.find((item) => item.key === 'totalFee')
  assert.match(fee.value, /432/)
})

test('meta 里带三种算法的对比数据（页面要展示这张表）', () => {
  const result = runRule('installment', BASE)
  const list = result.meta.methods
  assert.equal(list.length, 3)
  assert.deepEqual(list.map((item) => item.method), ['bisection', 'newton', 'scan'])
  for (const item of list) {
    assert.equal(item.ok, true)
    assert.equal(typeof item.iterations, 'number')
    assert.equal(typeof item.error, 'number')
    assert.equal(typeof item.annualRate, 'number')
  }
  const iterations = list.map((item) => item.iterations)
  assert.equal(new Set(iterations).size, 3, '三种算法迭代次数应不同')
  // 兼容别名：页面适配器读 methods，文档/报告口径用 comparison
  assert.deepEqual(result.meta.comparison, result.meta.methods)
})

test('三算法年化结果互相印证（差 < 0.01 个百分点）', () => {
  const result = runRule('installment', BASE)
  const annuals = result.meta.methods.map((item) => item.annualRate)
  const spread = (Math.max(...annuals) - Math.min(...annuals)) * 100
  assert.ok(spread < 0.01, `极差 ${spread} 个百分点`)
})

test('小数口径：feeRateUnit=decimal 时 0.006 等价于百分数 0.6', () => {
  const percent = runRule('installment', BASE)
  const decimal = runRule('installment', { ...BASE, feeRate: 0.006, feeRateUnit: 'decimal' })
  assert.ok(Math.abs(percent.meta.annualRate - decimal.meta.annualRate) < 1e-12)
})

test('边界：0 期 → 明确说明原因，不显示 NaN', () => {
  const result = runRule('installment', { ...BASE, periods: 0 })
  assert.equal(result.level, 0)
  assert.equal(result.degraded, true)
  assert.match(result.headline, /期数/)
  assert.doesNotMatch(result.headline, /NaN/)
  assertNoNaN(result)
})

test('边界：负本金 → 明确说明原因', () => {
  const result = runRule('installment', { ...BASE, principal: -6000 })
  assert.match(result.headline, /本金/)
  assert.doesNotMatch(result.headline, /NaN/)
})

test('边界：费率超出上限（填成 15% 每期）被拦下', () => {
  const result = runRule('installment', { ...BASE, feeRate: 15 })
  assert.match(result.headline, /费率/)
  assert.doesNotMatch(result.headline, /NaN/)
})

test('边界：负数费率被拦下', () => {
  const result = runRule('installment', { ...BASE, feeRate: -0.6 })
  assert.match(result.headline, /负数|费率/)
  assertNoNaN(result)
})

test('边界：短分期与长分期的年化差异', () => {
  const short = runRule('installment', { ...BASE, periods: 3 })
  const long = runRule('installment', { ...BASE, periods: 24 })
  assert.ok(long.meta.annualRate > short.meta.annualRate, '期数越长，真实年化越高')
  assert.ok(short.meta.nominalRate < long.meta.nominalRate, '名义成本随期数线性增长')
})

test('异常：全部缺失不抛异常', () => {
  const result = runRule('installment', {})
  assert.equal(result.degraded, true)
  assert.equal(typeof result.headline, 'string')
  assertNoNaN(result)
})
