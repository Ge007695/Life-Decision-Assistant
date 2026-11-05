/**
 * 内核层 · 一周衣物准备（O-8 / P2）
 *
 * 与 clothing 规则的分工：
 *   clothing 回答「今天穿什么」，本规则回答「这一周要备几套」。
 * 每天穿什么仍然由 clothing 的映射表决定——这里不重新定义温度区间，
 * 只把同一张表连查七天再按档位汇总。表改了这里跟着变，不会两边打架。
 *
 * 件数怎么来的（本规则唯一需要解释的取法）：
 *   不是「一天一套」。七天带七套是搬家，不是出门。
 *   配置给两个数：changeEveryDays（几天一换）与 maxPerBand（同类最多带几件）。
 *     件数 = min( ceil(天数 / changeEveryDays), maxPerBand )
 *   7 天按两天一换是 4 套，但封顶 3 套——一周内总要洗一次。
 *   这两个数是生活经验，因此放配置不放代码，按自己习惯改一行就能调。
 *
 * 为什么不用体感温度：
 *   日级预报只有最高/最低气温，没有逐时湿度与风速，Steadman 体感算不出来。
 *   硬按日均温套体感公式等于编数据。所以这里用日均气温查表，
 *   并在页面上明写口径，不假装这是体感结论。
 */

import { lookupOutfit } from './clothing.js'
import { pickLevel, round } from '../utils/normalize.js'

export const id = 'weeklyWear'
export const version = '1.0.0'

/** 日级数据只有最高/最低气温，取中值代表白天体感 */
function meanTempOf(day) {
  const max = day?.tempMax
  const min = day?.tempMin
  const hasMax = typeof max === 'number' && Number.isFinite(max)
  const hasMin = typeof min === 'number' && Number.isFinite(min)
  if (!hasMax || !hasMin) return null
  return (max + min) / 2
}

/** 某档位需要备几套：天数 / 换洗间隔，向上取整，再按上限封顶 */
export function piecesFor(days, changeEvery, maxPerBand) {
  const span = Number(changeEvery) > 0 ? Number(changeEvery) : 2
  const cap = Number(maxPerBand) > 0 ? Number(maxPerBand) : 3
  if (!Number.isFinite(days) || days <= 0) return 0
  return Math.min(Math.ceil(days / span), cap)
}

/**
 * @param {object} input {days: [{date, tempMax, tempMin}]}
 * @param {object} ctx {config, index}
 */
export function evaluate(input = {}, ctx = {}) {
  const node = ctx.index
  const table = ctx?.config?.clothingTable || []
  const days = Array.isArray(input.days) ? input.days : []
  const changeEvery = Number(node?.changeEveryDays) || 2
  const maxPerBand = Number(node?.maxPerBand) || 3

  /** 档位标签 → 汇总，保持 Map 是为了按首次出现顺序聚合，最后再按天数排序 */
  const byBand = new Map()
  const missing = []

  for (const day of days) {
    const temp = meanTempOf(day)
    const row = temp === null ? null : lookupOutfit(table, temp)
    if (!row) {
      missing.push(day?.date || '')
      continue
    }
    const key = row.label
    if (!byBand.has(key)) {
      byBand.set(key, {
        label: row.label,
        outfit: row.outfit,
        level: row.level,
        min: row.min,
        max: row.max,
        days: 0,
        dates: [],
      })
    }
    const band = byBand.get(key)
    band.days += 1
    band.dates.push(day?.date || '')
  }

  const bands = [...byBand.values()]
    .map((band) => ({ ...band, pieces: piecesFor(band.days, changeEvery, maxPerBand) }))
    .sort((a, b) => b.days - a.days)

  const covered = days.length - missing.length
  // 分数表示「这一周的结论有多可靠」：预报覆盖了几分之几，不是好坏评分
  const score = days.length === 0 ? 0 : round((covered / days.length) * 100, 1)
  const levelInfo = pickLevel(score, node?.levels || [])

  // 没有任何一天有数据：按数据不足返回，不输出空清单让用户以为「不用带衣服」
  if (bands.length === 0) {
    return {
      level: 0,
      levelLabel: '数据不足',
      score: 0,
      headline: '未来一周的气温数据没取到，暂时算不出衣物件数',
      actions: [],
      evidence: [
        {
          key: 'coverage',
          label: '预报覆盖',
          value: days.length === 0 ? '没有日级预报数据' : `0 / ${days.length} 天`,
          weight: null,
          contribution: null,
          ratio: null,
        },
      ],
      degraded: true,
      meta: { bands: [], covered: 0, total: days.length, changeEvery, maxPerBand, basis: '日均气温查表' },
    }
  }

  const totalPieces = bands.reduce((sum, band) => sum + band.pieces, 0)
  const headline = `${covered} 天里要备 ${bands.length} 类穿搭，共 ${totalPieces} 套`

  const actions = bands.map((band) => `${band.outfit}：${band.pieces} 套（${band.days} 天）`)

  const evidence = [
    {
      key: 'coverage',
      label: '预报覆盖',
      value: covered === days.length ? `全部 ${days.length} 天` : `${covered} / ${days.length} 天`,
      weight: null,
      contribution: null,
      ratio: null,
    },
    ...bands.map((band) => ({
      key: `band-${band.label}`,
      label: band.label,
      value: `${band.days} 天 → ${band.pieces} 套`,
      weight: null,
      contribution: null,
      ratio: null,
    })),
  ]

  if (missing.length > 0) {
    evidence.push({
      key: 'missing',
      label: '缺数据的日子',
      value: missing.join('、'),
      weight: null,
      contribution: null,
      ratio: null,
      missing: true,
    })
  }

  return {
    level: levelInfo.level,
    levelLabel: levelInfo.label,
    score,
    headline,
    actions,
    evidence,
    degraded: covered === 0,
    meta: {
      bands,
      covered,
      total: days.length,
      totalPieces,
      changeEvery,
      maxPerBand,
      missing,
      // 页面必须把这个口径显示出来，否则用户会以为是按体感算的
      basis: '日均气温查表',
    },
  }
}

export default { id, version, evaluate, piecesFor }
