/**
 * 穿衣建议测试
 *
 * 规则只做“体感温度 → 查表”，所以测试分两层：
 *   1) 区间查找本身（含临界点，min 含 max 不含）
 *   2) 端到端结论（headline 必须带体感温度，校准偏移能改变档位）
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { runRule, readData, assertNoNaN } from './_helpers.mjs'
import { lookupOutfit } from '../src/core/rules/clothing.js'

const TABLE = readData('clothing-table.json').table

test('区间查找：min 含、max 不含', () => {
  assert.equal(lookupOutfit(TABLE, 18).label, '舒适')
  assert.equal(lookupOutfit(TABLE, 26).label, '热')
  assert.equal(lookupOutfit(TABLE, 10).label, '偏凉')
  assert.equal(lookupOutfit(TABLE, 9.99).label, '冷')
})

test('区间查找：超出表格范围夹到最近一档', () => {
  assert.equal(lookupOutfit(TABLE, 45).label, '炎热')
  assert.equal(lookupOutfit(TABLE, -30).label, '严寒')
  assert.equal(lookupOutfit(TABLE, null), null)
  assert.equal(lookupOutfit([], 20), null)
})

test('典型值：20 ℃ / 60% / 2 m/s → 体感约 19 ℃，舒适档', () => {
  const result = runRule('clothing', { temp: 20, humidity: 60, windSpeed: 2 })
  assert.equal(result.level, 4)
  assert.equal(result.levelLabel, '舒适')
  assert.match(result.headline, /体感 19\.2 ℃/)
  assert.ok(result.actions.includes('短袖 + 薄外套'))
  assertNoNaN(result)
})

test('典型值：−5 ℃ / 50% / 5 m/s → 严寒档，出门要手套围巾', () => {
  const result = runRule('clothing', { temp: -5, humidity: 50, windSpeed: 5 })
  assert.equal(result.level, 2)
  assert.equal(result.levelLabel, '严寒')
  assert.ok(result.actions.includes('羽绒服 + 保暖内衣'))
  assert.ok(result.actions.includes('手套'))
})

test('校准偏移：负偏移让体感降到「偏凉」档', () => {
  const base = runRule('clothing', { temp: 20, humidity: 60, windSpeed: 2 })
  const cold = runRule('clothing', { temp: 20, humidity: 60, windSpeed: 2, feedbackOffset: -4 })
  assert.equal(base.levelLabel, '舒适')
  assert.equal(cold.levelLabel, '偏凉')
  assert.ok(cold.meta.felt < base.meta.felt)
})

test('校准偏移：feedback 只作依据说明，不自己编偏移量', () => {
  const result = runRule('clothing', { temp: 20, humidity: 60, windSpeed: 2, feedbackOffset: 2, feedback: 'cold' })
  assert.equal(result.meta.offset, 2)
  const item = result.evidence.find((one) => one.key === 'feedbackOffset')
  assert.ok(item)
  assert.match(item.value, /偏冷/)
})

test('异常：缺气温 → 走配置兜底文案，标记降级', () => {
  const result = runRule('clothing', { humidity: 60, windSpeed: 2 })
  assert.equal(result.degraded, true)
  assert.match(result.headline, /体感数据缺失/)
  assertNoNaN(result)
})

test('异常：脏字符串不造成 NaN', () => {
  const result = runRule('clothing', { temp: '25度', humidity: 'abc', windSpeed: null })
  assert.ok(result.degraded)
  assertNoNaN(result)
})
