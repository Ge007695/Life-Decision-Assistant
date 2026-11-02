/**
 * 出行指数测试
 *
 * 用户要的其实是两个布尔值：带不带伞、要不要推迟。
 * 所以除了等级，还要断言 meta 里的这两个判断，别让页面自己再去猜。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { runRule, assertNoNaN } from './_helpers.mjs'

test('典型值：降水概率 10%、风速 2 m/s → 4 级，不用带伞', () => {
  const result = runRule('umbrella', { precipProb: 10, windSpeed: 2 })
  assert.equal(result.level, 4)
  assert.equal(result.meta.bringUmbrella, false)
  assert.equal(result.meta.delayOuting, false)
  assert.match(result.headline, /不用带伞/)
  assertNoNaN(result)
})

test('边界：降水概率 60% → 提醒带伞', () => {
  const result = runRule('umbrella', { precipProb: 60, windSpeed: 3 })
  assert.equal(result.meta.bringUmbrella, true)
  assert.equal(result.level, 2)
  assert.ok(result.actions.some((item) => item.includes('伞')))
})

test('边界：降水 85% + 大风 → 1 级，建议推迟', () => {
  const result = runRule('umbrella', { precipProb: 85, windSpeed: 10 })
  assert.equal(result.level, 1)
  assert.equal(result.meta.delayOuting, true)
  assert.equal(result.meta.bringUmbrella, true)
})

test('依据里必须同时列出降水概率与风速', () => {
  const result = runRule('umbrella', { precipProb: 60, windSpeed: 3 })
  const keys = result.evidence.map((item) => item.key)
  assert.ok(keys.includes('precipProb'))
  assert.ok(keys.includes('windSpeed'))
  const rain = result.evidence.find((item) => item.key === 'precipProb')
  assert.match(rain.value, /60/)
})

test('异常：两项数据都缺失 → 降级，不假装下雨', () => {
  const result = runRule('umbrella', {})
  assert.equal(result.degraded, true)
  assert.match(result.headline, /缺少|数据/)
  assert.equal(result.meta.bringUmbrella, null)
  assertNoNaN(result)
})

test('异常：只缺风速时用降水概率单独判断，标记降级', () => {
  const result = runRule('umbrella', { precipProb: 5 })
  assert.equal(result.degraded, true)
  assert.equal(result.meta.bringUmbrella, false)
  assertNoNaN(result)
})
