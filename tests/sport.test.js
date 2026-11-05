/**
 * 运动适宜度（O-9）测试
 *
 * 这条规则与其它指数最大的区别是「气温中间最好」——
 * 不能用线性归一化，否则 18 ℃ 会被判成中间分。用例里专门钉这一点。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { config, runRule } from './_helpers.mjs'

/** 理想条件下的输入：气温在 12—24 之间、湿度在 30—70 之间、AQI 优、紫外线低 */
const IDEAL = { temp: 18, humidity: 50, aqi: 30, uv: 1.5 }

test('理想条件：四个维度都满分，等级为宜', () => {
  const result = runRule('sport', IDEAL)

  assert.equal(result.score, 100)
  assert.equal(result.levelLabel, '适宜')
  assert.ok(!result.degraded)
  assert.equal(result.meta.missing.length, 0)
})

test('气温是「中间最好」：过冷过热都掉分，且比舒适区低', () => {
  const cool = runRule('sport', { ...IDEAL, temp: 2 })
  const comfortable = runRule('sport', { ...IDEAL, temp: 18 })
  const hot = runRule('sport', { ...IDEAL, temp: 36 })

  assert.ok(cool.score < comfortable.score)
  assert.ok(hot.score < comfortable.score)
  // 偏离 10 ℃ × 每度 6 分 → 气温项 40 分；加权后仍应明显低于满分
  assert.ok(hot.score < 90)
})

test('空气质量按分档降分：优 100、良 80、中度污染 30', () => {
  const excellent = runRule('sport', { ...IDEAL, aqi: 30 })
  const good = runRule('sport', { ...IDEAL, aqi: 80 })
  const moderate = runRule('sport', { ...IDEAL, aqi: 180 })

  assert.ok(excellent.score > good.score)
  assert.ok(good.score > moderate.score)
  // AQI 权重 30%，从 100 分档掉到 30 分档应减少约 21 分
  assert.ok(Math.abs(excellent.score - moderate.score - 21) < 0.5)
  const aqiEvidence = moderate.evidence.find((item) => item.key === 'aqi')
  assert.match(aqiEvidence.value, /中度污染/)
})

test('紫外线高时给出改时段的具体建议', () => {
  const result = runRule('sport', { ...IDEAL, uv: 6.5 })

  assert.ok(result.actions.some((text) => text.includes('10:00—16:00')))
})

test('缺 AQI 与紫外线：按剩余权重重算，且 headline 说明结论不完整', () => {
  const result = runRule('sport', { temp: 18, humidity: 50 })

  assert.equal(result.degraded, true)
  assert.deepEqual(result.meta.missing.sort(), ['aqi', 'uv'])
  // 缺失维度按剩余权重重归一，不应因缺数据被判成低分
  assert.equal(result.score, 100)
  assert.match(result.headline, /未取到/)
  // evidence 里必须标 missing，页面才能显示「缺失」而不是 0 分
  const aqiEvidence = result.evidence.find((item) => item.key === 'aqi')
  assert.equal(aqiEvidence.missing, true)
  assert.equal(aqiEvidence.value, '缺失')
})

test('四个维度全缺时降级，不给「适宜运动」这种无依据结论', () => {
  const result = runRule('sport', {})

  assert.equal(result.degraded, true)
  assert.equal(result.levelLabel, '数据不足')
  assert.deepEqual(result.actions, [])
})

test('紫外线为 0（夜间或阴天）不算缺数据', () => {
  const result = runRule('sport', { ...IDEAL, uv: 0 })

  assert.ok(!result.degraded)
  const uvEvidence = result.evidence.find((item) => item.key === 'uv')
  assert.notEqual(uvEvidence.missing, true)
})

test('headline 点名最弱的维度', () => {
  // 气温 36 ℃ 得分最低，headline 应指出受气温影响
  const result = runRule('sport', { ...IDEAL, temp: 36 })

  assert.match(result.headline, /气温/)
  assert.equal(result.meta.weakest, 'temp')
})

test('权重与阈值来自 indices.json，代码里不出现裸数字', () => {
  const node = config.indices.sport
  const sum = Object.values(node.weights).reduce((acc, value) => acc + value, 0)
  assert.ok(Math.abs(sum - 1) < 1e-6)
  assert.equal(node.thresholds.temp.idealMin, 12)
  assert.equal(node.thresholds.temp.idealMax, 24)
})
