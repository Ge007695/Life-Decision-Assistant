/**
 * 测试公共设施：让测试读同一份 public/data/*.json 并走同一个 createConfig()。
 *
 * 为什么不在测试里手写一份假配置：配置就是产品的一部分（阈值、税率、穿衣表）。
 * 用真配置跑，才能保证“测试通过的模型”= “线上跑的模型”；
 * 需要验证配置驱动时，再基于真数据做浅拷贝改一个字段。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createConfig } from '../src/core/config.js'
import { run } from '../src/core/engine.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(ROOT, 'public', 'data')

export function readData(file) {
  return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'))
}

export function readAll() {
  return {
    indices: readData('indices.json'),
    holidays: readData('holidays.json'),
    taxRules: readData('tax-rules.json'),
    clothingTable: readData('clothing-table.json'),
    cities: readData('cities.json'),
    checklists: readData('checklists.json'),
  }
}

/** 固定时钟，保证 holiday 的默认“今天”在测试里可复现 */
export const FIXED_NOW = '2026-11-02T12:00:00+08:00'

export const config = createConfig(readAll(), { now: FIXED_NOW })

/** 走引擎执行单条规则，顺带校验 DecisionResult 拼装是否正常 */
export function runRule(id, input) {
  return run(id, input, config)
}

/** 造一份逐小时序列：湿度按给定数组输出，时间从 00:00 开始逐小时 */
export function makeHourly(humidityList, base = {}) {
  return humidityList.map((humidity, index) => ({
    time: `${String(index).padStart(2, '0')}:00`,
    temp: base.temp ?? 26,
    humidity,
    windSpeed: base.windSpeed ?? 3,
    windDir: base.windDir ?? 'S',
    precipProb: base.precipProb ?? 20,
    solar: base.solar ?? 0,
  }))
}

/** 断言对象里没有任何 NaN / Infinity 字段（规则层最怕把 NaN 交给页面） */
export function assertNoNaN(value, path = '$') {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} 出现非有限数字：${value}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoNaN(item, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertNoNaN(item, `${path}.${key}`)
  }
}
