/**
 * 内核层 · 出行指数 / 是否带伞（P0）
 *
 * TODO(规则组)：按 indices.json#umbrella 的权重与归一化区间加权打分，
 * 输出“是否带伞、是否推迟出门”，逐项依据进 evidence。
 */

export const id = 'umbrella'
export const version = '0.1.0'

export function evaluate() {
  return {
    level: 0,
    levelLabel: '待实现',
    score: 0,
    headline: '出行指数规则尚未接入',
    actions: [],
    evidence: [],
    degraded: true,
  }
}
