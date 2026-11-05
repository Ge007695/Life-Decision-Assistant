/**
 * 一周衣物准备（O-8）测试
 *
 * 重点钉两件事：
 *   1. 件数是「天数 / 换洗间隔，向上取整，再封顶」，不是一天一套；
 *   2. 缺数据的日子不能算进档位，也不能让整张清单消失。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { piecesFor } from '../src/core/rules/weeklyWear.js'
import { config, runRule } from './_helpers.mjs'

/** 造一天的日级预报：只给最高最低，和 weather.js 的 daily 字段一致 */
function day(date, tempMax, tempMin) {
  return { date, tempMax, tempMin, precipProb: 10 }
}

test('件数：7 天按两天一换是 4 套，但封顶 3 套', () => {
  assert.equal(piecesFor(7, 2, 3), 3)
  assert.equal(piecesFor(4, 2, 3), 2)
  assert.equal(piecesFor(2, 2, 3), 1)
  assert.equal(piecesFor(1, 2, 3), 1)
})

test('件数：0 天返回 0，非法参数走默认值而不是 NaN', () => {
  assert.equal(piecesFor(0, 2, 3), 0)
  assert.equal(piecesFor(-1, 2, 3), 0)
  assert.ok(Number.isFinite(piecesFor(5, 0, 3)))
  assert.equal(piecesFor(5, 0, 3), 3)
})

test('档位聚合：温差跨档时分成两类，各自给套数', () => {
  const result = runRule('weeklyWear', {
    days: [day('2026-11-05', 30, 24), day('2026-11-06', 29, 23), day('2026-11-07', 16, 8)],
  })

  assert.ok(!result.degraded)
  // 日均 27 / 26 落在「热」档，日均 12 落在「偏凉」档
  assert.equal(result.meta.bands.length, 2)
  assert.equal(result.meta.covered, 3)
  assert.equal(result.actions.length, 2)
  assert.ok(result.meta.totalPieces > 0)
})

test('缺数据的日子进 missing，不参与档位统计', () => {
  const result = runRule('weeklyWear', {
    days: [day('2026-11-05', 30, 24), { date: '2026-11-06', tempMax: null, tempMin: null }],
  })

  assert.equal(result.meta.covered, 1)
  assert.equal(result.meta.total, 2)
  assert.deepEqual(result.meta.missing, ['2026-11-06'])
  // 覆盖 1/2 = 50 分，对应「部分」
  assert.equal(result.score, 50)
})

test('一天都没有数据时降级，且不输出空清单', () => {
  const result = runRule('weeklyWear', { days: [] })

  assert.equal(result.degraded, true)
  assert.equal(result.levelLabel, '数据不足')
  assert.deepEqual(result.actions, [])
  assert.equal(result.meta.bands.length, 0)
})

test('换洗间隔与上限来自 indices.json，不在代码里写死', () => {
  const node = config.indices.weeklyWear
  assert.equal(node.changeEveryDays, 2)
  assert.equal(node.maxPerBand, 3)
  // 规则必须读到配置值：7 天用配置里的 2/3 应得 3 套
  assert.equal(piecesFor(7, node.changeEveryDays, node.maxPerBand), 3)
})
