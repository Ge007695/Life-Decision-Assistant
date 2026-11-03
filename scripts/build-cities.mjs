/**
 * 数据生成脚本 · 全国城市坐标
 *
 * 目的：把「四个城市」扩到全国地级市，让用户能选自己所在的城市。
 *
 * 数据来源：阿里 DataV 行政区划 GeoJSON（areas_v3）
 *   - 全国省级：bound/100000_full.json
 *   - 省级下级：bound/{adcode}_full.json
 *
 * 为什么用它而不是地理编码接口：GeoJSON 的 properties 里直接带
 * adcode（行政区划代码）、name（官方全名）、center（行政中心经纬度），
 * 既权威又无同名歧义（"朝阳"这种名字用搜索会命中错的那个），一次取全还不用逐条查。
 *
 * 纪律：本脚本是一次性构建工具，产物是 public/data/cities.json 静态文件。
 * 运行时页面**不调用**任何地图接口——断网也能选城市，符合项目"断网降级"的要求。
 *
 * 用法：node --use-env-proxy scripts/build-cities.mjs          # 生成
 *      node --use-env-proxy scripts/build-cities.mjs --dry    # 只看统计，不写文件
 *
 * 注意：本机 Node 访问境外域名需要加 --use-env-proxy（走 HTTPS_PROXY）；
 * 访问 geo.datav.aliyun.com 属国内域名，不加也能通。
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public/data/cities.json')
const DRY = process.argv.includes('--dry')

const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound'
const COUNTRY = `${BASE}/100000_full.json`

/** 直辖市：DataV 的下级是「区」，不是城市，所以直接用省本身当城市 */
const MUNICIPALITIES = new Set([110000, 120000, 310000, 500000])

/** 下级数据不细分的省级：直接当单个城市条目 */
const FLAT_PROVINCES = new Set([710000, 810000, 820000])

/** 时区：港澳台与大陆同为 UTC+8，但写各自时区更准确（天气接口按此时区对齐小时） */
const TIMEZONE = { 710000: 'Asia/Taipei', 810000: 'Asia/Hong_Kong', 820000: 'Asia/Macau' }

/** 旧版 cities.json 的 id，保持不变，避免用户已存的设置失效 */
const LEGACY_ID = { 440300: 'shenzhen', 440100: 'guangzhou', 440400: 'zhuhai', 440500: 'shantou' }

/** 省名归一：广东省 → 广东；内蒙古自治区 → 内蒙古；香港特别行政区 → 香港 */
export function normalizeProvince(text) {
  if (!text) return ''
  return String(text)
    .replace(/(维吾尔|壮族|回族)?自治区$/, '')
    .replace(/特别行政区$/, '')
    .replace(/[省市]$/, '')
    .trim()
}

/** 城市名归一：深圳市 → 深圳；延边朝鲜族自治州、阿拉善盟、阿里地区保留全名 */
export function shortCityName(name) {
  if (!name) return ''
  if (/(自治州|地区|盟|自治县|林区)$/.test(name)) return name
  return name.replace(/市$/, '')
}

async function fetchJson(url, retries = 3) {
  let lastError = null
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await globalThis.fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
      await sleep(500 * attempt)
    }
  }
  throw new Error(`取数失败 ${url}：${lastError?.message}`)
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

/** 限并发的简单池子，别把数据源打太狠 */
async function pooled(items, limit, worker) {
  const out = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      try {
        out[index] = await worker(items[index], index)
      } catch (error) {
        out[index] = { error: error.message, item: items[index] }
      }
      await sleep(120)
    }
  })
  await Promise.all(runners)
  return out
}

/** 把一条 GeoJSON feature 拆成 { adcode, name, center } */
function readFeature(feature) {
  const props = feature?.properties || {}
  const adcode = Number(props.adcode)
  const name = props.name
  const center = props.center
  if (!Number.isFinite(adcode) || !name || !Array.isArray(center) || center.length < 2) return null
  const [lon, lat] = center
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { adcode, name, lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000 }
}

function toCity(entry, province, timezone, options = {}) {
  const id = LEGACY_ID[entry.adcode] || String(entry.adcode)
  // 港澳台是平铺条目，名字本身带「特别行政区/省」后缀，用省名归一处理
  const name = options.flat ? normalizeProvince(entry.name) : shortCityName(entry.name)
  return {
    id,
    name,
    province: normalizeProvince(province.name),
    lat: entry.lat,
    lon: entry.lon,
    timezone: TIMEZONE[province.adcode] || timezone,
  }
}

async function main() {
  console.log('读取全国省级清单…')
  const country = await fetchJson(COUNTRY)

  const provinces = []
  for (const feature of country.features || []) {
    const item = readFeature(feature)
    if (!item) continue
    if (!/^\d{6}$/.test(String(item.adcode))) continue
    if (item.adcode % 10000 !== 0) continue
    provinces.push(item)
  }
  console.log(`省级行政区 ${provinces.length} 个`)

  // 需要展开下级的省（排除直辖市与港澳台）
  const expand = provinces.filter(
    (p) => !MUNICIPALITIES.has(p.adcode) && !FLAT_PROVINCES.has(p.adcode),
  )
  console.log(`展开下级的省 ${expand.length} 个，开始取市级坐标…`)

  const results = await pooled(expand, 4, async (province) => {
    const geo = await fetchJson(`${BASE}/${province.adcode}_full.json`)
    const children = []
    for (const feature of geo.features || []) {
      const item = readFeature(feature)
      if (!item) continue
      // 省直辖县级行政区（如济源、仙桃）也收进来，level 是 district
      children.push(item)
    }
    return { province, children }
  })

  const failed = results.filter((r) => r?.error)
  if (failed.length) {
    console.log(`\n有 ${failed.length} 个省取数失败：`)
    for (const item of failed) console.log(`  ${item.item.name}：${item.error}`)
    throw new Error('下级数据不完整，已中止（避免生成残缺的城市表）')
  }

  const rows = []
  for (const province of provinces) {
    if (MUNICIPALITIES.has(province.adcode) || FLAT_PROVINCES.has(province.adcode)) {
      const flat = FLAT_PROVINCES.has(province.adcode)
      rows.push(toCity(province, province, 'Asia/Shanghai', { flat }))
      continue
    }
    const result = results.find((r) => r.province.adcode === province.adcode)
    for (const child of result?.children || []) {
      rows.push(toCity(child, province, 'Asia/Shanghai'))
    }
  }

  // 去重：同一个 adcode 只留一条
  const seen = new Set()
  const cities = rows.filter((city) => {
    if (seen.has(city.id)) return false
    seen.add(city.id)
    return true
  })

  cities.sort((a, b) => {
    if (a.province !== b.province) return a.province.localeCompare(b.province, 'zh-Hans-CN')
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })

  const output = {
    meta: {
      version: '2.0.0',
      updated: new Date().toISOString().slice(0, 10),
      note: '全国地级市及港澳台坐标，用于天气接口参数；由 scripts/build-cities.mjs 生成，请勿手改。',
      source: '阿里 DataV 行政区划 GeoJSON（areas_v3）',
      count: cities.length,
    },
    default: 'shenzhen',
    cities,
  }

  const provinceCount = new Set(cities.map((c) => c.province)).size
  console.log(`\n共 ${cities.length} 个城市，覆盖 ${provinceCount} 个省级行政区`)

  const missingDefault = !cities.some((c) => c.id === output.default)
  if (missingDefault) console.log(`⚠ 默认城市 ${output.default} 不在列表里，需修正`)

  const bounds = cities.filter((c) => c.lat < 3 || c.lat > 54 || c.lon < 73 || c.lon > 136)
  if (bounds.length) {
    console.log(`⚠ 有 ${bounds.length} 个坐标落在国境框外，需抽查：`)
    for (const c of bounds.slice(0, 10)) console.log(`  ${c.province}·${c.name} ${c.lat},${c.lon}`)
  }

  if (DRY) {
    console.log('--dry 模式，不写文件')
    return
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`已写入 ${OUT}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('生成失败：', error.message)
    process.exit(1)
  })
}
