/**
 * 城市定位与最近城市匹配测试
 *
 * 这组断言想守住的是三件事：
 *   1. 距离算的是球面距离，不是经纬度差——用平地公式在北方城市会选错邻居；
 *   2. 拿不到位置、坐标非法时不能"硬凑一个城市"出来，必须返回 null 让界面提示；
 *   3. 全国城市表本身要是干净的（id 不重复、坐标落在国境内），
 *      因为定位匹配完全依赖它——表错了，定位再准也会落到错的城市。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readData } from './_helpers.mjs'
import { describeDistance, findNearestCity, haversineKm, NEARBY_KM } from '../src/core/utils/geo.js'
import { locate, locationCapability, reasonFromErrorCode } from '../src/services/location.js'

const citiesData = readData('cities.json')
const cities = citiesData.cities

/* ---------- 距离 ---------- */

test('haversine：同一点距离为 0', () => {
  assert.equal(haversineKm(22.547, 114.0859, 22.547, 114.0859), 0)
})

test('haversine：深圳到广州约 105 公里（与公开里程同量级）', () => {
  const km = haversineKm(22.547, 114.0859, 23.1252, 113.2806)
  assert.ok(km > 95 && km < 115, `期望 95—115 km，实际 ${km.toFixed(1)}`)
})

test('haversine：赤道上经度 1° 约 111 公里，高纬经度 1° 明显更短', () => {
  const equator = haversineKm(0, 0, 0, 1)
  const north = haversineKm(45, 0, 45, 1)
  assert.ok(Math.abs(equator - 111.3) < 1, `赤道应为 111.3 km，实际 ${equator.toFixed(2)}`)
  // 45° 处 cos45≈0.707，经度 1° 约 78.7 km
  assert.ok(north < 82 && north > 75, `45°N 应为 75—82 km，实际 ${north.toFixed(2)}`)
})

test('haversine：跨 180° 经线取短边，不会算出半个地球', () => {
  const km = haversineKm(0, 179.5, 0, -179.5)
  assert.ok(Math.abs(km - 111.3) < 1, `应为约 111 km，实际 ${km.toFixed(2)}`)
})

test('haversine：坐标非法返回 NaN，不返回 0 假装成功', () => {
  assert.ok(Number.isNaN(haversineKm(200, 0, 0, 0)))
  assert.ok(Number.isNaN(haversineKm(0, 200, 0, 0)))
  assert.ok(Number.isNaN(haversineKm(null, 0, 0, 0)))
  assert.ok(Number.isNaN(haversineKm(0, 0, undefined, 0)))
  assert.ok(Number.isNaN(haversineKm(Number.NaN, 0, 0, 0)))
})

/* ---------- 最近城市 ---------- */

test('最近城市：深圳坐标落在深圳', () => {
  const near = findNearestCity(cities, 22.55, 114.06)
  assert.ok(near)
  assert.equal(near.city.name, '深圳')
  assert.ok(near.distanceKm < 5)
})

test('最近城市：北京坐标落在北京', () => {
  const near = findNearestCity(cities, 39.9, 116.4)
  assert.equal(near.city.name, '北京')
})

test('最近城市：上海坐标落在上海', () => {
  const near = findNearestCity(cities, 31.23, 121.47)
  assert.equal(near.city.name, '上海')
})

test('最近城市：北方城市不会因为经度差权重过大而选错', () => {
  // 呼和浩特 (40.82, 111.67) 附近取点，不能被东边更远的城市抢走
  const near = findNearestCity(cities, 40.85, 111.6)
  assert.equal(near.city.name, '呼和浩特')
  assert.ok(near.distanceKm < 30)
})

test('最近城市：结果一定是全部候选里距离最小的那个', () => {
  const point = { lat: 30.5, lon: 114.3 }
  const near = findNearestCity(cities, point.lat, point.lon)
  const minimum = Math.min(...cities.map((c) => haversineKm(point.lat, point.lon, c.lat, c.lon)))
  assert.equal(near.distanceKm, Math.round(minimum * 10) / 10)
})

test('最近城市：空列表或非法坐标返回 null，不硬凑', () => {
  assert.equal(findNearestCity([], 22.5, 114), null)
  assert.equal(findNearestCity(null, 22.5, 114), null)
  assert.equal(findNearestCity(cities, 999, 114), null)
  assert.equal(findNearestCity(cities, 22.5, 'x'), null)
})

test('最近城市：坐标缺失的条目被跳过，不会当成 (0,0)', () => {
  const list = [
    { id: 'broken', name: '缺坐标', lat: null, lon: null },
    { id: 'ok', name: '正常', lat: 22.5, lon: 114 },
  ]
  const near = findNearestCity(list, 22.5, 114)
  assert.equal(near.city.id, 'ok')
})

test('距离描述：30 公里内说「内」，更远说「外」', () => {
  assert.match(describeDistance(NEARBY_KM - 5), /内$/)
  assert.match(describeDistance(NEARBY_KM + 40), /外$/)
  assert.equal(describeDistance(Number.NaN), '')
})

/* ---------- 定位服务的失败分支 ---------- */

test('定位能力：Node 环境没有 geolocation，应报 unsupported 而不是抛异常', () => {
  const capability = locationCapability()
  assert.equal(capability.available, false)
  assert.equal(capability.reason, 'unsupported')
})

test('定位：不支持时返回结构化失败，不 throw', async () => {
  const result = await locate()
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unsupported')
  assert.equal(result.latitude, null)
  assert.match(result.message, /定位/)
})

test('定位：错误码映射成具体原因，未知码不假装成功', () => {
  assert.equal(reasonFromErrorCode(1), 'denied')
  assert.equal(reasonFromErrorCode(2), 'unavailable')
  assert.equal(reasonFromErrorCode(3), 'timeout')
  assert.equal(reasonFromErrorCode(0), 'unavailable')
  assert.equal(reasonFromErrorCode(undefined), 'unavailable')
})

/* ---------- 城市表本身 ---------- */

test('城市表：覆盖全国，不是只有几个示例城市', () => {
  assert.ok(cities.length >= 300, `城市数应 ≥300，实际 ${cities.length}`)
  const provinces = new Set(cities.map((city) => city.province))
  assert.ok(provinces.size >= 30, `省级行政区应 ≥30，实际 ${provinces.size}`)
})

test('城市表：id 唯一，否则选中会串台', () => {
  const ids = cities.map((city) => city.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('城市表：每条都有名字、省份、合法坐标与时区', () => {
  for (const city of cities) {
    assert.ok(city.name && city.name.length > 0, `${city.id} 缺 name`)
    assert.ok(city.province && city.province.length > 0, `${city.id} 缺 province`)
    assert.ok(typeof city.lat === 'number' && city.lat > 3 && city.lat < 54, `${city.id} 纬度异常 ${city.lat}`)
    assert.ok(typeof city.lon === 'number' && city.lon > 73 && city.lon < 136, `${city.id} 经度异常 ${city.lon}`)
    assert.match(city.timezone, /^Asia\//, `${city.id} 时区异常`)
  }
})

test('城市表：默认城市存在，且老的四个 id 保持不变（用户已存设置不能失效）', () => {
  assert.ok(cities.some((city) => city.id === citiesData.default))
  for (const legacy of ['shenzhen', 'guangzhou', 'zhuhai', 'shantou']) {
    assert.ok(cities.some((city) => city.id === legacy), `旧 id ${legacy} 丢了`)
  }
})

test('城市表：没有「市辖区」这类占位名', () => {
  assert.equal(cities.filter((city) => /市辖区|^县$/.test(city.name)).length, 0)
})

test('城市表：每条都能被天气接口直接使用（lat/lon 转字符串不变形）', () => {
  const sample = cities[0]
  assert.equal(String(sample.lat), String(Number(sample.lat)))
  assert.ok(!String(sample.lon).includes('e'), '经度不能是科学计数法')
})
