/**
 * 服务层 · 历史同期数据（O-11 用）
 *
 * 数据源是 Open-Meteo 的 archive 接口（ERA5 再分析），与预报接口不同：
 *   - 只能查已经过去的完整日期，不能查今天；
 *   - 数据不再变化，所以缓存可以给到 7 天，不必像预报那样 24 小时过期。
 *
 * 「去年同期」的口径写死在这里，页面不自己算：
 *   取去年同月同日往后连续 N 天，与今年预报的前 N 天逐日对齐。
 *   2 月 29 日减一年会落到 3 月 1 日（JS Date 的行为），这里如实标注，
 *   不为了让日期「好看」而改成 2 月 28 日——那会悄悄换成另一天的天气。
 */

import { get as readStore, set as writeStore, KEYS } from './storage.js'

const ENDPOINT = 'https://archive-api.open-meteo.com/v1/archive'
/** 历史数据是定值，缓存久一点没关系；7 天足够，也让用户换城市时能及时更新 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 12000

const DAILY_FIELDS = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum']

function pad(value) {
  return String(value).padStart(2, '0')
}

function toText(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 'YYYY-MM-DD' 减 n 年。
 * 2 月 29 日减一年会得到 3 月 1 日，这是 Date 的默认行为，调用方要在文案里说明。
 */
export function shiftYear(dateText, years = -1) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ''))
  if (!match) return ''
  const date = new Date(Number(match[1]) + years, Number(match[2]) - 1, Number(match[3]), 12)
  return toText(date)
}

/** 'YYYY-MM-DD' 加 n 天 */
export function shiftDays(dateText, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ''))
  if (!match) return ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12)
  return toText(date)
}

export function buildUrl(city, startDate, endDate) {
  const params = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    start_date: startDate,
    end_date: endDate,
    daily: DAILY_FIELDS.join(','),
    timezone: city.timezone || 'Asia/Shanghai',
  })
  return `${ENDPOINT}?${params.toString()}`
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function adaptResponse(payload) {
  const daily = payload?.daily
  if (!daily || !Array.isArray(daily.time)) throw new Error('历史接口返回缺少日级数据')
  return daily.time.map((date, i) => ({
    date,
    tempMax: num(daily.temperature_2m_max?.[i]),
    tempMin: num(daily.temperature_2m_min?.[i]),
    precip: num(daily.precipitation_sum?.[i]),
  }))
}

async function request(city, startDate, endDate) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(buildUrl(city, startDate, endDate), { signal: controller.signal })
    if (!response.ok) throw new Error(`历史接口 HTTP ${response.status}`)
    return adaptResponse(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

function cacheKeyFor(cityId, startDate) {
  return `${KEYS.WEATHER}:climate:${cityId}:${startDate}`
}

/**
 * 取「去年同月同日」起连续 days 天的日级数据。
 *
 * @param {object} city
 * @param {string} startDate 今年的起始日 YYYY-MM-DD
 * @param {number} [days]
 * @returns {Promise<{ok: boolean, stale: boolean, start: string, end: string, sourceStart: string, data: Array, error: string|null}>}
 */
export async function getSamePeriod(city, startDate, days = 7) {
  const span = Math.max(1, Math.min(days, 14))
  const sourceStart = shiftYear(startDate, -1)
  const sourceEnd = shiftDays(sourceStart, span - 1)

  if (!sourceStart || !Number.isFinite(city?.lat) || !Number.isFinite(city?.lon)) {
    return { ok: false, stale: false, start: startDate, end: '', sourceStart, data: [], error: '城市坐标或日期无效' }
  }

  const cacheKey = cacheKeyFor(city.id, sourceStart)
  const cached = readStore(cacheKey)
  const ageMs = cached?.fetchedAt ? Date.now() - new Date(cached.fetchedAt).getTime() : null
  const fresh = ageMs !== null && ageMs >= 0 && ageMs < CACHE_TTL_MS

  const base = { start: startDate, end: shiftDays(startDate, span - 1), sourceStart, sourceEnd }

  if (fresh && cached?.data) {
    return { ok: true, stale: false, ...base, data: cached.data, error: null }
  }

  try {
    const data = await request(city, sourceStart, sourceEnd)
    writeStore(cacheKey, { fetchedAt: new Date().toISOString(), data })
    return { ok: true, stale: false, ...base, data, error: null }
  } catch (error) {
    if (cached?.data) {
      return { ok: true, stale: true, ...base, data: cached.data, error: error?.message || String(error) }
    }
    return { ok: false, stale: false, ...base, data: [], error: error?.message || String(error) }
  }
}

export const CACHE_TTL_HOURS = CACHE_TTL_MS / 3600000

export default { getSamePeriod, buildUrl, adaptResponse, shiftYear, shiftDays, CACHE_TTL_HOURS }
