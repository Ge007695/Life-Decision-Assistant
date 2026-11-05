/**
 * 服务层 · 空气质量与紫外线取数（O-9 运动适宜度用）
 *
 * 为什么单独一个文件而不并进 weather.js：
 *   数据源不同（air-quality-api 与 forecast 是两个域名、两套限流），
 *   缓存时长也不同——天气预报 24 小时内基本不变，AQI 三小时就该刷新。
 *   混在一起会让「天气缓存有效」顺带把 AQI 也锁 24 小时。
 *
 * 为什么用 us_aqi 而不是 european_aqi：
 *   Open-Meteo 同时提供两套。european_aqi 的分档是 0—20 优、20—40 良，
 *   与中国用户熟悉的 0—50 优、51—100 良 不一致。
 *   us_aqi 的分档（50 / 100 / 150 / 200 / 300）与中国 AQI 基本对齐，
 *   配置里的 bands 就是按这套写的。
 *
 * 失败不抛异常：返回结构化对象，调用方按「三维结论」降级，页面标注缺哪些维度。
 */

import { get as readStore, set as writeStore, KEYS } from './storage.js'

const ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality'
/** AQI 变化快，超过 3 小时就不该再拿来判断要不要出门运动 */
const CACHE_TTL_MS = 3 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000

const CURRENT_FIELDS = ['us_aqi', 'pm2_5', 'uv_index']

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function cacheKeyFor(cityId) {
  return `${KEYS.WEATHER}:air:${cityId}`
}

export function buildUrl(city) {
  const params = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    current: CURRENT_FIELDS.join(','),
    timezone: city.timezone || 'Asia/Shanghai',
  })
  return `${ENDPOINT}?${params.toString()}`
}

/**
 * 把接口返回压成内核需要的四个字：aqi / pm25 / uv。
 * 字段名只出现在这里，换数据源只改本函数。
 */
export function adaptResponse(payload, now = new Date()) {
  const current = payload?.current
  if (!current) throw new Error('空气质量接口返回缺少 current 数据')
  return {
    aqi: num(current.us_aqi),
    pm25: num(current.pm2_5),
    uv: num(current.uv_index),
    observedAt: current.time || '',
    fetchedAt: now.toISOString(),
  }
}

async function request(city) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(buildUrl(city), { signal: controller.signal })
    if (!response.ok) throw new Error(`空气质量接口 HTTP ${response.status}`)
    return adaptResponse(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 取空气质量与紫外线。
 *
 * @param {object} city cities.json 里的一条
 * @param {{force?: boolean}} [options]
 * @returns {Promise<{ok: boolean, stale: boolean, data: object|null, error: string|null}>}
 */
export async function get(city, options = {}) {
  if (!city || !Number.isFinite(city.lat) || !Number.isFinite(city.lon)) {
    return { ok: false, stale: false, data: null, error: '城市坐标缺失' }
  }

  const cacheKey = cacheKeyFor(city.id)
  const cached = readStore(cacheKey)
  const ageMs = cached?.fetchedAt ? Date.now() - new Date(cached.fetchedAt).getTime() : null
  const fresh = ageMs !== null && ageMs >= 0 && ageMs < CACHE_TTL_MS

  if (fresh && !options.force) {
    return { ok: true, stale: false, data: cached.data, error: null }
  }

  try {
    const data = await request(city)
    writeStore(cacheKey, { fetchedAt: data.fetchedAt, data })
    return { ok: true, stale: false, data, error: null }
  } catch (error) {
    // 有旧值就用旧的，但标 stale，页面要写清「空气质量是几小时前的」
    if (cached?.data) {
      return { ok: true, stale: true, data: cached.data, error: error?.message || String(error) }
    }
    return { ok: false, stale: false, data: null, error: error?.message || String(error) }
  }
}

export const CACHE_TTL_HOURS = CACHE_TTL_MS / 3600000

export default { get, buildUrl, adaptResponse, CACHE_TTL_HOURS }
