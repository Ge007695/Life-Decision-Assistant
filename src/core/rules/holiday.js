/**
 * 内核层 · 假期倒计时（P0）
 *
 * TODO(规则组)：holidayCountdown() 的返回也要符合 DecisionResult：
 *   headline = "距元旦还有 41 天"，actions = "1 月 4 日（周日）需补班"。
 * 无数据年份（status=pending）返回“2027 年安排待公布”，不抛异常。
 * 倒计时用本地日期做差，不做时区换算。
 */

export const id = 'holiday'
export const version = '0.1.0'
export const requiresIndex = false
export const configRef = 'holidays.json'

export function evaluate() {
  return {
    level: 0,
    levelLabel: '待实现',
    score: 0,
    headline: '假期倒计时规则尚未接入',
    actions: [],
    evidence: [],
    degraded: true,
  }
}
