/**
 * 服务层 · 天气取数 + 24 小时缓存 + 失败降级
 *
 * 接口选 Open-Meteo：免费额度、无需密钥，因此仓库里不可能出现密钥泄露问题。
 * 若改用和风天气，密钥放 .env.local（已被 .gitignore 排除），且只改本文件——
 * 字段映射全在这层，接口换了不影响内核层（工作指导书 4.2）。
 */

import { get as readStore, set as writeStore, KEYS } from './storage.js'

const API_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 9000
const FORECAST_DAYS = 7
const PAST_DAYS = 3
const HOURLY_HORIZON = 48

/** 16 方位罗盘，用于把接口的角度值换成 SE / S / SW 这类文字 */
const COMPASS = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW',
]

const HOURLY_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'wind_speed_10m',
  'wind_direction_10m',
  'precipitation_probability',
  'shortwave_radiation',
]

const DAILY_FIELDS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'sunrise',
  'sunset',
]

const CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'wind_speed_10m',
  'wind_direction_10m',
]

function degreesToCompass(deg) {
  if (typeof deg !== 'number' || Number.isNaN(deg)) return ''
  const index = Math.round(((deg % 360) / 22.5)) % 16
  return COMPASS[(index + 16) % 16]
}

/** 本地日期字符串 YYYY-MM-DD，不用 toISOString（会跑到 UTC 上） */
export function localDateString(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function buildUrl(city) {
  const params = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    hourly: HOURLY_FIELDS.join(','),
    daily: DAILY_FIELDS.join(','),
    current: CURRENT_FIELDS.join(','),
    timezone: city.timezone || 'Asia/Shanghai',
    wind_speed_unit: 'ms',
    forecast_days: String(FORECAST_DAYS),
    past_days: String(PAST_DAYS),
  })
  return `${API_ENDPOINT}?${params.toString()}`
}

function num(value, fallback = null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 把接口返回适配成内核层的 weatherInput。
 * 接口字段名只出现在这个函数里——换接口只改这里。
 */
export function adaptResponse(payload, city, now = new Date()) {
  const hourlyRaw = payload?.hourly
  if (!hourlyRaw || !Array.isArray(hourlyRaw.time)) {
    throw new Error('天气接口返回缺少逐小时数据')
  }

  const times = hourlyRaw.time
  const nowHourKey = `${localDateString(now)}T${String(now.getHours()).padStart(2, '0')}:00`

  const all = times.map((time, i) => ({
    time,
    temp: num(hourlyRaw.temperature_2m?.[i]),
    humidity: num(hourlyRaw.relative_humidity_2m?.[i]),
    windSpeed: num(hourlyRaw.wind_speed_10m?.[i]),
    windDir: degreesToCompass(hourlyRaw.wind_direction_10m?.[i]),
    windDeg: num(hourlyRaw.wind_direction_10m?.[i]),
    precipProb: num(hourlyRaw.precipitation_probability?.[i]),
    solar: num(hourlyRaw.shortwave_radiation?.[i]),
  }))

  // 未来时段：从当前小时起，供最佳时间窗与趋势图使用
  let startIndex = all.findIndex((hour) => hour.time >= nowHourKey)
  if (startIndex < 0) startIndex = Math.max(0, all.length - HOURLY_HORIZON)
  const future = all.slice(startIndex, startIndex + HOURLY_HORIZON)

  // 过去 72 小时最低气温：返潮规则用它近似室内表面温度
  const past = all.slice(Math.max(0, startIndex - 72), startIndex)
  const pastTemps = past.map((hour) => hour.temp).filter((value) => typeof value === 'number')
  const pastMinTemp72h = pastTemps.length > 0 ? Math.min(...pastTemps) : null

  const current = payload?.current || {}
  const head = future[0] || all[all.length - 1] || {}

  const dailyRaw = payload?.daily || {}
  const daily = (dailyRaw.time || []).map((date, i) => ({
    date,
    tempMax: num(dailyRaw.temperature_2m_max?.[i]),
    tempMin: num(dailyRaw.temperature_2m_min?.[i]),
    precipProb: num(dailyRaw.precipitation_probability_max?.[i]),
    sunrise: dailyRaw.sunrise?.[i] || '',
    sunset: dailyRaw.sunset?.[i] || '',
  }))

  return {
    city: city.name,
    cityId: city.id,
    date: localDateString(now),
    temp: num(current.temperature_2m, head.temp),
    humidity: num(current.relative_humidity_2m, head.humidity),
    windSpeed: num(current.wind_speed_10m, head.windSpeed),
    windDir: degreesToCompass(current.wind_direction_10m) || head.windDir,
    windDeg: num(current.wind_direction_10m, head.windDeg),
    precipProb: num(head.precipProb),
    solar: num(head.solar),
    hourly: future,
    hourlyAll: all,
    daily,
    pastMinTemp72h,
    sunrise: daily[0]?.sunrise || '',
    sunset: daily[0]?.sunset || '',
  }
}

async function request(city) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(buildUrl(city), { signal: controller.signal })
    if (!response.ok) throw new Error(`天气接口 HTTP ${response.status}`)
    const payload = await response.json()
    return adaptResponse(payload, city)
  } finally {
    clearTimeout(timer)
  }
}

function cacheKeyFor(cityId) {
  return `${KEYS.WEATHER}:${cityId}`
}

/**
 * 取天气：缓存有效直接用；过期才请求；请求失败沿用上次缓存并标注可能过期。
 *
 * @param {object} city cities.json 里的一条
 * @param {{force?: boolean}} [options]
 * @returns {Promise<{ok: boolean, stale: boolean, ageHours: number|null, fetchedAt: string|null, data: object|null, error: string|null}>}
 */
export async function get(city, options = {}) {
  const cacheKey = cacheKeyFor(city.id)
  const cached = readStore(cacheKey)
  const now = Date.now()

  const ageMs = cached?.fetchedAt ? now - new Date(cached.fetchedAt).getTime() : null
  const ageHours = ageMs === null ? null : Math.round((ageMs / 3600000) * 10) / 10
  const fresh = ageMs !== null && ageMs >= 0 && ageMs < CACHE_TTL_MS

  if (fresh && !options.force) {
    return { ok: true, stale: false, ageHours, fetchedAt: cached.fetchedAt, data: cached.data, error: null }
  }

  try {
    const data = await request(city)
    const fetchedAt = new Date().toISOString()
    writeStore(cacheKey, { fetchedAt, data })
    return { ok: true, stale: false, ageHours: 0, fetchedAt, data, error: null }
  } catch (error) {
    if (cached?.data) {
      // 降级：旧数据 + 明确的时间标注，不让页面空白
      return {
        ok: true,
        stale: true,
        ageHours,
        fetchedAt: cached.fetchedAt,
        data: cached.data,
        error: error?.message || String(error),
      }
    }
    return {
      ok: false,
      stale: true,
      ageHours: null,
      fetchedAt: null,
      data: null,
      error: error?.message || String(error),
    }
  }
}

/** 缓存剩余有效期（小时），设置页展示用 */
export function cacheRemainingHours(city) {
  const cached = readStore(cacheKeyFor(city.id))
  if (!cached?.fetchedAt) return 0
  const ageMs = Date.now() - new Date(cached.fetchedAt).getTime()
  return Math.max(0, Math.round(((CACHE_TTL_MS - ageMs) / 3600000) * 10) / 10)
}

export const CACHE_TTL_HOURS = CACHE_TTL_MS / 3600000

export default { get, buildUrl, adaptResponse, localDateString, cacheRemainingHours, CACHE_TTL_HOURS }
