/**
 * 露点公式测试
 *
 * 用公开的气象算例做锚点：25 ℃ / 60% 的露点约 16.7 ℃、30 ℃ / 80% 约 26.2 ℃。
 * 这类公式最容易出的错不是语法，而是把 RH 当成小数传进去（0.6 而不是 60），
 * 结果露点算成 −10 ℃，页面却看不出异常，所以这里专门覆盖输入口径的边界。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { dewPoint, MAGNUS_A, MAGNUS_B } from '../src/core/utils/dewpoint.js'

test('典型算例：25 ℃ / 60% → 约 16.7 ℃', () => {
  const value = dewPoint(25, 60)
  assert.ok(Math.abs(value - 16.68) < 0.05, `实际 ${value}`)
})

test('典型算例：30 ℃ / 80% → 约 26.2 ℃', () => {
  const value = dewPoint(30, 80)
  assert.ok(Math.abs(value - 26.16) < 0.05, `实际 ${value}`)
})

test('边界：饱和空气露点等于气温', () => {
  const value = dewPoint(18, 100)
  assert.ok(Math.abs(value - 18) < 0.05, `实际 ${value}`)
})

test('边界：湿度 0 无法取对数，返回 null 而不是 −Infinity', () => {
  assert.equal(dewPoint(20, 0), null)
  assert.equal(dewPoint(20, -5), null)
})

test('异常：非数值入参一律返回 null', () => {
  assert.equal(dewPoint(null, 60), null)
  assert.equal(dewPoint(20, undefined), null)
  assert.equal(dewPoint('abc', 60), null)
  assert.equal(dewPoint(NaN, 60), null)
  assert.equal(dewPoint(20, NaN), null)
  assert.equal(dewPoint(Infinity, 60), null)
})

test('异常：空字符串不被当成 0 ℃', () => {
  assert.equal(dewPoint('', 60), null)
})

test('系数可覆盖：默认常量与魔数一致', () => {
  assert.equal(MAGNUS_A, 17.27)
  assert.equal(MAGNUS_B, 237.7)
  const custom = dewPoint(25, 60, { a: 17.27, b: 200 })
  assert.ok(Math.abs(custom - dewPoint(25, 60)) > 1, '换系数后结果应明显不同')
})
