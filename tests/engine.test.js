/**
 * 引擎拼装测试
 *
 * 两个曾经踩过的坑，各留一条用例钉住：
 *   · 注入时钟（options.now）没被用上，回测导出的 updatedAt 全是跑脚本的墙上时间
 *   · 指数节点缺 version，导致 evidence.configVersion 恒为 null，
 *     报告里看不出某条结论是哪个版本的配置算出来的
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { run } from '../src/core/engine.js'
import { config } from './_helpers.mjs'

const INPUT = {
  temp: 30,
  humidity: 45,
  windSpeed: 4,
  precipProb: 5,
  solar: 650,
}

test('注入时钟：updatedAt 用调用方给的时间，不是跑脚本的墙上时间', () => {
  const result = run('drying', INPUT, config, { now: '2026-11-05T10:00:00+08:00' })
  assert.equal(result.updatedAt, '2026-11-05T02:00:00.000Z')
})

test('注入时钟：不传时用当前时间，且仍是合法 ISO', () => {
  const before = Date.now()
  const result = run('drying', INPUT, config)
  const stamp = new Date(result.updatedAt).getTime()
  assert.ok(Number.isFinite(stamp), result.updatedAt)
  assert.ok(stamp >= before - 5000 && stamp <= Date.now() + 5000, '应接近当前时间')
})

test('注入时钟：非法时间退回当前时间而不是 Invalid Date', () => {
  const result = run('drying', INPUT, config, { now: 'not-a-date' })
  assert.ok(Number.isFinite(new Date(result.updatedAt).getTime()), result.updatedAt)
})

test('配置版本：每个指数节点都要有 version，evidence.configVersion 不能是 null', () => {
  for (const id of ['drying', 'damp', 'umbrella']) {
    const node = config.indices[id]
    assert.ok(node?.version, `indices.json#${id} 缺少 version`)
  }
  const result = run('drying', INPUT, config)
  assert.equal(result.meta.configVersion, config.indices.drying.version)
  assert.notEqual(result.meta.configVersion, null)
})

test('配置版本：结论的 version 字段始终有值', () => {
  const result = run('drying', INPUT, config)
  assert.match(String(result.version), /^\d+\.\d+\.\d+$/)
})
