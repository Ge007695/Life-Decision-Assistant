/**
 * 内核层 · 露点温度（Magnus 公式）
 *
 * 为什么用露点而不是相对湿度：相对湿度只说“空气离饱和还有多远”，
 * 但真正决定墙面会不会结露的，是“空气要降到多少度才饱和”，也就是露点。
 * 深圳回南天里相对湿度可能只有 88%，只要露点已经贴近地砖温度，地面照样出水；
 * 反过来北方干燥天气湿度 40% 也不会返潮。所以返潮判定必须落到露点上。
 *
 * 公式（Magnus 近似，水的经验系数）：
 *   α  = ln(RH / 100) + a·T / (b + T)
 *   Td = b·α / (a − α)
 *
 * a、b 允许通过第三个参数覆盖（冰面结霜场景系数略有不同），默认取常量，
 * 避免同一个魔法数字散落在多个文件里（apparent-temp.js 复用同一组系数）。
 */

/** Magnus 系数 a：17.27（水，-45 ℃—60 ℃ 常用取值） */
export const MAGNUS_A = 17.27

/** Magnus 系数 b：237.7 ℃（与 a 配套使用） */
export const MAGNUS_B = 237.7

/**
 * 转有限数字：字符串 "60" 视为 60，null / undefined / "" / NaN / Infinity 视为缺失。
 * 不用 Number() 直接兜底是因为 Number(null) === 0、Number('') === 0，
 * 会把“没填”悄悄当成 0，得出一个看似合法的错误露点。
 */
export function toFinite(value) {
  if (value === null || value === undefined || value === '') return null
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * 计算露点温度
 *
 * @param {number} tempC 气温（℃）
 * @param {number} humidity 相对湿度（0—100，百分数口径）
 * @param {{a?: number, b?: number}} [options] 可覆盖 Magnus 系数
 * @returns {number|null} 露点（℃）；入参非法或湿度 ≤ 0 时返回 null
 */
export function dewPoint(tempC, humidity, options = {}) {
  const temp = toFinite(tempC)
  const rh = toFinite(humidity)
  if (temp === null || rh === null) return null
  // ln(0) 是负无穷，湿度为 0 时露点没有物理意义，直接判缺失
  if (rh <= 0) return null

  const a = toFinite(options.a) ?? MAGNUS_A
  const b = toFinite(options.b) ?? MAGNUS_B

  const alpha = Math.log(rh / 100) + (a * temp) / (b + temp)
  const denominator = a - alpha
  // α 恰好等于 a 时分母为零（极端温湿度组合才会出现），视为无解
  if (!Number.isFinite(alpha) || denominator === 0) return null

  const result = (b * alpha) / denominator
  return Number.isFinite(result) ? result : null
}

export default dewPoint
