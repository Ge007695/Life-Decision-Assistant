/**
 * 历史同期对比（O-11）测试
 *
 * 有一条是真实踩过的坑，必须钉死：
 *   今年预报的日级字段是 precipProb（降水概率），
 *   去年归档给的是 precip（降水量 mm）。
 *   早先把两者都当 precip 取，导致「今年有几天雨」恒为 0，
 *   页面上看起来一切正常，只是数字一直是零——这种错最难被发现。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildHistory, describe, upcoming } from '../src/modules/outing/history.js'

const TODAY = '2026-11-05'

const FORECAST = [
  { date: '2026-11-03', tempMax: 30, tempMin: 24, precipProb: 10 },
  { date: '2026-11-04', tempMax: 29, tempMin: 23, precipProb: 10 },
  { date: '2026-11-05', tempMax: 28, tempMin: 22, precipProb: 80 },
  { date: '2026-11-06', tempMax: 27, tempMin: 21, precipProb: 60 },
  { date: '2026-11-07', tempMax: 26, tempMin: 20, precipProb: 10 },
]

const ARCHIVE = [
  { date: '2025-11-05', tempMax: 25, tempMin: 18, precip: 0 },
  { date: '2025-11-06', tempMax: 26, tempMin: 19, precip: 3.2 },
  { date: '2025-11-07', tempMax: 27, tempMin: 20, precip: 0.4 },
]

test('今年只取今天及以后：接口带回来的过去日期要过滤掉', () => {
  const rows = upcoming(FORECAST, TODAY, 7)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].date, '2026-11-05')
})

test('逐日按位置对齐：第 1 天对去年同期的第 1 天', () => {
  const result = buildHistory({
    forecastDaily: FORECAST,
    historyDaily: ARCHIVE,
    today: TODAY,
  })

  assert.equal(result.status, 'ok')
  assert.equal(result.rows.length, 3)
  assert.equal(result.rows[0].thisDate, '2026-11-05')
  assert.equal(result.rows[0].lastDate, '2025-11-05')
  assert.equal(result.rows[0].deltaMax, 3)
})

test('降水：今年用 precipProb、去年用 precip，两套字段不能混用', () => {
  const result = buildHistory({
    forecastDaily: FORECAST,
    historyDaily: ARCHIVE,
    today: TODAY,
  })

  // 今年：80% 与 60% 两天 ≥50% → 2 天
  assert.equal(result.summary.thisRainDays, 2)
  // 去年：3.2 mm 与 0.4 mm 两天 ≥0.1 mm → 2 天
  assert.equal(result.summary.lastRainDays, 2)
  // 去年累计降水量 = 3.2 + 0.4
  assert.equal(result.summary.lastPrecipSum, 3.6)
})

test('某天缺数据：那天差值为 null，不当 0 参与平均', () => {
  const result = buildHistory({
    forecastDaily: FORECAST,
    historyDaily: [{ date: '2025-11-05', tempMax: 25, tempMin: 18, precip: 0 }],
    today: TODAY,
  })

  assert.equal(result.rows[1].deltaMax, null)
  // 今年只有 11-05 一天能与去年对上，平均最高温取 28（不是三天的均值）
  assert.equal(result.summary.thisAvgMax, 28)
  assert.equal(result.summary.lastAvgMax, 25)
  assert.equal(result.summary.deltaMax, 3)
})

test('一边为空：status 变 insufficient，不硬凑对比', () => {
  const result = buildHistory({ forecastDaily: FORECAST, historyDaily: [], today: TODAY })

  assert.equal(result.status, 'insufficient')
  assert.equal(result.summary.lastCount, 0)
})

test('结论句只陈述差异，不下气候判断', () => {
  const text = describe({
    deltaMax: 2.4,
    deltaMin: -1,
    deltaRainDays: -1,
  })

  assert.match(text, /平均最高温高 2\.4 ℃/)
  assert.match(text, /有雨的天数少 1 天/)
  assert.doesNotMatch(text, /气候|变暖|趋势/)
})

test('差异都很小时说「基本持平」，不硬找话说', () => {
  const text = describe({ deltaMax: 0.2, deltaMin: -0.1, deltaRainDays: 0 })
  assert.equal(text, '和去年同期基本持平')
})
