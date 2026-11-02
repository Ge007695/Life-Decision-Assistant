/**
 * 内核层 · 分期真实年化（P0）
 *
 * TODO(规则组)：构造现金流 P − Σ(P/n + P×feeRate)/(1+r)^t = 0，
 * 用 utils/irr.js 的三种算法求解月利率 r，再年化 (1+r)^12 − 1。
 * 必须处理边界：无符号变化（无解）、多解、n 过大浮点误差。
 * 无解时返回明确提示，不能把 NaN 抛给页面显示“年化 NaN%”。
 */

export const id = 'installment'
export const version = '0.1.0'
export const requiresIndex = false
export const configRef = 'formula:irr'

export function evaluate() {
  return {
    level: 0,
    levelLabel: '待实现',
    score: 0,
    headline: '分期真实年化规则尚未接入',
    actions: [],
    evidence: [],
    degraded: true,
  }
}
