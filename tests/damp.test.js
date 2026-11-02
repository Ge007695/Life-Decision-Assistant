/**
 * 返潮预警测试
 *
 * 这是全项目最容易“虚警”的规则：只看到湿度 90% 就预警，深圳一年有大半时间在报警。
 * 所以测试的重点是三条条件的联合判定——全中才是 1 级，全不中必须干净地给 4 级，
 * 只有一条命中时不能跳到“高发”。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { runRule, makeHourly, assertNoNaN } from './_helpers.mjs'

test('三条全中 → level 1「高发」', () => {
  const result = runRule('damp', {
    temp: 26,
    humidity: 92,
    indoorTemp: 21,
    windDir: 'S',
    windSpeed: 3,
    hourly: makeHourly([90, 91, 92, 92, 93, 92, 91, 90]),
  })
  assert.equal(result.level, 1)
  assert.equal(result.levelLabel, '高发')
  assert.equal(result.meta.hitCount, 3)
  for (const item of result.evidence) assert.equal(item.hit, true)
  assertNoNaN(result)
})

test('三条全不中 → level 4「无」', () => {
  const result = runRule('damp', {
    temp: 20,
    humidity: 55,
    indoorTemp: 25,
    windDir: 'N',
    windSpeed: 5,
    hourly: makeHourly([60, 58, 55, 52, 50, 48]),
  })
  assert.equal(result.level, 4)
  assert.equal(result.levelLabel, '无')
  assert.equal(result.meta.hitCount, 0)
})

test('只有偏南风一条命中 → 不应预警到高发', () => {
  const result = runRule('damp', {
    temp: 24,
    humidity: 60,
    indoorTemp: 22,
    windDir: 'SE',
    windSpeed: 3,
    hourly: makeHourly([60, 62, 61, 60, 58, 59, 60, 61]),
  })
  assert.equal(result.meta.hitCount, 1)
  assert.equal(result.level, 3)
  assert.ok(result.level > 1)
})

test('高湿但断档（缺小时）不计为连续', () => {
  const hourly = [
    { time: '01:00', humidity: 90 },
    { time: '02:00', humidity: 91 },
    { time: '06:00', humidity: 93 },
    { time: '07:00', humidity: 92 },
  ]
  const result = runRule('damp', {
    temp: 26,
    humidity: 92,
    indoorTemp: 21,
    windDir: 'S',
    windSpeed: 3,
    hourly,
  })
  // 最长连续只有 2 小时，达不到 6 小时的高湿条件
  assert.equal(result.meta.humidityStreak, 2)
  assert.ok(result.meta.hitCount < 3)
})

test('没有 hourly 时只能按当前一个观测点判断，不会凑满 6 小时', () => {
  const result = runRule('damp', {
    temp: 26,
    humidity: 92,
    indoorTemp: 21,
    windDir: 'S',
    windSpeed: 3,
  })
  assert.equal(result.meta.humidityStreak, 1)
  assert.ok(result.meta.conditions.find((item) => item.key === 'humidity').hit === false)
})

test('室内温度兜底顺序：indoorTemp > pastMinTemp72h > 配置默认值', () => {
  const base = { temp: 26, humidity: 92, windDir: 'S', windSpeed: 3, hourly: makeHourly([92, 92, 92, 92, 92, 92, 92]) }

  const withPast = runRule('damp', { ...base, pastMinTemp72h: 23 })
  assert.equal(withPast.meta.indoorTemp, 23)

  const withBoth = runRule('damp', { ...base, indoorTemp: 20, pastMinTemp72h: 23 })
  assert.equal(withBoth.meta.indoorTemp, 20)

  const withDefault = runRule('damp', base)
  assert.equal(withDefault.meta.indoorTemp, 22)
})

test('异常：缺气温湿度 → 降级，不抛异常', () => {
  const result = runRule('damp', {})
  assert.equal(result.degraded, true)
  assert.equal(result.level, 0)
  assert.match(result.headline, /露点|无法|缺少/)
  assertNoNaN(result)
})

test('异常：缺风向风速 → 结论仍可给出，但标记降级', () => {
  const result = runRule('damp', { temp: 26, humidity: 92, indoorTemp: 21, hourly: makeHourly([92, 92, 92, 92, 92, 92, 92]) })
  assert.equal(result.degraded, true)
  assert.equal(result.meta.conditions.find((item) => item.key === 'wind').hit, false)
  assertNoNaN(result)
})
