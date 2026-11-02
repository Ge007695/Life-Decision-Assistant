#!/usr/bin/env node
/**
 * 回测入口 · 在 Node 里跑内核规则（工作指导书 2.3）
 *
 * 这是 Python 调用内核的唯一入口：
 *   node scripts/backtest/run_rule.js <ruleId> <input.json>
 *
 * 为什么不做"Python 重写一遍规则"：规则只有一份实现，Python 只负责数据清洗、
 * 批量调用与统计。这样"回测的模型"与"线上跑的模型"严格一致；另写一套迟早分叉。
 *
 * 用法：
 *   node run_rule.js drying input.json            # 单条，input.json 是对象
 *   node run_rule.js drying batch.json            # 批量，batch.json 是数组
 *   node run_rule.js drying - < batch.json        # 从 stdin 读
 *   node run_rule.js drying input.json --pretty   # 缩进输出，便于人工看
 *   node run_rule.js drying input.json --weights '{"temp":0.2,...}'   # 权重方案对比
 *
 * 输出纪律：
 *   stdout 只有 JSON（一个 DecisionResult 或 DecisionResult 数组），Python 直接 json.loads；
 *   配置警告、参数错误一律走 stderr，不污染 stdout。
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createConfig } from '../../src/core/config.js'
import { configure, run } from '../../src/core/engine.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const DATA_DIR = join(ROOT, 'public', 'data')

/** 与 services/config.js 保持同一份清单，缺一份就在 stderr 报出来 */
const CONFIG_FILES = {
  indices: 'indices.json',
  holidays: 'holidays.json',
  taxRules: 'tax-rules.json',
  clothingTable: 'clothing-table.json',
  cities: 'cities.json',
  checklists: 'checklists.json',
}

function die(message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

function readJsonFile(path) {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  return JSON.parse(text)
}

function loadRawConfig() {
  const raw = {}
  for (const [key, file] of Object.entries(CONFIG_FILES)) {
    raw[key] = readJsonFile(join(DATA_DIR, file))
  }
  return raw
}

/** 解析 `--weights '{"temp":0.2,...}'` 或 `--weights path/to/weights.json` */
function parseWeights(argValue) {
  const text = argValue.trim().startsWith('{') ? argValue : readFileSync(resolve(argValue), 'utf8')
  const weights = JSON.parse(text)
  const sum = Object.values(weights).reduce((acc, value) => acc + Number(value || 0), 0)
  if (Math.abs(sum - 1) > 0.011) {
    // 超过配置校验的 ±0.01 容差时提前说清楚，避免跑完才发现配置被判异常
    die(`--weights 权重之和为 ${sum.toFixed(4)}，必须为 1（允许 ±0.01）`)
  }
  return weights
}

function main() {
  const args = process.argv.slice(2)
  const positional = []
  const options = { pretty: false, weights: null }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--pretty') {
      options.pretty = true
    } else if (arg.startsWith('--weights=')) {
      options.weights = arg.slice('--weights='.length)
    } else if (arg === '--weights') {
      const value = args[i + 1]
      if (value === undefined) die('--weights 缺少参数值')
      options.weights = value
      i += 1
    } else if (arg.startsWith('--')) {
      die(`未知参数：${arg}`)
    } else {
      positional.push(arg)
    }
  }

  const [ruleId, inputPath] = positional
  if (!ruleId || !inputPath) {
    die('用法：node run_rule.js <ruleId> <input.json|-> [--pretty] [--weights <json|file>]', 2)
  }

  let raw
  try {
    raw = loadRawConfig()
  } catch (error) {
    die(`读取配置失败（${DATA_DIR}）：${error.message}`)
  }

  if (options.weights) {
    // 只替换目标指数的权重，其余配置原样交给 createConfig 校验，
    // 保证对比实验里"除了权重以外完全同一份模型"。
    const node = raw.indices?.indices?.[ruleId]
    if (!node) die(`indices.json 中没有 ${ruleId} 节点，无法替换权重`)
    raw.indices = {
      ...raw.indices,
      indices: {
        ...raw.indices.indices,
        [ruleId]: {
          ...node,
          weights: { ...node.weights, ...parseWeights(options.weights) },
        },
      },
    }
  }

  const config = createConfig(raw, { now: Date.now() })
  if (config.errors.length > 0) {
    // 不中断：回测要能看到"配置异常时的降级结论"，但必须让人知道配置有问题
    for (const error of config.errors) process.stderr.write(`[配置异常] ${error}\n`)
  }
  configure(config)

  let parsed
  try {
    const text = inputPath === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(inputPath), 'utf8')
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    die(`读取入参失败（${inputPath}）：${error.message}`, 2)
  }

  const batch = Array.isArray(parsed)
  const results = batch ? parsed.map((item) => run(ruleId, item)) : run(ruleId, parsed)

  process.stdout.write(JSON.stringify(results, null, options.pretty ? 2 : 0))
  process.stdout.write('\n')
}

main()
