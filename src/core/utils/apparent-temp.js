/**
 * 内核层 · 体感温度（Steadman 简化式）
 *
 * 为什么不用气温直接查穿衣表：同样 20 ℃，深圳 3 级南风加 90% 湿度会觉得闷，
 * 而干燥有风的山里会觉得凉。体感温度把“湿度让人更热、风让人更冷”这两件事
 * 折进一个数，穿衣建议才有统一口径可查。
 *
 * 公式：
 *   e  = RH/100 × 6.105 × exp(a·T / (b + T))      水汽压（hPa）
 *   AT = T + 0.33·e − 0.70·ws − 4.00              ws 为风速（m/s）
 *
 * 系数 6.105 / 0.33 / 0.70 / 4.00 / a=17.27 / b=237.7 均为 Steadman (1979)
 * 原始拟合常数，属于公式本身，不做配置化（改了就换了一套模型）。
 */

import { toFinite, MAGNUS_A, MAGNUS_B } from './dewpoint.js'

/** 海平面标准水汽压系数（hPa），Steadman 拟合常数 */
export const VAPOR_PRESSURE_BASE = 6.105

/** 湿度对体感的加热系数 */
export const HUMIDITY_HEAT_FACTOR = 0.33

/** 风速对体感的降温系数（m/s → ℃） */
export const WIND_COOL_FACTOR = 0.7

/** 公式固有偏移（℃），Steadman 拟合时的截距项 */
export const STEADMAN_OFFSET = 4.0

/**
 * 水汽压 e（hPa）
 * @param {number} tempC
 * @param {number} humidity 相对湿度百分数（0—100）
 * @returns {number|null}
 */
export function vaporPressure(tempC, humidity) {
  const temp = toFinite(tempC)
  const rh = toFinite(humidity)
  if (temp === null || rh === null || rh <= 0) return null
  const exponent = (MAGNUS_A * temp) / (MAGNUS_B + temp)
  return (rh / 100) * VAPOR_PRESSURE_BASE * Math.exp(exponent)
}

/**
 * 体感温度
 *
 * @param {number} tempC 气温（℃）
 * @param {number} humidity 相对湿度（0—100）
 * @param {number} windSpeedMs 风速（m/s），缺失按无风 0 处理——无风是合法物理状态
 * @param {number} [offset=0] 体感校准偏移（℃）：用户反馈“偏冷/偏热”后由页面给出，
 *                            规则只负责加上去，不在内核里猜该加多少
 * @returns {number|null} 体感温度（℃）；气温或湿度非法时返回 null
 */
export function apparentTemperature(tempC, humidity, windSpeedMs, offset = 0) {
  const temp = toFinite(tempC)
  const rh = toFinite(humidity)
  if (temp === null || rh === null) return null

  const wind = toFinite(windSpeedMs) ?? 0
  const adjust = toFinite(offset) ?? 0
  const vapor = vaporPressure(temp, rh)
  if (vapor === null) return null

  return (
    temp +
    HUMIDITY_HEAT_FACTOR * vapor -
    WIND_COOL_FACTOR * wind -
    STEADMAN_OFFSET +
    adjust
  )
}

export default apparentTemperature
