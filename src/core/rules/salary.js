/**
 * 内核层 · 实习到手工资测算（P0）
 *
 * TODO(规则组)：计算顺序 收入 → 扣除额 → 应纳税所得额 → 查预扣率表 → 预扣税额 → 到手金额。
 * 所有参数从 tax-rules.json 读取，代码里只保留公式。
 * 支持两种口径：劳务报酬（serviceIncome）与工资薪金（salaryIncome 累计预扣）。
 * 年度汇算部分必须标注“本结果为估算，实际以税务部门年度汇算为准”。
 */

export const id = 'salary'
export const version = '0.1.0'
export const requiresIndex = false
export const configRef = 'tax-rules.json'

export function evaluate() {
  return {
    level: 0,
    levelLabel: '待实现',
    score: 0,
    headline: '工资测算规则尚未接入',
    actions: [],
    evidence: [],
    degraded: true,
  }
}
