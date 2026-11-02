/**
 * 内核层 · 穿衣建议（P1）
 *
 * 三段流水线，每段只做一件事：
 *   气温 + 湿度 + 风速（+ 用户体感校准）→ 体感温度 → 查 clothing-table.json → 搭配
 *
 * 为什么不写 if (t < 10) ... else if (t < 18) ...：
 * 温度区间属于“生活经验”，会随城市、季节、人群调整，写进代码就只能改代码；
 * 放进配置表以后，产品改文案不用动内核，测试也能直接对着表验证“区间边界取哪一档”。
 *
 * 体感校准（feedbackOffset）由页面根据用户点“偏冷/偏热”累计后传入，
 * 内核只负责加上去——规则不应该知道用户点过几次按钮。
 */

import { apparentTemperature } from '../utils/apparent-temp.js'
import { toFinite } from '../utils/dewpoint.js'
import { round } from '../utils/normalize.js'

export const id = 'clothing'
export const version = '1.0.0'

/** 契约约定的等级上限：level 0—4，用于把离散等级折算成 0—100 的分数 */
const MAX_LEVEL = 4

/** 表格缺档时的兜底分数：中间档 */
const FALLBACK_SCORE = 50

/**
 * 区间查找：min 含、max 不含（与 clothing-table.json 的 meta 说明一致）。
 * 体感温度落在表外（极端高温/严寒）时，夹到最近的一档，而不是返回空——
 * 用户要的是“穿什么”，不是“数据超范围”。
 *
 * @param {Array} table clothing-table.json 的 table
 * @param {number} value 体感温度
 * @returns {object|null}
 */
export function lookupOutfit(table, value) {
  if (!Array.isArray(table) || table.length === 0) return null
  if (!Number.isFinite(value)) return null

  for (const row of table) {
    if (value >= row.min && value < row.max) return row
  }

  const sorted = [...table].sort((a, b) => a.min - b.min)
  if (value < sorted[0].min) return sorted[0]
  return sorted[sorted.length - 1]
}

/**
 * @param {object} input {temp, humidity, windSpeed, feedbackOffset?, feedback?}
 * @param {object} ctx { config, index }
 */
export function evaluate(input = {}, ctx = {}) {
  const indexNode = ctx.index
  const table = ctx?.config?.clothingTable || []

  const temp = toFinite(input.temp)
  const humidity = toFinite(input.humidity)
  const windSpeed = toFinite(input.windSpeed)
  // 页面没给 offset 时按 0 处理；不在这里根据 feedback 猜偏移量
  const offset = toFinite(input.feedbackOffset) ?? 0

  const felt = apparentTemperature(temp, humidity, windSpeed, offset)
  const row = lookupOutfit(table, felt)

  // 气温或湿度缺失 → 体感算不出来，用配置里的兜底文案，不假装有结论
  if (felt === null || !row) {
    return {
      level: indexNode?.fallbackLevel ?? 0,
      levelLabel: '数据不足',
      score: FALLBACK_SCORE,
      headline: indexNode?.fallbackHeadline || '体感数据缺失，按当前气温参考昨日搭配',
      actions: ['补上气温与湿度后再看建议'],
      evidence: [
        { key: 'temp', label: '气温', value: temp === null ? '缺失' : `${round(temp, 1)} ℃`, weight: null, contribution: null, ratio: null },
        { key: 'humidity', label: '相对湿度', value: humidity === null ? '缺失' : `${round(humidity, 0)}%`, weight: null, contribution: null, ratio: null },
      ],
      degraded: true,
      meta: { felt: null, offset, tableVersion: ctx?.config?.versions?.clothingTable || null },
    }
  }

  const feltText = `${round(felt, 1).toFixed(1)} ℃`
  // headline 必须带体感温度：用户看到“体感 19.2 ℃”才知道为什么建议穿外套
  const headline = `体感 ${round(felt, 1).toFixed(1)} ℃，${row.label}：${row.outfit}`

  const evidence = [
    {
      key: 'felt',
      label: '体感温度',
      value: feltText,
      weight: null,
      contribution: null,
      ratio: null,
    },
    {
      key: 'temp',
      label: '气温',
      value: temp === null ? '缺失' : `${round(temp, 1)} ℃`,
      weight: null,
      contribution: null,
      ratio: null,
    },
    {
      key: 'humidity',
      label: '相对湿度',
      value: humidity === null ? '缺失' : `${round(humidity, 0)}%`,
      weight: null,
      contribution: null,
      ratio: null,
    },
    {
      key: 'windSpeed',
      label: '风速',
      value: windSpeed === null ? '缺失（按无风处理）' : `${round(windSpeed, 1)} m/s`,
      weight: null,
      contribution: null,
      ratio: null,
    },
    {
      key: 'band',
      label: '命中区间',
      value: `${row.min}—${row.max} ℃ → ${row.label}`,
      weight: null,
      contribution: null,
      ratio: null,
    },
  ]

  if (offset !== 0) {
    evidence.push({
      key: 'feedbackOffset',
      label: '体感校准',
      value: `${offset > 0 ? '+' : ''}${round(offset, 1)} ℃${input.feedback === 'cold' ? '（你反馈过偏冷）' : ''}${input.feedback === 'hot' ? '（你反馈过偏热）' : ''}`,
      weight: null,
      contribution: null,
      ratio: null,
    })
  }

  const actions = [row.outfit, ...(Array.isArray(row.extras) ? row.extras : [])].filter(Boolean)

  return {
    level: row.level,
    levelLabel: row.label,
    // 表格型规则没有连续维度，把等级按 25 分/级折算，保证与其它指数同尺度可比
    score: round((row.level / MAX_LEVEL) * 100, 1),
    headline,
    actions,
    evidence,
    meta: {
      felt: round(felt, 1),
      offset,
      band: { min: row.min, max: row.max, label: row.label },
      tableVersion: ctx?.config?.versions?.clothingTable || null,
    },
  }
}
