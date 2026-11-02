/**
 * 内核层 · 出行指数 / 是否带伞（P0）
 *
 * 只回答两件事：要不要带伞、要不要推迟出门。
 * 打分沿用 indices.json#umbrella 的权重与归一化区间（降水概率 0.75、风速 0.25），
 * 风速权重不小的原因：深圳台风季风大时，伞基本没用，还会变成负担。
 *
 * “带不带伞”不从分数硬编码阈值判断，而是看等级本身：
 * 等级为最高档（便利）才不带伞，其余档一律带，这样换配置就换行为。
 */

import { weightedScore, pickLevel } from '../utils/normalize.js'

export const id = 'umbrella'
export const version = '1.0.0'

/** 按等级给具体动作，避免“建议带伞”这种无法执行的废话 */
function actionsFor(level, levels) {
  const best = levels[0]?.level ?? 4
  const worst = levels[levels.length - 1]?.level ?? 1

  if (level >= best) return ['不用带伞', '适合步行或骑行出门']
  if (level === best - 1) return ['折叠伞放包里，不占地方', '出门前再刷一眼实时雷达图']
  if (level === worst + 1) return ['务必带伞，长柄伞比折叠伞抗风', '换防水鞋或带一双替换袜']
  return ['非必要推迟出门，等降水回波过去', '必须出门就带伞并预留路上时间']
}

/**
 * @param {object} input {precipProb, windSpeed}
 * @param {object} ctx { config, index }
 */
export function evaluate(input = {}, ctx = {}) {
  const indexNode = ctx.index
  const levels = indexNode?.levels || []
  const { score, evidence, missing } = weightedScore(input, indexNode)

  // 两项都缺失时加权分为 0，直接套等级会得出“降水明显，推迟出门”——
  // 这是把“没数据”说成“下暴雨”，必须单独降级。
  const weightKeys = Object.keys(indexNode?.weights || {})
  if (weightKeys.length > 0 && missing.length === weightKeys.length) {
    return {
      level: 0,
      levelLabel: '数据不足',
      score: 0,
      headline: '缺少降水概率与风速，暂时给不出带伞建议',
      actions: ['刷新天气数据后重试'],
      evidence,
      degraded: true,
      meta: { bringUmbrella: null, delayOuting: null, missing },
    }
  }

  const levelHit = pickLevel(score, levels)
  const bestLevel = levels[0]?.level ?? 4
  const worstLevel = levels[levels.length - 1]?.level ?? 1

  const bringUmbrella = levelHit.level < bestLevel
  const delayOuting = levelHit.level <= worstLevel

  return {
    level: levelHit.level,
    levelLabel: levelHit.label,
    score,
    headline: levelHit.headline,
    actions: actionsFor(levelHit.level, levels),
    evidence,
    ...(missing.length > 0 ? { degraded: true } : {}),
    meta: {
      bringUmbrella,
      delayOuting,
      missing,
      configVersion: indexNode?.version || null,
    },
  }
}
