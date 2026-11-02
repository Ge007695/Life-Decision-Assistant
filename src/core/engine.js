/**
 * 内核层 · 规则调度与结论拼装
 *
 * 每个规则函数只做一件事：拿到入参、返回结论片段。
 * 这里负责补全 DecisionResult 的公共字段（id / version / configRef / updatedAt），
 * 并在拼装阶段替换 headline 里的占位符——规则函数不拼字符串（工作指导书 3.2）。
 *
 * 纪律：不取数、不读存储、不碰 DOM。回测脚本用同一份代码，保证
 * “线上跑的模型”与“报告里评的模型”是同一个东西。
 */

import { RULES } from './rules/index.js'

/** 规则表：id → 规则模块 */
const REGISTRY = new Map(RULES.map((rule) => [rule.id, rule]))

/** 当前生效的配置（由启动流程注入一次） */
let activeConfig = null

/** 注入配置。视图层与回测脚本都在启动时调用一次。 */
export function configure(config) {
  activeConfig = config
  return activeConfig
}

export function getConfig() {
  return activeConfig
}

/** 已注册的规则 id 列表 */
export function listRules() {
  return [...REGISTRY.keys()]
}

/** 能否解析到某条规则 */
export function hasRule(id) {
  return REGISTRY.has(id)
}

/**
 * 占位符替换：{bestWindow} → 具体时段。
 * 缺失的变量清空而不是留下花括号，避免页面上出现 “{bestWindow}” 这种半成品。
 */
export function fillPlaceholders(template, vars = {}) {
  if (typeof template !== 'string') return ''
  return template
    .replace(/\{(\w+)\}/g, (_, key) => {
      const value = vars[key]
      return value === undefined || value === null ? '' : String(value)
    })
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([，。、；])/g, '$1')
    .trim()
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

function nowIso(ctx) {
  const source = ctx?.config?.checkedAt ? null : (ctx?.now ?? null)
  const date = source ? new Date(source) : new Date()
  return date.toISOString()
}

/**
 * 数据不足时的降级结论。规则出错不能让页面白屏（工作指导书 4.5）。
 * @param {string} id
 * @param {string} message
 */
export function degradedResult(id, message) {
  return {
    id,
    version: '0.0.0',
    level: 0,
    levelLabel: '数据不足',
    score: 0,
    headline: message,
    actions: [],
    evidence: [],
    configRef: `indices.json#${id}`,
    updatedAt: new Date().toISOString(),
    degraded: true,
  }
}

/**
 * 按等级数值反查等级标签（规则只给 level 数值，文案统一从配置取）
 */
function labelForLevel(indexNode, level) {
  const levels = indexNode?.levels || []
  const hit = levels.find((item) => item.level === level)
  return hit?.label || '未知'
}

/**
 * 执行单条规则，返回标准 DecisionResult。
 *
 * @param {string} id 规则 id，与 indices.json 的键一致
 * @param {object} input 规则输入
 * @param {object} [config] 省略时用 configure() 注入的配置
 * @returns {object} DecisionResult
 */
export function run(id, input, config = activeConfig) {
  const rule = REGISTRY.get(id)
  if (!rule) return degradedResult(id, `未注册的规则：${id}`)
  if (!config) return degradedResult(id, '配置尚未加载，暂无法判定')

  // 指数类规则必须有 indices.json 节点；纯计算类规则（假期、工资、分期）声明 requiresIndex=false
  const requiresIndex = rule.requiresIndex !== false
  const indexNode = config.indices?.[id] ?? null
  if (requiresIndex && !indexNode) return degradedResult(id, `配置中找不到指数 ${id}`)

  const ctx = { config, index: indexNode, now: config?.checkedAt }

  let partial
  try {
    partial = rule.evaluate(input || {}, ctx)
  } catch (error) {
    // 规则内部异常一律降级，不让异常冒到视图层
    return degradedResult(id, `规则执行异常：${error?.message || error}`)
  }
  if (!partial || typeof partial !== 'object') {
    return degradedResult(id, `规则 ${id} 未返回结论`)
  }

  const level = clampNumber(partial.level, 0, 4, 0)
  const score = clampNumber(partial.score, 0, 100, 0)

  return {
    id,
    version: rule.version || indexNode?.version || '1.0.0',
    level,
    levelLabel: partial.levelLabel || labelForLevel(indexNode, level),
    score: Math.round(score * 10) / 10,
    headline: fillPlaceholders(partial.headline || '', partial.vars),
    actions: Array.isArray(partial.actions) ? partial.actions.filter(Boolean) : [],
    evidence: Array.isArray(partial.evidence) ? partial.evidence : [],
    configRef: rule.configRef || `indices.json#${id}`,
    updatedAt: nowIso(ctx),
    ...(partial.degraded ? { degraded: true } : {}),
    ...(partial.meta ? { meta: partial.meta } : {}),
  }
}

/**
 * 批量执行：首页一次要四类指数，逐条 catch 保证单条失败不影响整体。
 * @param {string[]} ids
 * @param {object} input
 * @param {object} [config]
 * @returns {object[]} DecisionResult 数组
 */
export function runBatch(ids, input, config = activeConfig) {
  return (ids || []).map((id) => run(id, input, config))
}

/** 跑全部已注册规则，回测脚本用 */
export function runAll(input, config = activeConfig) {
  return runBatch(listRules(), input, config)
}
