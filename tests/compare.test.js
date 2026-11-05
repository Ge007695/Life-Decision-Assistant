/**
 * 两地对比（O-10）测试
 *
 * 核心约束：两地结论必须来自同一份规则代码，所以这里不手算分数，
 * 只验证「同样输入能得到同样结论」「缺一边就不给差值」这类结构性质。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildCompare } from '../src/modules/outing/compare.js'
import { config } from './_helpers.mjs'

function hourlySeries(precipProb, humidity = 55) {
  return Array.from({ length: 12 }, (_, index) => ({
    time: `2026-11-05T${String(9 + index).padStart(2, '0')}:00`,
    temp: 26,
    humidity,
    windSpeed: 3,
    windDir: 'S',
    precipProb,
    solar: 500,
  }))
}

function weather(overrides = {}) {
  return {
    date: '2026-11-05',
    temp: 26,
    humidity: 60,
    windSpeed: 2,
    precipProb: 10,
    solar: 500,
    hourly: hourlySeries(10),
    daily: [
      { date: '2026-11-05', tempMax: 30, tempMin: 24, precipProb: 10 },
      { date: '2026-11-06', tempMax: 29, tempMin: 23, precipProb: 60 },
      { date: '2026-11-07', tempMax: 31, tempMin: 25, precipProb: 70 },
    ],
    ...overrides,
  }
}

const CITY_A = { id: 'a', name: '甲城' }
const CITY_B = { id: 'b', name: '乙城' }

test('逐项指标：两地的值、差值与方向都对', () => {
  const result = buildCompare({
    config,
    left: { city: CITY_A, weather: weather({ temp: 26, precipProb: 10 }) },
    right: { city: CITY_B, weather: weather({ temp: 29.5, precipProb: 55 }) },
    settings: {},
  })

  const temp = result.metrics.find((item) => item.key === 'temp')
  assert.equal(temp.a, '26')
  assert.equal(temp.b, '29.5')
  assert.equal(temp.delta, 3.5)
  assert.match(temp.deltaText, /高 3\.5 ℃/)

  const rain = result.metrics.find((item) => item.key === 'precipProb')
  assert.equal(rain.delta, 45)
  // 概率差用「个百分点」，不是百分比
  assert.match(rain.deltaText, /个百分点/)
})

test('周汇总：7 天最高/最低取极值，有雨天数按概率 ≥50% 计', () => {
  const result = buildCompare({
    config,
    left: { city: CITY_A, weather: weather() },
    right: { city: CITY_B, weather: weather({ daily: [
      { date: '2026-11-05', tempMax: 20, tempMin: 10, precipProb: 80 },
      { date: '2026-11-06', tempMax: 22, tempMin: 12, precipProb: 90 },
    ] }) },
    settings: {},
  })

  const maxRow = result.weekRows.find((row) => row.key === 'tempMax')
  assert.equal(maxRow.a, '31')
  assert.equal(maxRow.b, '22')

  const rainRow = result.weekRows.find((row) => row.key === 'rainyDays')
  assert.equal(rainRow.a, '2')
  assert.equal(rainRow.b, '2')
})

test('一边少了某个指标：差值给 null，不用 0 顶替', () => {
  const result = buildCompare({
    config,
    left: { city: CITY_A, weather: weather() },
    right: { city: CITY_B, weather: weather({ temp: null }) },
    settings: {},
  })

  const temp = result.metrics.find((item) => item.key === 'temp')
  assert.equal(temp.b, '—')
  assert.equal(temp.delta, null)
  assert.equal(temp.deltaText, '')
})

test('差值文案只说谁高，不说谁更好', () => {
  const result = buildCompare({
    config,
    left: { city: CITY_A, weather: weather({ temp: 20 }) },
    right: { city: CITY_B, weather: weather({ temp: 30 }) },
    settings: {},
  })

  assert.match(result.summary, /乙城/)
  assert.match(result.summary, /高/)
  // 不允许出现带价值判断的词
  assert.doesNotMatch(result.summary, /更好|更优|胜/)
})

test('两地输入相同：四项指数结论完全一致', () => {
  const same = weather()
  const result = buildCompare({
    config,
    left: { city: CITY_A, weather: same },
    right: { city: CITY_B, weather: { ...same } },
    settings: {},
  })

  for (const item of result.indices) {
    assert.ok(item.a && item.b)
    // 同一份代码、同一份输入，结论必须完全一样
    assert.equal(item.a.level, item.b.level)
    assert.equal(item.a.score, item.b.score)
    // 降级项不给差值（null），非降级项必须为 0
    assert.ok(item.delta === 0 || item.delta === null)
  }
})

test('某一边没有天气数据：不崩，指数侧为 null', () => {
  const result = buildCompare({
    config,
    left: { city: CITY_A, weather: weather() },
    right: { city: CITY_B, weather: null },
    settings: {},
  })

  assert.equal(result.right.weather, null)
  for (const item of result.indices) {
    assert.equal(item.b, null)
    assert.equal(item.delta, null)
  }
})
