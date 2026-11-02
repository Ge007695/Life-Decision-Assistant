/**
 * 服务层 · 本地存储封装
 *
 * 统一前缀 lda:，所有读写都走这里（工作指导书 3.4）。
 * 隐私模式下 localStorage 可能直接抛异常，写入前必须 try/catch：
 * 失败时降级为内存态，并告诉页面“本次记录不会保存”，而不是静默丢数据。
 */

const PREFIX = 'lda:'

/** 隐私模式降级后的内存副本 */
const memory = new Map()
let persistent = true

function normalizeKey(key) {
  return key.startsWith(PREFIX) ? key : `${PREFIX}${key}`
}

function storageAvailable() {
  try {
    const probe = `${PREFIX}__probe__`
    globalThis.localStorage.setItem(probe, '1')
    globalThis.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

persistent = storageAvailable()

/** 本次读写是否真的落盘 */
export function isPersistent() {
  return persistent
}

/**
 * 读取
 * @param {string} key 不带前缀的键名，如 'settings'
 * @param {*} [fallback]
 */
export function get(key, fallback = null) {
  const fullKey = normalizeKey(key)
  if (!persistent) return memory.has(fullKey) ? memory.get(fullKey) : fallback
  try {
    const raw = globalThis.localStorage.getItem(fullKey)
    if (raw === null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

/**
 * 写入
 * @returns {boolean} 是否真正落盘
 */
export function set(key, value) {
  const fullKey = normalizeKey(key)
  if (!persistent) {
    memory.set(fullKey, value)
    return false
  }
  try {
    globalThis.localStorage.setItem(fullKey, JSON.stringify(value))
    return true
  } catch {
    // 配额满或被禁用：转内存态，本次会话内仍可用
    persistent = false
    memory.set(fullKey, value)
    return false
  }
}

export function remove(key) {
  const fullKey = normalizeKey(key)
  memory.delete(fullKey)
  if (!persistent) return
  try {
    globalThis.localStorage.removeItem(fullKey)
  } catch {
    /* 忽略：删不掉不影响功能 */
  }
}

/** 列出本应用写入的全部键（不含前缀） */
export function listKeys() {
  if (!persistent) return [...memory.keys()].map((key) => key.slice(PREFIX.length))
  const keys = []
  try {
    for (let i = 0; i < globalThis.localStorage.length; i += 1) {
      const key = globalThis.localStorage.key(i)
      if (key && key.startsWith(PREFIX)) keys.push(key.slice(PREFIX.length))
    }
  } catch {
    /* 忽略 */
  }
  return keys
}

/** 清空本应用数据，不影响同域其他站点数据 */
export function clearAll() {
  for (const key of listKeys()) remove(key)
  memory.clear()
}

/** 固定键名，避免各处手写字符串写错 */
export const KEYS = {
  SETTINGS: 'settings',
  WEATHER: 'weather',
  SALARY: 'salary',
  CHECKLIST: 'checklist',
  FEEDBACK: 'feedback',
}

export default { get, set, remove, listKeys, clearAll, isPersistent, KEYS }
