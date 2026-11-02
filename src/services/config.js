/**
 * 服务层 · 配置读取
 *
 * 唯一负责“把 public/data 下的 JSON 取回来”的地方。
 * 内核层保持纯净：它只接收 createConfig() 组装好的配置对象，
 * 回测脚本用 fs 读同样六份文件、走同一个 createConfig()。
 */

import { createConfig } from '@/core/config.js'

const SOURCES = {
  indices: 'indices.json',
  holidays: 'holidays.json',
  taxRules: 'tax-rules.json',
  clothingTable: 'clothing-table.json',
  cities: 'cities.json',
  checklists: 'checklists.json',
}

function dataUrl(file) {
  const base = import.meta.env.BASE_URL || '/'
  return `${base.replace(/\/$/, '')}/data/${file}`
}

async function fetchJson(file) {
  const response = await fetch(dataUrl(file), { cache: 'no-cache' })
  if (!response.ok) throw new Error(`${file} 读取失败（HTTP ${response.status}）`)
  return response.json()
}

/**
 * 加载并校验全部配置
 * @returns {Promise<{config: object, loadErrors: string[]}>}
 */
export async function loadConfig() {
  const entries = Object.entries(SOURCES)
  const loadErrors = []
  const raw = {}

  const results = await Promise.allSettled(entries.map(([, file]) => fetchJson(file)))

  results.forEach((result, i) => {
    const [key, file] = entries[i]
    if (result.status === 'fulfilled') {
      raw[key] = result.value
    } else {
      loadErrors.push(`${file}: ${result.reason?.message || result.reason}`)
      raw[key] = {}
    }
  })

  const config = createConfig(raw)
  return { config, loadErrors }
}
