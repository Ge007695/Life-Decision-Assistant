/**
 * 内核层 · 坐标距离与最近城市
 *
 * 定位拿到的是一个经纬度点，但天气接口要的是「一个城市」。
 * 这里负责把点落到最近的城市上——用球面距离（haversine），不用直线距离：
 * 在中国纬度范围里，经度 1° 对应的实际距离随纬度变化，纬度 22° 处约 103 km，
 * 纬度 45° 处只有 79 km。用平面距离算会让北方城市的匹配明显偏向东西向的邻居。
 *
 * 纯函数：不读浏览器定位、不发请求，只接收已经拿到的坐标。
 * 「怎么拿到坐标」是 src/services/location.js 的事（内核层禁用 navigator）。
 */

/** 地球平均半径（km），IUGG 推荐值 */
export const EARTH_RADIUS_KM = 6371.0088

const DEG_TO_RAD = Math.PI / 180

function toRadians(degrees) {
  return degrees * DEG_TO_RAD
}

function isCoordinate(lat, lon) {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  )
}

/**
 * 两点间的球面大圆距离
 * @returns {number} 公里数；坐标非法时返回 NaN
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  if (!isCoordinate(lat1, lon1) || !isCoordinate(lat2, lon2)) return Number.NaN

  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

/**
 * 在候选城市里找离给定坐标最近的一个
 *
 * @param {Array<{id: string, name: string, lat: number, lon: number}>} cities
 * @param {number} latitude
 * @param {number} longitude
 * @returns {{city: object, distanceKm: number}|null} 没有可用城市或坐标非法时返回 null
 */
export function findNearestCity(cities, latitude, longitude) {
  if (!Array.isArray(cities) || cities.length === 0) return null
  if (!isCoordinate(latitude, longitude)) return null

  let best = null
  for (const city of cities) {
    if (!city || !isCoordinate(city.lat, city.lon)) continue
    const distanceKm = haversineKm(latitude, longitude, city.lat, city.lon)
    if (!Number.isFinite(distanceKm)) continue
    if (!best || distanceKm < best.distanceKm) {
      best = { city, distanceKm }
    }
  }

  if (!best) return null
  return { city: best.city, distanceKm: Math.round(best.distanceKm * 10) / 10 }
}

/**
 * 距离是否近到「可以说这就是你所在的城市」
 *
 * 370 个城市之间平均间距约 100 km，落在 30 km 内基本能确定是本地；
 * 更远时仍给出最近的城市，但界面上要说明「按最近城市估算」，
 * 不能让用户以为自己被精确定位到了（工作指导书 11.3 的诚实标注）。
 */
export const NEARBY_KM = 30

export function describeDistance(distanceKm) {
  if (!Number.isFinite(distanceKm)) return ''
  if (distanceKm <= NEARBY_KM) return `约 ${Math.round(distanceKm)} 公里内`
  return `约 ${Math.round(distanceKm)} 公里外`
}

export default { haversineKm, findNearestCity, describeDistance, EARTH_RADIUS_KM, NEARBY_KM }
