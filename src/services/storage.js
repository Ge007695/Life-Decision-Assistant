/**
 * 服务层 · 本地存储封装
 *
 * 统一前缀 lda:，所有读写都走这里（工作指导书 3.4）。
 * 隐私模式下 localStorage 可能直接抛异常，写入前必须 try/catch：
 * 失败时降级为内存态，并告诉页面“本次记录不会保存”，而不是静默丢数据。
 *
 * 云同步接入后：本机仍是唯一的同步读写入口（保证页面代码照旧同步调用），
 * 每次成功写入/删除都会通知云同步层（setSyncSink 注册的 sink），由它异步推送。
 * 云同步层回填数据时用 { silent: true }，避免“拉下来又推回去”的无限回声。
 */

const PREFIX = 'lda:'

/** 以 __ 开头的键是内部标记（如云同步的归属用户），不当作业务数据 */
const INTERNAL_PREFIX = '__'

/** 隐私模式降级后的内存副本 */
const memory = new Map()
let persistent = true

/** 云同步层注册的写入回调：(key, value|null) => void，null 表示删除 */
let syncSink = null

function normalizeKey(key) {
  return key.startsWith(PREFIX) ? key : `${PREFIX}${key}`
}

function stripPrefix(key) {
  return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key
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
 * 注册云同步回调。传 null 取消。
 * 服务层不直接 import 云同步模块，避免两个模块互相依赖成环。
 * @param {(key: string, value: unknown|null) => void | null} sink
 */
export function setSyncSink(sink) {
  syncSink = typeof sink === 'function' ? sink : null
}

function notifySync(key, value) {
  if (!syncSink) return
  try {
    syncSink(key, value)
  } catch {
    /* 同步层自己的异常不该影响本地写入 */
  }
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
 * @param {string} key
 * @param {*} value
 * @param {{silent?: boolean}} [options] silent：不回传云同步（云端回填时用）
 * @returns {boolean} 是否真正落盘
 */
export function set(key, value, options = {}) {
  const fullKey = normalizeKey(key)
  let ok = persistent

  if (!persistent) {
    memory.set(fullKey, value)
  } else {
    try {
      globalThis.localStorage.setItem(fullKey, JSON.stringify(value))
    } catch {
      // 配额满或被禁用：转内存态，本次会话内仍可用
      persistent = false
      ok = false
      memory.set(fullKey, value)
    }
  }

  if (!options.silent) notifySync(stripPrefix(fullKey), value)
  return ok
}

export function remove(key, options = {}) {
  const fullKey = normalizeKey(key)
  memory.delete(fullKey)
  if (persistent) {
    try {
      globalThis.localStorage.removeItem(fullKey)
    } catch {
      /* 忽略：删不掉不影响功能 */
    }
  }
  if (!options.silent) notifySync(stripPrefix(fullKey), null)
}

/** 列出本应用写入的全部键（不含前缀，不含内部标记） */
export function listKeys() {
  if (!persistent) {
    return [...memory.keys()]
      .map((key) => key.slice(PREFIX.length))
      .filter((key) => !key.startsWith(INTERNAL_PREFIX))
  }
  const keys = []
  try {
    for (let i = 0; i < globalThis.localStorage.length; i += 1) {
      const key = globalThis.localStorage.key(i)
      if (!key || !key.startsWith(PREFIX)) continue
      const bare = key.slice(PREFIX.length)
      if (bare.startsWith(INTERNAL_PREFIX)) continue
      keys.push(bare)
    }
  } catch {
    /* 忽略 */
  }
  return keys
}

/** 清空本应用数据（含内部标记），不影响同域其他站点数据 */
export function clearAll(options = {}) {
  const keys = []
  if (persistent) {
    try {
      for (let i = 0; i < globalThis.localStorage.length; i += 1) {
        const key = globalThis.localStorage.key(i)
        if (key && key.startsWith(PREFIX)) keys.push(key.slice(PREFIX.length))
      }
    } catch {
      /* 忽略 */
    }
  }
  for (const key of keys) remove(key, { silent: options.silent })
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

export default { get, set, remove, listKeys, clearAll, isPersistent, setSyncSink, KEYS }
