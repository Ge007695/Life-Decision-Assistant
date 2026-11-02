/**
 * 内核层 · 穿衣建议（P1）
 *
 * TODO(规则组)：体感温度（Steadman 简化式，utils/apparent-temp.js）→ 查
 * clothing-table.json 得到搭配组合。不要用 if-else 把区间写死在代码里。
 * 支持 input.feedbackOffset（体感校准偏移）与 input.feedback。
 */

export const id = 'clothing'
export const version = '0.1.0'

export function evaluate() {
  return {
    level: 0,
    levelLabel: '待实现',
    score: 0,
    headline: '穿衣建议规则尚未接入',
    actions: [],
    evidence: [],
    degraded: true,
  }
}
