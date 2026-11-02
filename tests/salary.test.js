/**
 * 工资测算测试
 *
 * 两个口径各测一遍，另外专门测“日薪 × 工作日”这条输入路径：
 * 实习生最常见的输入就是日薪 200 元、这个月去了 11 天，
 * 如果这条路径算不出月收入，整个页面就废了一半。
 *
 * 另外必须确认免责声明真的出现在结果里——这是契约里写死的合规要求，
 * 不是“以后有空再加”的装饰。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { runRule, assertNoNaN } from './_helpers.mjs'

test('劳务报酬：3000 元 → 减 800 定额，预扣 440，到手 2560', () => {
  const result = runRule('salary', { mode: 'service', gross: 3000 })
  assert.equal(result.level, 4)
  assert.equal(result.meta.deductionTotal, 800)
  assert.equal(result.meta.taxable, 2200)
  assert.equal(result.meta.rate, 0.2)
  assert.equal(result.meta.withheld, 440)
  assert.equal(result.meta.netMonthly, 2560)
  assertNoNaN(result)
})

test('劳务报酬：10000 元 → 减 20%，预扣 1600，到手 8400', () => {
  const result = runRule('salary', { mode: 'service', gross: 10000 })
  assert.equal(result.meta.deductionTotal, 2000)
  assert.equal(result.meta.taxable, 8000)
  assert.equal(result.meta.withheld, 1600)
  assert.equal(result.meta.netMonthly, 8400)
})

test('劳务报酬：60000 元进入 30% 档并减速算扣除 2000', () => {
  const result = runRule('salary', { mode: 'service', gross: 60000 })
  assert.equal(result.meta.taxable, 48000)
  assert.equal(result.meta.rate, 0.3)
  assert.equal(result.meta.quickDeduction, 2000)
  assert.equal(result.meta.withheld, 12400)
})

test('工资薪金：月薪 10000、1 个月 → 应纳税所得额 5000，预扣 150', () => {
  const result = runRule('salary', { mode: 'salary', gross: 10000, months: 1 })
  assert.equal(result.meta.taxable, 5000)
  assert.equal(result.meta.rate, 0.03)
  assert.equal(result.meta.withheld, 150)
  assert.equal(result.meta.netMonthly, 9850)
})

test('工资薪金：月薪 20000、12 个月、专项附加 2000 → 累计税率 20%，按月均展示', () => {
  const result = runRule('salary', { mode: 'salary', gross: 20000, months: 12, specialDeduction: 2000 })
  // 累计口径：240000 − (5000+2000)×12 = 156000，20% − 16920 = 14280
  assert.equal(result.meta.cumulative.taxable, 156000)
  assert.equal(result.meta.cumulative.withheld, 14280)
  // 页面明细按月均口径
  assert.equal(result.meta.taxable, 13000)
  assert.equal(result.meta.deduction, 7000)
  assert.equal(result.meta.withheld, 1190)
  assert.equal(result.meta.rate, 0.2)
  assert.equal(result.meta.netMonthly, 18810)
})

test('日薪 × 工作日：200 元 / 11 天 → 月收入 2200', () => {
  const result = runRule('salary', { mode: 'service', dayRate: 200, workDays: 11 })
  assert.equal(result.meta.gross, 2200)
  assert.equal(result.meta.taxable, 1400)
  assert.equal(result.meta.withheld, 280)
  assert.equal(result.meta.netMonthly, 1920)
})

test('年度汇算：劳务报酬预扣偏多，应显示可退税额并带免责声明', () => {
  const result = runRule('salary', { mode: 'service', gross: 3000 })
  const disclaimer = result.evidence.find((item) => item.key === 'disclaimer')
  assert.ok(disclaimer, 'evidence 里必须有免责声明')
  assert.equal(disclaimer.value, '本结果为估算，实际以税务部门年度汇算为准')
  assert.equal(result.meta.annual.tax, 0)
  assert.ok(result.meta.annual.diff > 0, '低收入的劳务预扣应在汇算时退回')
  assert.ok(result.actions.some((item) => item.includes('本结果为估算')))
})

test('年度汇算：工资口径按月薪外推 12 个月', () => {
  const result = runRule('salary', { mode: 'salary', gross: 10000 })
  assert.equal(result.meta.annual.income, 120000)
  assert.equal(result.meta.annual.taxable, 60000)
  assert.equal(result.meta.annual.tax, 3480)
})

test('边界：收入刚好等于劳务扣除阈值 4000 时按定额减除', () => {
  const result = runRule('salary', { mode: 'service', gross: 4000 })
  assert.equal(result.meta.deductionTotal, 800)
  assert.equal(result.meta.taxable, 3200)
})

test('异常：非法收入与缺失口径都被拦下', () => {
  const negative = runRule('salary', { mode: 'service', gross: -100 })
  assert.equal(negative.degraded, true)
  assert.equal(negative.level, 0)

  const dirty = runRule('salary', { mode: 'service', gross: '一万' })
  assert.equal(dirty.degraded, true)

  const noMode = runRule('salary', { gross: 8000 })
  assert.equal(noMode.degraded, true)
  assert.match(noMode.headline, /口径/)

  const zero = runRule('salary', { mode: 'salary', gross: 0 })
  assert.equal(zero.degraded, true)
  assertNoNaN(zero)
})

test('边界：专项附加扣除超过收入时税额归零，不为负', () => {
  const result = runRule('salary', { mode: 'salary', gross: 6000, months: 1, specialDeduction: 3000 })
  assert.equal(result.meta.taxable, 0)
  assert.equal(result.meta.withheld, 0)
  assert.equal(result.meta.netMonthly, 6000)
})
