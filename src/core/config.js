/**
 * 内核层 · 配置加载与 Schema 校验
 *
 * 纪律：本文件是纯函数，不读网络、不碰 DOM、不读 localStorage。
 * 浏览器里由 services/config.js 负责 fetch，Node 里由脚本负责 fs 读取，
 * 两边拿到原始对象后走同一个 createConfig()，保证校验口径一致。
 *
 * 校验失败不静默降级（工作指导书 11.2）：errors 非空时页面顶部直接提示“配置异常”。
 */

/** 权重之和允许的误差（工作指导书 11.2） */
export const WEIGHT_SUM_TOLERANCE = 0.01

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function round(value, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * 校验 indices.json
 * @param {object} raw
 * @returns {string[]} 错误列表，空数组代表通过
 */
export function validateIndices(raw) {
  const errors = []
  if (!isPlainObject(raw)) return ['indices.json 无法解析或不是对象']

  if (!isPlainObject(raw.meta) || !raw.meta.version) {
    errors.push('indices.json: 缺少 meta.version')
  }
  if (!isPlainObject(raw.indices)) {
    errors.push('indices.json: 缺少 indices 节点')
    return errors
  }

  for (const [id, node] of Object.entries(raw.indices)) {
    const path = `indices.${id}`
    if (!isPlainObject(node)) {
      errors.push(`${path}: 不是对象`)
      continue
    }
    if (!node.label) errors.push(`${path}: 缺少 label`)
    if (!node.type) errors.push(`${path}: 缺少 type`)

    // levels：必须存在、按 min 降序、必须含 min=0 的兜底档
    // table 类型的等级来自映射表本身，不需要这里再写一份
    const levels = node.levels
    if (node.type === 'table') {
      // 跳过等级校验
    } else if (!Array.isArray(levels) || levels.length === 0) {
      errors.push(`${path}.levels: 缺少等级档位`)
    } else {
      const mins = levels.map((level) => level.min)
      if (mins.some((min) => typeof min !== 'number' || Number.isNaN(min))) {
        errors.push(`${path}.levels: 每条等级档必须带数字 min`)
      }
      if (!mins.includes(0)) {
        errors.push(`${path}.levels: 必须包含 min=0 的兜底档，否则低分会取不到等级`)
      }
      if (mins.some((min, i) => i > 0 && min >= mins[i - 1])) {
        errors.push(`${path}.levels: 必须按 min 严格降序排列`)
      }
      for (const [i, level] of levels.entries()) {
        if (typeof level.level !== 'number' || level.level < 0 || level.level > 4) {
          errors.push(`${path}.levels[${i}].level: 必须是 0—4 的整数`)
        }
        if (!level.headline) errors.push(`${path}.levels[${i}]: 缺少 headline 文案`)
      }
    }

    if (node.type === 'weighted') {
      const weights = node.weights
      if (!isPlainObject(weights) || Object.keys(weights).length === 0) {
        errors.push(`${path}.weights: 缺少权重定义`)
        continue
      }
      const keys = Object.keys(weights)
      const sum = keys.reduce((acc, key) => acc + (Number(weights[key]) || 0), 0)
      if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
        errors.push(`${path}.weights: 权重之和为 ${round(sum)}，应为 1（允许 ±${WEIGHT_SUM_TOLERANCE}）`)
      }
      for (const key of keys) {
        if (!(Number(weights[key]) > 0)) {
          errors.push(`${path}.weights.${key}: 权重必须为正数`)
        }
        const range = node.normalize?.[key]
        if (!Array.isArray(range) || range.length !== 2) {
          errors.push(`${path}.normalize.${key}: 缺少 [劣端, 优端] 区间`)
          continue
        }
        const [poor, good] = range
        if (typeof poor !== 'number' || typeof good !== 'number') {
          errors.push(`${path}.normalize.${key}: 区间两端必须是数字`)
        } else if (poor === good) {
          errors.push(`${path}.normalize.${key}: 区间两端不能相等，否则归一化除零`)
        }
      }
      if (Array.isArray(node.inputs)) {
        const missing = keys.filter((key) => !node.inputs.includes(key))
        if (missing.length > 0) {
          errors.push(`${path}.inputs: 未声明权重项 ${missing.join(', ')}`)
        }
      }
    } else if (node.type === 'rule') {
      if (!isPlainObject(node.thresholds)) {
        errors.push(`${path}.thresholds: rule 类型必须有阈值配置`)
      }
    } else if (node.type === 'table') {
      if (!node.tableRef) errors.push(`${path}.tableRef: table 类型必须指向一张映射表`)
    } else {
      errors.push(`${path}.type: 未知类型 ${node.type}（只支持 weighted / rule / table）`)
    }
  }

  return errors
}

/**
 * 校验 holidays.json
 * @param {object} raw
 * @returns {string[]}
 */
export function validateHolidays(raw) {
  const errors = []
  if (!isPlainObject(raw)) return ['holidays.json 无法解析或不是对象']
  if (!isPlainObject(raw.years)) {
    errors.push('holidays.json: 缺少 years 节点')
    return errors
  }

  for (const [year, node] of Object.entries(raw.years)) {
    const path = `years.${year}`
    if (!/^\d{4}$/.test(year)) errors.push(`${path}: 键名必须是四位年份`)
    if (!['official', 'pending', 'partial'].includes(node.status)) {
      errors.push(`${path}.status: 只能是 official / pending / partial`)
    }
    // pending 年份允许为空，这是“待公布”的正常状态，不算错误
    if (node.status !== 'pending' && (!Array.isArray(node.holidays) || node.holidays.length === 0)) {
      errors.push(`${path}.holidays: 非 pending 年份必须有假期数据`)
    }
    for (const [i, holiday] of (node.holidays || []).entries()) {
      const hp = `${path}.holidays[${i}]`
      if (!holiday.name) errors.push(`${hp}: 缺少 name`)
      if (!DATE_RE.test(holiday.start || '')) errors.push(`${hp}.start: 必须是 YYYY-MM-DD`)
      if (!DATE_RE.test(holiday.end || '')) errors.push(`${hp}.end: 必须是 YYYY-MM-DD`)
      if (holiday.start && holiday.end && holiday.start > holiday.end) {
        errors.push(`${hp}: start 晚于 end`)
      }
    }
    for (const day of node.makeupWorkdays || []) {
      if (!DATE_RE.test(day)) errors.push(`${path}.makeupWorkdays: ${day} 不是 YYYY-MM-DD`)
    }
    for (const [i, term] of (node.schoolTerms || []).entries()) {
      const tp = `${path}.schoolTerms[${i}]`
      if (!term.name) errors.push(`${tp}: 缺少 name`)
      if (!DATE_RE.test(term.start || '') || !DATE_RE.test(term.end || '')) {
        errors.push(`${tp}: start / end 必须是 YYYY-MM-DD`)
      }
    }
  }

  return errors
}

/**
 * 校验 tax-rules.json
 * @param {object} raw
 * @returns {string[]}
 */
export function validateTaxRules(raw) {
  const errors = []
  if (!isPlainObject(raw)) return ['tax-rules.json 无法解析或不是对象']

  const sections = ['serviceIncome', 'salaryIncome', 'annualSettlement']
  for (const name of sections) {
    const node = raw[name]
    if (!isPlainObject(node)) {
      errors.push(`${name}: 缺少配置段`)
      continue
    }
    const brackets = node.brackets
    if (!Array.isArray(brackets) || brackets.length === 0) {
      errors.push(`${name}.brackets: 缺少税率档位`)
      continue
    }
    let lastUpper = 0
    for (const [i, bracket] of brackets.entries()) {
      const bp = `${name}.brackets[${i}]`
      if (typeof bracket.rate !== 'number') errors.push(`${bp}.rate: 必须是数字`)
      if (typeof bracket.quickDeduction !== 'number') errors.push(`${bp}.quickDeduction: 必须是数字`)
      const isLast = i === brackets.length - 1
      if (isLast) {
        if (bracket.upper !== null) errors.push(`${bp}.upper: 最后一档必须是 null（表示无上限）`)
      } else if (typeof bracket.upper !== 'number' || bracket.upper <= lastUpper) {
        errors.push(`${bp}.upper: 必须严格递增`)
      } else {
        lastUpper = bracket.upper
      }
    }
  }

  if (typeof raw.serviceIncome?.threshold !== 'number') {
    errors.push('serviceIncome.threshold: 必须是数字')
  }
  if (typeof raw.salaryIncome?.basicDeductionMonthly !== 'number') {
    errors.push('salaryIncome.basicDeductionMonthly: 必须是数字')
  }
  if (typeof raw.annualSettlement?.basicDeductionYearly !== 'number') {
    errors.push('annualSettlement.basicDeductionYearly: 必须是数字')
  }

  return errors
}

/**
 * 校验 clothing-table.json
 * @param {object} raw
 * @returns {string[]}
 */
export function validateClothingTable(raw) {
  const errors = []
  if (!isPlainObject(raw)) return ['clothing-table.json 无法解析或不是对象']
  const table = raw.table
  if (!Array.isArray(table) || table.length === 0) {
    return ['clothing-table.json: 缺少 table 数组']
  }
  for (const [i, row] of table.entries()) {
    const path = `table[${i}]`
    if (typeof row.min !== 'number' || typeof row.max !== 'number') {
      errors.push(`${path}: min / max 必须是数字`)
    } else if (row.min >= row.max) {
      errors.push(`${path}: min 必须小于 max`)
    }
    if (!row.outfit) errors.push(`${path}: 缺少 outfit`)
  }
  return errors
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

/**
 * 组装不可变的配置对象。所有规则函数只读这一个对象。
 *
 * @param {object} raw 六份原始 JSON
 * @param {object} [options]
 * @param {object} [options.now] 注入时钟，便于回测与测试
 * @returns {{indices: object, holidays: object, taxRules: object, clothingTable: object[], cities: object, checklists: object[], versions: object, errors: string[], checkedAt: string}}
 */
export function createConfig(raw = {}, options = {}) {
  const errors = [
    ...validateIndices(raw.indices),
    ...validateHolidays(raw.holidays),
    ...validateTaxRules(raw.taxRules),
    ...validateClothingTable(raw.clothingTable),
  ]

  const config = {
    indices: raw.indices?.indices || {},
    indicesMeta: raw.indices?.meta || {},
    holidays: raw.holidays || { years: {} },
    taxRules: raw.taxRules || {},
    clothingTable: raw.clothingTable?.table || [],
    cities: raw.cities?.cities || [],
    checklists: raw.checklists?.checklists || [],
    checklistsMeta: raw.checklists?.meta || {},
    versions: {
      indices: raw.indices?.meta?.version || 'unknown',
      holidays: raw.holidays?.meta?.version || 'unknown',
      taxRules: raw.taxRules?.meta?.version || 'unknown',
      clothingTable: raw.clothingTable?.meta?.version || 'unknown',
    },
    errors,
    checkedAt: (options.now ? new Date(options.now) : new Date()).toISOString(),
  }

  return deepFreeze(config)
}

/** 便捷断言：配置是否可用 */
export function isConfigHealthy(config) {
  return Array.isArray(config?.errors) && config.errors.length === 0
}
