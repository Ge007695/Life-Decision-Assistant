/**
 * 晾晒指数测试（已完成规则的回归基准）
 *
 * 这里不是重复实现，而是给内核定“不许改坏”的基线：
 * 晴好天气必须是 4 级；湿度升到 84% 时分数掉到 3 级（不能再出现“适宜”）；
 * 缺输入时不许抛异常，必须给出降级结论。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { runRule, assertNoNaN } from './_helpers.mjs'

const GOOD = {
  temp: 30,
  humidity: 45,
  windSpeed: 4,
  precipProb: 5,
  solar: 650,
}

test('典型值：晴好天气 → 4 级「适宜」', () => {
  const result = runRule('drying', GOOD)
  assert.equal(result.level, 4)
  assert.equal(result.levelLabel, '适宜')
  assert.ok(result.score >= 80, `分数 ${result.score}`)
  assert.ok(result.actions.length > 0)
  assertNoNaN(result)
})

test('边界：湿度 84% 时不能给出「适宜」', () => {
  const result = runRule('drying', { ...GOOD, humidity: 84 })
  assert.notEqual(result.levelLabel, '适宜')
  assert.equal(result.level, 3)
  assert.ok(result.score < 80)
})

test('边界：湿度到 90% 且降水概率高 → 掉到 1 级', () => {
  const result = runRule('drying', { temp: 18, humidity: 90, windSpeed: 0.2, precipProb: 80, solar: 60 })
  assert.equal(result.level, 1)
  assert.equal(result.levelLabel, '不宜')
})

test('异常：输入全缺失不抛异常，返回降级结论', () => {
  const result = runRule('drying', {})
  assert.equal(typeof result.headline, 'string')
  assert.ok(Array.isArray(result.actions))
  assert.equal(result.degraded, true)
  assertNoNaN(result)
})

test('异常：脏数据（字符串、null）也能兜住', () => {
  const result = runRule('drying', { temp: 'abc', humidity: null, windSpeed: undefined, precipProb: -5, solar: '600' })
  assert.ok(result.level >= 0 && result.level <= 4)
  assertNoNaN(result)
})

test('时间窗：有逐小时数据时给出具体时段', () => {
  const hourly = Array.from({ length: 24 }, (_, index) => ({
    time: `${String(index).padStart(2, '0')}:00`,
    temp: 28,
    humidity: 45,
    windSpeed: 4,
    precipProb: 5,
    solar: index >= 7 && index <= 18 ? 700 : 0,
  }))
  const result = runRule('drying', { ...GOOD, hourly })
  const window = result.evidence.find((item) => item.key === 'bestWindow')
  assert.ok(window, '应包含最佳时段依据')
  assert.match(window.value, /\d{2}:\d{2}/)
})
