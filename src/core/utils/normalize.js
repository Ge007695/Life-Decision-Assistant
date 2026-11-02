/**
 * 内核层 · 归一化与加权打分工具
 *
 * 关键设计（工作指导书 3.2）：normalize 区间写成 [劣端, 优端]，不是 [min, max]。
 * 这样“湿度越低越好”“风速越大越好”这类方向相反的指标共用同一个函数，
 * 引擎不必为每个指标写分支。
 *
 *   score = clamp((value − poor) / (good − poor), 0, 1)
 */

/** 把数值限制在 [min, max] */
export function clamp(value, min, max) {
  if (Number.isNaN(value) || value === null || value === undefined) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * 单指标归一化到 0—1
 * @param {number} value 实测值
 * @param {[number, number]} range [劣端, 优端]
 * @returns {number} 0 表示劣端，1 表示优端
 */
export function normalize(value, range) {
  if (!Array.isArray(range) || range.length !== 2) return 0.5
  const [poor, good] = range
  if (good === poor) return 0.5 // 配置校验会拦下，这里只做防御
  const raw = (value - poor) / (good - poor)
  if (Number.isNaN(raw)) return 0.5
  return clamp(raw, 0, 1)
}

export function isNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 按 indices.json 的一个节点做加权打分。
 *
 * 缺失值处理：某项输入缺失时剔除该项，并用剩余权重重新归一，
 * 同时在 evidence 里标注“缺失”，让页面能说明结论是降级得出的，
 * 而不是当成 0 分拉低整体结论。
 *
 * @param {object} input 指标输入，如 {temp: 24, humidity: 68, ...}
 * @param {object} indexNode indices.json 里的一个指数节点
 * @returns {{score: number, evidence: Array, missing: string[]}}
 */
export function weightedScore(input, indexNode) {
  const weights = indexNode?.weights || {}
  const normalizeMap = indexNode?.normalize || {}
  const labelMap = indexNode?.evidenceLabel || {}
  const formatMap = indexNode?.format || {}

  const keys = Object.keys(weights)
  const present = keys.filter((key) => isNumeric(input?.[key]))
  const missing = keys.filter((key) => !isNumeric(input?.[key]))

  const weightTotal = present.reduce((acc, key) => acc + weights[key], 0)

  const evidence = []
  let score = 0

  if (weightTotal > 0) {
    for (const key of present) {
      const ratio = normalize(input[key], normalizeMap[key])
      const effectiveWeight = weights[key] / weightTotal
      const contribution = ratio * effectiveWeight
      score += contribution
      evidence.push({
        key,
        label: labelMap[key] || key,
        value: formatValue(input[key], formatMap[key]),
        weight: round(effectiveWeight, 3),
        contribution: round(contribution, 3),
        ratio: round(ratio, 3),
      })
    }
  }

  // 缺失项也进 evidence，但要标清楚，避免把“没数据”读成“数据差”
  for (const key of missing) {
    evidence.push({
      key,
      label: labelMap[key] || key,
      value: '缺失',
      weight: round(weights[key], 3),
      contribution: 0,
      ratio: null,
      missing: true,
    })
  }

  // 按贡献从大到小排，页面“依据”展开时最重要的排在最上面
  evidence.sort((a, b) => b.contribution - a.contribution)

  return {
    score: round(score * 100, 1),
    evidence,
    missing,
  }
}

/**
 * 按等级档位取最终等级。levels 在配置里已按 min 降序排列。
 * @param {number} score 0—100
 * @param {Array} levels indices.json 的 levels
 * @returns {{level: number, label: string, headline: string, min: number}}
 */
export function pickLevel(score, levels) {
  if (!Array.isArray(levels) || levels.length === 0) {
    return { level: 0, label: '未知', headline: '', min: 0 }
  }
  const safe = clamp(score, 0, 100)
  for (const item of levels) {
    if (safe >= item.min) return item
  }
  return levels[levels.length - 1]
}

/**
 * 文案模板取数：把 {v} 换成数值，保留一位小数以内的原样输出。
 * @param {number} value
 * @param {string} [template] 如 '{v}%'
 */
export function formatValue(value, template) {
  if (!isNumeric(value)) return '缺失'
  const text = Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)
  return template ? template.replace('{v}', text) : text
}

/**
 * 数组求平均，忽略非数值项
 * @param {number[]} values
 */
export function mean(values) {
  const nums = (values || []).filter(isNumeric)
  if (nums.length === 0) return null
  return nums.reduce((acc, value) => acc + value, 0) / nums.length
}

export function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
