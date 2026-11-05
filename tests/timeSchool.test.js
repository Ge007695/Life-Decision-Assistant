/**
 * 学期节点（T-4）测试
 *
 * 这一项以前一直是「校历待补录」，页面显示一句抱歉。补上数据之后要守住的点：
 *   · 在上课 / 在放假 / 学期末到假期开始这几天的空档，都要能给出天数，不能空白
 *   · 校历只有起止日期，没有教学周次，所以不许输出「第几周」这种推出来的结论
 *   · 数据缺失时明说缺数据，不猜
 *   · 学期只维护一份（顶层 schoolCalendar），旧结构仍能兜底读取
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSchoolStatus, schoolTerms } from '../src/modules/time/countdown.js'
import { validateHolidays } from '../src/core/config.js'
import { config, readData } from './_helpers.mjs'

const calendar = readData('holidays.json').schoolCalendar

test('校历数据完整性：四个时段各自有名称、类型与起止日期', () => {
  assert.ok(Array.isArray(calendar?.terms) && calendar.terms.length >= 4, '至少要录入到寒假')
  for (const term of calendar.terms) {
    assert.ok(term.name, '缺少 name')
    assert.match(term.start, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(term.end, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(term.start <= term.end, `${term.name} 起止颠倒`)
    assert.ok(['term', 'break'].includes(term.kind), `${term.name} 的 kind 非法`)
  }
  assert.ok(calendar.sourceUrl?.startsWith('https://'), '必须带可核查的来源链接')
  assert.ok(calendar.collectedAt, '必须记录采集日期')
})

test('典型值：学期中报「距寒假还有多少天」', () => {
  const status = buildSchoolStatus(config, '2026-11-05')
  assert.equal(status.state, 'inTerm')
  assert.equal(status.name, '寒假')
  assert.equal(status.days, 81)
  assert.equal(status.lead, '距寒假还有')
  assert.ok(status.detail.includes('2026-08-28'), status.detail)
})

test('边界值：学期第一天不返回空，也不出现负数', () => {
  const status = buildSchoolStatus(config, '2026-08-28')
  assert.equal(status.state, 'inTerm')
  assert.equal(status.days, 150)
})

test('典型值：寒假中报「还剩几天」，并给出开学日期', () => {
  const status = buildSchoolStatus(config, '2027-02-01')
  assert.equal(status.state, 'onBreak')
  assert.equal(status.name, '寒假')
  assert.equal(status.days, 22, '2 月 1 日到 2 月 22 日含首尾应为 22 天')
  assert.ok(status.detail.includes('2027-02-22'), status.detail)
})

test('边界值：假期最后一天算还剩 1 天', () => {
  const status = buildSchoolStatus(config, '2027-02-22')
  assert.equal(status.state, 'onBreak')
  assert.equal(status.days, 1)
})

test('空档：学期结束到假期开始的几天仍给倒计时，不掉进「不在校历范围」', () => {
  const status = buildSchoolStatus(config, '2027-01-23')
  assert.equal(status.state, 'inTerm')
  assert.equal(status.gap, true)
  assert.equal(status.days, 2)
  assert.ok(status.detail.includes('已于 2027-01-22 结束'), status.detail)
})

test('异常值：校历范围之外明说数据没有，不推测', () => {
  const status = buildSchoolStatus(config, '2028-05-01')
  assert.equal(status.state, 'unknown')
  assert.equal(status.message, '下学期校历尚未公布')
})

test('异常值：完全没有校历数据时返回 unknown 而不是抛异常', () => {
  const empty = { holidays: { years: {} } }
  const status = buildSchoolStatus(empty, '2026-11-05')
  assert.equal(status.state, 'unknown')
  assert.equal(status.message, '校历数据待补录')
})

test('兼容：旧结构 years.<年份>.schoolTerms 仍能读到', () => {
  const legacy = {
    holidays: {
      years: {
        2026: { schoolTerms: [{ name: '某学期', start: '2026-02-01', end: '2026-06-30' }] },
      },
    },
  }
  const terms = schoolTerms(legacy)
  assert.equal(terms.length, 1)
  assert.equal(terms[0].kind, 'term', '旧数据没有 kind，应补成 term')
})

test('配置校验：kind 写错会在加载阶段报出来', () => {
  const broken = readData('holidays.json')
  broken.schoolCalendar = {
    ...broken.schoolCalendar,
    terms: [{ name: '测试学期', kind: 'holiday', start: '2026-08-28', end: '2027-01-22' }],
  }
  const errors = validateHolidays(broken)
  assert.ok(
    errors.some((message) => message.includes('schoolCalendar.terms[0].kind')),
    errors.join(' / '),
  )
})

test('配置校验：日期格式错误会在加载阶段报出来', () => {
  const broken = readData('holidays.json')
  broken.schoolCalendar = {
    ...broken.schoolCalendar,
    terms: [{ name: '测试学期', kind: 'term', start: '2026/08/28', end: '2027-01-22' }],
  }
  const errors = validateHolidays(broken)
  assert.ok(
    errors.some((message) => message.includes('YYYY-MM-DD')),
    errors.join(' / '),
  )
})
