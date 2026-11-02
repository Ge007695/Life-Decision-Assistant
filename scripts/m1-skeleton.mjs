#!/usr/bin/env node
/**
 * M1 完成判据（工作指导书 第九章）：
 *   项目初始化 → 配置加载 → 引擎调度 → drying 规则，
 *   命令行能打印出一个合法的 DecisionResult。
 *
 * 这个脚本不碰浏览器：用 fs 读同样六份 JSON，走同一个 createConfig()，
 * 证明“回测的模型”与“线上跑的模型”是同一个东西。
 *
 * 运行：npm run m1
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createConfig } from '../src/core/config.js'
import { configure, run, runBatch, listRules } from '../src/core/engine.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'public', 'data')

function readJson(file) {
  return JSON.parse(readFileSync(join(DATA, file), 'utf8'))
}

const raw = {
  indices: readJson('indices.json'),
  holidays: readJson('holidays.json'),
  taxRules: readJson('tax-rules.json'),
  clothingTable: readJson('clothing-table.json'),
  cities: readJson('cities.json'),
  checklists: readJson('checklists.json'),
}

const config = createConfig(raw, { now: Date.now() })
configure(config)

console.log('— 配置校验 —')
if (config.errors.length > 0) {
  for (const error of config.errors) console.log(`  ✗ ${error}`)
  process.exitCode = 1
} else {
  console.log(`  ✓ 六份配置全部通过（指数 v${config.versions.indices}，税率 ${config.versions.taxRules}）`)
}

/** 造一份晴好天气的入参：湿度 60%、风速 3、降水概率 10% */
function sampleInput() {
  const now = new Date()
  const hourly = []
  for (let i = 0; i < 24; i += 1) {
    const hour = new Date(now.getTime() + i * 3600_000)
    const hh = String(hour.getHours()).padStart(2, '0')
    const daylight = hour.getHours() >= 7 && hour.getHours() <= 18
    hourly.push({
      time: `${hh}:00`,
      temp: 24 - Math.abs(12 - hour.getHours()) * 0.4,
      humidity: 58 + (daylight ? 0 : 8),
      windSpeed: 3.1,
      windDir: 'SE',
      precipProb: 10,
      solar: daylight ? 520 : 0,
    })
  }
  return {
    temp: 24.1,
    humidity: 60,
    windSpeed: 3.1,
    windDir: 'SE',
    precipProb: 10,
    solar: 520,
    hourly,
  }
}

const input = sampleInput()

console.log('\n— 单条规则：drying —')
const result = run('drying', input)
console.log(JSON.stringify(result, null, 2))

console.log('\n— 结构断言 —')
const REQUIRED = ['id', 'version', 'level', 'levelLabel', 'score', 'headline', 'actions', 'evidence', 'configRef', 'updatedAt']
const problems = []
for (const field of REQUIRED) {
  if (!(field in result)) problems.push(`缺少字段 ${field}`)
}
if (typeof result.level !== 'number' || result.level < 0 || result.level > 4) problems.push('level 必须是 0—4')
if (typeof result.score !== 'number' || result.score < 0 || result.score > 100) problems.push('score 必须是 0—100')
if (!Array.isArray(result.actions)) problems.push('actions 必须是数组')
if (!Array.isArray(result.evidence)) problems.push('evidence 必须是数组')
if (!result.configRef.startsWith('indices.json#')) problems.push('configRef 应指向 indices.json 节点')
if (Number.isNaN(new Date(result.updatedAt).getTime())) problems.push('updatedAt 必须是可解析的时间')

if (problems.length > 0) {
  for (const problem of problems) console.log(`  ✗ ${problem}`)
  process.exitCode = 1
} else {
  console.log('  ✓ DecisionResult 十个必备字段齐全，取值域合法')
}

console.log('\n— 批量调度 —')
const all = runBatch(listRules(), input)
for (const item of all) {
  const flag = item.degraded ? '降级' : '正常'
  console.log(`  · ${item.id.padEnd(12)} L${item.level} ${String(item.score).padStart(5)}  ${flag}  ${item.headline}`)
}

console.log('\n— 配置生效验证（工作指导书 4.5 第二条）—')
const tweaked = createConfig({
  ...raw,
  indices: {
    ...raw.indices,
    indices: {
      ...raw.indices.indices,
      drying: {
        ...raw.indices.indices.drying,
        weights: { ...raw.indices.indices.drying.weights, humidity: 0.5, temp: 0.2, windSpeed: 0, precipProb: 0.25, solar: 0.05 },
      },
    },
  },
})
const tweakedResult = run('drying', input, tweaked)
console.log(`  默认权重结论：${result.headline}（${result.score} 分）`)
console.log(`  调高湿度权重：${tweakedResult.headline}（${tweakedResult.score} 分）`)
console.log(
  result.score === tweakedResult.score
    ? '  ✗ 权重改动没有影响结论，配置未真正生效'
    : '  ✓ 权重改动立即改变结论，配置文件确实在驱动模型',
)
if (result.score === tweakedResult.score) process.exitCode = 1

console.log(`\nM1 判据：${process.exitCode ? '未通过' : '通过'}`)
