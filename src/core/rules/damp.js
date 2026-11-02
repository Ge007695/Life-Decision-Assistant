/**
 * 内核层 · 返潮预警（P0）
 *
 * TODO(规则组)：三条同时满足才预警——见工作指导书 4.3 与 indices.json#damp.thresholds
 *   ① 露点接近室内表面温度：Td ≥ Ti − 1
 *   ② 持续高湿：相对湿度 ≥ 85% 连续 6 小时以上
 *   ③ 偏南风且风速 ≥ 2 m/s
 * 返回值须符合 DecisionResult 约定（level / levelLabel / score / headline / actions / evidence / vars）。
 */

export const id = 'damp'
export const version = '0.1.0'

export function evaluate() {
  return {
    level: 0,
    levelLabel: '待实现',
    score: 0,
    headline: '返潮预警规则尚未接入',
    actions: [],
    evidence: [],
    degraded: true,
  }
}
