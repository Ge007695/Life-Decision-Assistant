/**
 * 假期倒计时测试
 *
 * 三个必须守住的点：
 *   · 天数用本地日期差，跨月跨年都不能差一天
 *   · 调休补班要能落到具体某天某人需上班（“1 月 4 日（周日）需补班”）
 *   · 2027 这类待公布年份返回结论而不是异常（契约第四节硬要求）
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { runRule, assertNoNaN } from './_helpers.mjs'

test('典型值：2025-12-21 距元旦 11 天，并提示 1 月 4 日补班', () => {
  const result = runRule('holiday', { year: 2026, today: '2025-12-21' })
  assert.equal(result.level, 4)
  assert.equal(result.headline, '距元旦还有 11 天')
  assert.ok(result.actions.some((item) => item.includes('需补班')), result.actions.join(' / '))
  assert.ok(result.actions.some((item) => item.includes('1 月 4 日')), '应提示 1 月 4 日补班')
  assert.ok(result.actions.some((item) => item.includes('周日')), '补班日应带星期')
  assertNoNaN(result)
})

test('典型值：假期中要说明还剩几天（含今天）', () => {
  const result = runRule('holiday', { year: 2026, today: '2026-01-02' })
  assert.equal(result.level, 4)
  assert.equal(result.headline, '正在放元旦假，还剩 2 天')
  assert.equal(result.meta.remaining, 2)
})

test('边界：假期最后一天 → 还剩 1 天', () => {
  const result = runRule('holiday', { year: 2026, today: '2026-01-03' })
  assert.match(result.headline, /还剩 1 天/)
})

test('边界：春节长假首日', () => {
  const result = runRule('holiday', { year: 2026, today: '2026-02-15' })
  assert.match(result.headline, /正在放春节假，还剩 9 天/)
  assert.equal(result.meta.ongoing, '春节')
})

test('待公布年份：level 0、降级、不抛异常', () => {
  const result = runRule('holiday', { year: 2027, today: '2026-11-02' })
  assert.equal(result.level, 0)
  assert.equal(result.degraded, true)
  assert.equal(result.headline, '2027 年安排待公布')
  assert.ok(Array.isArray(result.actions))
  assertNoNaN(result)
})

test('边界：本年度假期已过且次年待公布 → 说清“2027 年安排待公布”', () => {
  const result = runRule('holiday', { year: 2026, today: '2026-11-02' })
  assert.match(result.headline, /待公布/)
  assert.equal(result.level, 0)
  assert.equal(result.degraded, true)
})

test('异常：非法日期与越界年份不抛异常', () => {
  const badToday = runRule('holiday', { year: 2026, today: '2026-13-45' })
  assert.equal(typeof badToday.headline, 'string')

  const weirdYear = runRule('holiday', { year: 'abc', today: '2026-05-01' })
  assert.equal(typeof weirdYear.headline, 'string')
  assertNoNaN(weirdYear)

  const outOfRange = runRule('holiday', { year: 2099, today: '2026-05-01' })
  assert.equal(outOfRange.degraded, true)
  assert.match(outOfRange.headline, /2099 年安排待公布/)
})

test('默认日期：未传 today 时用注入时钟，不崩', () => {
  const result = runRule('holiday', {})
  assert.equal(typeof result.headline, 'string')
  assert.ok(result.headline.length > 0)
})
