/**
 * 假期出行准备清单测试（T-5）
 *
 * 这个功能最容易出的两个错，正好是对应的两组断言：
 *   1. 拿不到预报却照样给建议 —— 必须显式标「超出预报范围」，不能编造；
 *   2. 把穿衣和带伞的结论混成一张单子 —— 「遮阳伞」和「不用带伞」并排出现是错的表达。
 *
 * 用真配置（holidays.json 里 2026 已公布、2027 待公布）跑，
 * 需要「次年已公布」的分支时，在真配置基础上浅拷贝一份 2027 节点。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { config, assertNoNaN } from './_helpers.mjs'
import {
  FORECAST_HORIZON_DAYS,
  buildRangePlan,
  buildTripPlan,
  groupByDate,
  holidayDates,
  mergeChecklist,
  resolveTarget,
  shiftDate,
  summariseDay,
} from '../src/modules/time/tripPlan.js'

/** 造一段逐小时预报；dayOverride 按「第几天」覆盖当日数值 */
function forecast(startDate, days, dayOverride = {}) {
  const out = []
  for (let d = 0; d < days; d += 1) {
    const date = shiftDate(startDate, d)
    const override = dayOverride[d] || {}
    for (let h = 0; h < 24; h += 1) {
      out.push({
        time: `${date}T${String(h).padStart(2, '0')}:00`,
        temp: override.temp ?? 26,
        humidity: override.humidity ?? 60,
        windSpeed: override.windSpeed ?? 2,
        windDir: 'NNE',
        precipProb: override.precipProb ?? 10,
        solar: override.solar ?? 0,
      })
    }
  }
  return out
}

/** 在真配置上补一个已公布的次年节点，用来验证跨年分支 */
const configWithNextYear = {
  ...config,
  holidays: {
    ...config.holidays,
    years: {
      ...config.holidays.years,
      2027: {
        status: 'official',
        source: '测试用节点',
        holidays: [{ name: '元旦', start: '2027-01-01', end: '2027-01-03' }],
        makeupWorkdays: [],
        schoolTerms: [],
      },
    },
  },
}

// ---------------------------------------------------------------- 聚合口径

test('groupByDate：按本地日期分组，不跨日混串', () => {
  const byDate = groupByDate(forecast('2026-10-01', 3))
  assert.equal(byDate.size, 3)
  assert.equal(byDate.get('2026-10-01').length, 24)
  assert.equal(byDate.get('2026-10-03').length, 24)
})

test('groupByDate：非法时间字符串直接跳过，不产生 NaN 键', () => {
  const byDate = groupByDate([{ time: 'not-a-date' }, { time: '2026-10-01T09:00' }])
  assert.equal(byDate.size, 1)
  assert.ok(byDate.has('2026-10-01'))
})

test('summariseDay：气温取均值，风速与降水概率取当日最大值', () => {
  // 风速 1…24、降水概率 0…23，用来区分「均值」和「最坏时段」
  const hours = []
  for (let h = 0; h < 24; h += 1) {
    hours.push({ time: `2026-10-01T${String(h).padStart(2, '0')}:00`, temp: 20 + h, humidity: 60, windSpeed: h + 1, precipProb: h })
  }
  const day = summariseDay('2026-10-01', hours)

  assert.equal(day.temp, 31.5, '日均温应为 (20+43)/2')
  assert.equal(day.tempMin, 20)
  assert.equal(day.tempMax, 43)
  assert.equal(day.windSpeed, 24, '风速必须取最大值，否则午后阵风被抹平')
  assert.equal(day.precipProb, 23, '降水概率取当日最大值')
  assert.equal(day.hourCount, 24)
})

test('summariseDay：关键字段缺失返回 null，不硬凑出结论', () => {
  const noHumidity = forecast('2026-10-01', 1).map((hour) => ({ ...hour, humidity: null }))
  assert.equal(summariseDay('2026-10-01', noHumidity), null)

  const noWind = forecast('2026-10-01', 1).map((hour) => ({ ...hour, windSpeed: null }))
  assert.equal(summariseDay('2026-10-01', noWind), null, '缺风速就没有带伞结论，按没数据处理')

  assert.equal(summariseDay('2026-10-01', []), null)
  assert.equal(summariseDay('2026-10-01', undefined), null)
})

// ---------------------------------------------------------------- 目标解析

test('resolveTarget：本年还有假期时取最近的，含正在进行中的', () => {
  const before = resolveTarget(config, '2026-09-28')
  assert.equal(before.status, 'ok')
  assert.equal(before.holiday.name, '国庆节')
  assert.equal(before.daysUntil, 3)
  assert.equal(before.length, 7)
  assert.equal(before.ongoing, false)

  const during = resolveTarget(config, '2026-10-03')
  assert.equal(during.holiday.name, '国庆节')
  assert.equal(during.ongoing, true, '假期中应标记 ongoing')
})

test('resolveTarget：本年结束且次年待公布时给 pending，不做日期推断', () => {
  const target = resolveTarget(config, '2026-11-03')
  assert.equal(target.status, 'pending')
  assert.equal(target.holiday, null, 'pending 年份不能凭空造假期')
  assert.equal(target.year, 2027)
  // 11-03 到次年元旦 59 天：11 月剩 27 天 + 12 月 31 天 + 1 月 1 日
  assert.equal(target.newYear.days, 59)
})

test('resolveTarget：次年已公布时跨年取第一个假期', () => {
  const target = resolveTarget(configWithNextYear, '2026-11-03')
  assert.equal(target.status, 'ok')
  assert.equal(target.holiday.name, '元旦')
  assert.equal(target.crossYear, true)
  assert.equal(target.daysUntil, 59)
  assert.equal(target.length, 3)
})

test('resolveTarget：日期非法时返回 none 而不是抛异常', () => {
  const target = resolveTarget(config, 'abc')
  assert.equal(target.status, 'none')
  assert.ok(target.note.length > 0)
})

// ---------------------------------------------------------------- 计划状态

test('buildTripPlan：pending 状态不产出任何清单', () => {
  const plan = buildTripPlan({ config, today: '2026-11-03', hourlyAll: forecast('2026-11-03', 7) })
  assert.equal(plan.status, 'pending')
  assert.equal(plan.days.length, 0)
  assert.deepEqual(plan.checklist, { outfit: [], gear: [], worstDay: null })
  assert.match(plan.message, /尚未公布/)
  assertNoNaN(plan)
})

test('buildTripPlan：假期完全超出预报窗口时判 tooFar，不用气候常识填空', () => {
  // 中秋 09-25，距 09-01 还有 24 天，远超 7 天预报
  const plan = buildTripPlan({ config, today: '2026-09-01', hourlyAll: forecast('2026-09-01', 7) })
  assert.equal(plan.status, 'tooFar')
  assert.equal(plan.target.holiday.name, '中秋节')
  assert.match(plan.message, /超出/)
  assert.equal(plan.coverage.inForecast, 0)
  assert.deepEqual(plan.checklist, { outfit: [], gear: [], worstDay: null }, '太远就什么都不给，这是 A 方案的底线')
})

test('buildTripPlan：预报覆盖假期前 4 天时，后 3 天标超出范围', () => {
  // 今天 09-28，预报 7 天到 10-04；国庆 10-01—10-07
  const plan = buildTripPlan({ config, today: '2026-09-28', hourlyAll: forecast('2026-09-28', 7) })

  assert.equal(plan.status, 'ok')
  assert.equal(plan.days.length, 7, '国庆共 7 天')
  assert.deepEqual(plan.coverage, { inForecast: 4, total: 7 })

  const covered = plan.days.filter((day) => day.inForecast)
  const missing = plan.days.filter((day) => !day.inForecast)
  assert.equal(covered.length, 4)
  assert.equal(missing.length, 3)

  for (const day of missing) {
    assert.equal(day.reason, '超出预报范围')
    assert.equal(day.clothing, undefined, '没数据的天不允许挂结论')
    assert.equal(day.umbrella, undefined)
  }
})

test('buildTripPlan：逐日结论来自内核规则，不在这里重算', () => {
  const plan = buildTripPlan({ config, today: '2026-09-28', hourlyAll: forecast('2026-09-28', 7) })
  const day = plan.days.find((item) => item.inForecast)

  // clothing 的 headline 形如「体感 26.3 ℃，热：短袖 + 短裤/薄长裤」
  assert.match(day.clothing.headline, /体感/)
  assert.equal(day.clothing.configRef, 'indices.json#clothing')
  assert.ok(day.umbrella.headline.length > 0)
  assertNoNaN(day)
})

test('buildTripPlan：雨天与晴天的带伞结论不同', () => {
  // 预报从 09-28 起算，第 3 天就是 10-01：那天大雨，其余晴好
  const rainy = forecast('2026-09-28', 7, { 3: { precipProb: 95, windSpeed: 9 } })
  const plan = buildTripPlan({ config, today: '2026-09-28', hourlyAll: rainy })
  const wet = plan.days.find((day) => day.date === '2026-10-01')
  const dry = plan.days.find((day) => day.date === '2026-10-02')

  assert.notEqual(wet.umbrella.level, dry.umbrella.level, '降水概率 95% 与 10% 必须判出不同等级')
  assert.equal(wet.umbrella.meta.bringUmbrella, true)
  assert.equal(dry.umbrella.meta.bringUmbrella, false)
})

test('buildTripPlan：假期在窗口内但没取到天气，判 noWeather 而不是 tooFar', () => {
  // 今天 09-28，距国庆 3 天，本该有数据却一条没有——这是取数失败，不是「太远」
  const plan = buildTripPlan({ config, today: '2026-09-28', hourlyAll: [] })
  assert.equal(plan.status, 'noWeather')
  assert.match(plan.message, /没取到/)

  // 同样没数据，但假期在 30 天后：主因确实是太远
  const farAway = buildTripPlan({ config, today: '2026-09-01', hourlyAll: [] })
  assert.equal(farAway.status, 'tooFar')
  assert.match(farAway.message, /超出/)
})

// ---------------------------------------------------------------- 清单汇总

test('mergeChecklist：衣物与雨具分组，不混成一张自相矛盾的单子', () => {
  const plan = buildTripPlan({ config, today: '2026-09-28', hourlyAll: forecast('2026-09-28', 7) })
  const { outfit, gear } = plan.checklist

  assert.ok(outfit.length > 0, '应有衣物建议')
  assert.ok(gear.length > 0, '应有雨具建议')

  // 两组不能有交集：交集意味着同一条建议被归到了两类里
  const overlap = outfit.filter((item) => gear.includes(item))
  assert.deepEqual(overlap, [])
})

test('mergeChecklist：雨具按最坏一天准备，不把晴雨结论堆在一起', () => {
  // 10-01 大雨，其余晴好：若取并集，会同时得到「推迟出门」和「不用带伞」
  const mixed = forecast('2026-09-28', 7, { 3: { precipProb: 95, windSpeed: 9 } })
  const plan = buildTripPlan({ config, today: '2026-09-28', hourlyAll: mixed })
  const { gear, worstDay } = plan.checklist

  assert.equal(worstDay, '2026-10-01', '最差的一天应是 10-01')
  assert.ok(gear.length > 0)
  assert.ok(!gear.includes('不用带伞'), '假期里有雨天时，清单不能出现「不用带伞」')
  assert.ok(gear.some((item) => item.includes('伞')), '雨天应给出带伞动作')
})

test('mergeChecklist：全程晴天时雨具清单就是「不用带伞」那一组', () => {
  const plan = buildTripPlan({ config, today: '2026-09-28', hourlyAll: forecast('2026-09-28', 7) })
  const { gear } = plan.checklist
  assert.deepEqual(gear, ['不用带伞', '适合步行或骑行出门'])
})

test('mergeChecklist：衣物取并集以覆盖温差，雨具不取并集', () => {
  // 冷热交替的几天，衣物清单应同时出现厚薄两套
  const varied = forecast('2026-09-28', 7, { 3: { temp: 12 }, 4: { temp: 30 } })
  const plan = buildTripPlan({ config, today: '2026-09-28', hourlyAll: varied })
  const { outfit } = plan.checklist

  assert.ok(outfit.length >= 2, `温差跨度大时衣物应有多条，实际 ${outfit.length} 条`)
  assert.equal(new Set(outfit).size, outfit.length, '衣物清单内部不能有重复')
})

test('mergeChecklist：跳过超出预报范围的天', () => {
  const days = [
    { date: '2026-09-30', inForecast: false, clothing: { actions: ['不该出现'] }, umbrella: { actions: ['也不该出现'] } },
    { date: '2026-10-01', inForecast: true, clothing: { actions: ['短袖'] }, umbrella: { actions: ['带伞'], level: 2 } },
  ]
  assert.deepEqual(mergeChecklist(days), { outfit: ['短袖'], gear: ['带伞'], worstDay: '2026-10-01' })
})

// ---------------------------------------------------------------- 降级与边界

test('buildRangePlan：未来 7 天降级清单只覆盖真实预报的天', () => {
  const plan = buildRangePlan({ config, today: '2026-11-03', hourlyAll: forecast('2026-11-03', 3) })
  assert.equal(plan.status, 'ok')
  assert.equal(plan.days.length, FORECAST_HORIZON_DAYS, '默认给 7 天')
  assert.deepEqual(plan.coverage, { inForecast: 3, total: 7 })
})

test('buildRangePlan：完全没数据时返回 noWeather', () => {
  const plan = buildRangePlan({ config, today: '2026-11-03', hourlyAll: [] })
  assert.equal(plan.status, 'noWeather')
  assert.ok(plan.message.length > 0)
  assert.deepEqual(plan.checklist, { outfit: [], gear: [], worstDay: null })
})

test('holidayDates：展开含首尾，且不会因异常日期死循环', () => {
  assert.deepEqual(holidayDates({ start: '2026-10-01', end: '2026-10-03' }), [
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
  ])
  assert.deepEqual(holidayDates({ start: '2026-10-05', end: '2026-10-01' }), [], '结束早于开始应返回空')
  assert.deepEqual(holidayDates({ start: '', end: '' }), [])
  assert.deepEqual(holidayDates(null), [])
})

test('shiftDate：跨月跨年都算对', () => {
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01')
  assert.equal(shiftDate('2026-11-30', 1), '2026-12-01')
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28')
  assert.equal(shiftDate('bad', 1), '')
})
