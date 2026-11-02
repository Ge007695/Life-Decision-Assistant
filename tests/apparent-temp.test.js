/**
 * 体感温度测试
 *
 * 三个方向各测一次：闷热（湿度抬高体感）、有风（风降低体感）、中性算例。
 * 校准偏移单独测，因为它是唯一由用户反馈驱动的入口，
 * 加错符号会让“我觉得冷”变成“再给你降 3 ℃”。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { apparentTemperature, vaporPressure } from '../src/core/utils/apparent-temp.js'

test('典型算例：28 ℃ / 70% / 2 m/s → 约 31.3 ℃', () => {
  const value = apparentTemperature(28, 70, 2)
  assert.ok(Math.abs(value - 31.3) < 0.1, `实际 ${value}`)
})

test('典型算例：10 ℃ / 50% / 5 m/s → 约 4.5 ℃（风让人更冷）', () => {
  const value = apparentTemperature(10, 50, 5)
  assert.ok(Math.abs(value - 4.52) < 0.1, `实际 ${value}`)
})

test('湿度抬高体感：同温同风，湿度高则体感更高', () => {
  const dry = apparentTemperature(28, 30, 2)
  const humid = apparentTemperature(28, 90, 2)
  assert.ok(humid > dry, `${humid} 应大于 ${dry}`)
})

test('风速降低体感：同温同湿，风大则体感更低', () => {
  const calm = apparentTemperature(12, 60, 0)
  const windy = apparentTemperature(12, 60, 8)
  assert.ok(windy < calm, `${windy} 应小于 ${calm}`)
})

test('校准偏移：正偏移整体抬高，负偏移整体压低', () => {
  const base = apparentTemperature(20, 60, 2)
  assert.ok(Math.abs(apparentTemperature(20, 60, 2, 3) - (base + 3)) < 1e-9)
  assert.ok(Math.abs(apparentTemperature(20, 60, 2, -3) - (base - 3)) < 1e-9)
})

test('异常：风速缺失按无风处理，气温/湿度缺失返回 null', () => {
  assert.ok(Number.isFinite(apparentTemperature(20, 60)))
  assert.ok(apparentTemperature(20, 60) > apparentTemperature(20, 60, 5))
  assert.equal(apparentTemperature(null, 60, 2), null)
  assert.equal(apparentTemperature(20, null, 2), null)
  assert.equal(apparentTemperature(undefined, undefined, undefined), null)
  assert.equal(apparentTemperature('x', 60, 2), null)
})

test('水汽压：湿度为 0 时无定义', () => {
  assert.equal(vaporPressure(20, 0), null)
  assert.ok(vaporPressure(20, 60) > vaporPressure(20, 30))
})
