/**
 * 服务层 · 云同步
 *
 * 目标：把原来只存本机浏览器的那几项数据（城市/体感设置、工资测算入参、
 * 每日清单勾选、体感反馈记录）真正存到云上，换设备或清缓存后登录即可恢复。
 *
 * 设计取舍（为什么不是“全部改成 async”）：
 *   - 页面与组合式函数原来都是同步读写的，改成 await 要动 7 个调用点、
 *     包括 1000 行的花钱页，回归风险远大于收益；
 *   - 所以本机 localStorage 保留为“同步缓存 + 离线副本”，云端是持久化的真身：
 *     登录时先拉云端覆盖本机，之后每次写入本机后异步推送云端。
 *   - 未登录时**不假装已同步**：界面明确显示“仅存本机”，推送失败也会显示错误，
 *     不允许静默丢数据。
 *
 * 数据表 public.user_records 是“每用户每键一行”，owner_id 由数据库
 * DEFAULT auth.uid() 填充，前端绝不传 owner_id，权限由 RLS 兜底。
 */
import { reactive } from 'vue'
import { cloud } from './cloud.js'
import { get, set, listKeys, clearAll, setSyncSink } from './storage.js'

const TABLE = 'user_records'
/** 天气是有 TTL 的派生缓存，存云上没有意义 */
const UNSYNCED = /^weather:/
/** 本机记录“上次同步到哪个账号”，用于换账号时清掉上一个人的数据 */
const OWNER_KEY = '__cloud_owner'
const PUSH_DEBOUNCE_MS = 800

export const cloudState = reactive({
  /** 会话恢复是否已完成（未完成时不要急着渲染“未登录”） */
  ready: false,
  /** { id, name, email, phone } 或 null */
  user: null,
  /** idle | signed-out | syncing | synced | error */
  phase: 'idle',
  /** 同步状态说明（成功时为空） */
  message: '',
  /** 登录/授权过程的错误 */
  loginError: '',
  lastSyncedAt: null,
  /** 本机已同步的记录条数 */
  syncedCount: 0,
  /** 待推送的改动条数 */
  pendingCount: 0,
})

/** key -> value；value 为 null 表示需要云端删除 */
const pending = new Map()
let flushTimer = null
let flushing = false

/* ---------------- 对外：登录态 ---------------- */

export function isSignedIn() {
  return !!cloudState.user
}

/**
 * 启动时调用一次：处理 OAuth 回调 → 恢复会话 → 拉取云端数据。
 * 必须在挂载页面前完成，否则首屏会先渲染一遍“未登录”。
 * @returns {Promise<object|null>} 当前会话
 */
export async function initCloud() {
  setSyncSink(handleLocalChange)
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      if (pending.size) scheduleFlush(0)
    })
  }

  try {
    await consumeOAuthCallback()
  } catch (error) {
    cloudState.loginError = describeError(error)
  }

  let session = null
  try {
    const { data } = await cloud.auth.getSession()
    session = data
  } catch (error) {
    cloudState.loginError = describeError(error)
  }

  applySession(session)

  if (session) {
    try {
      await prepareUserData(session)
    } catch (error) {
      cloudState.phase = 'error'
      cloudState.message = describeError(error)
    }
  } else {
    cloudState.phase = 'signed-out'
  }

  cloudState.ready = true
  return session
}

/** 手机号验证码：发码 */
export async function requestPhoneCode(phone) {
  cloudState.loginError = ''
  const { data, error } = await cloud.auth.sendOtp({ phone })
  if (error) {
    cloudState.loginError = describeError(error)
    throw new Error(cloudState.loginError)
  }
  return data // { verificationId, isExistingUser }
}

/** 手机号验证码：验码登录 */
export async function submitPhoneCode(phone, challenge, token) {
  cloudState.loginError = ''
  const { data, error } = await cloud.auth.verifyOtp({
    phone,
    verificationId: challenge.verificationId,
    isExistingUser: challenge.isExistingUser,
    token,
  })
  if (error) {
    cloudState.loginError = describeError(error)
    throw new Error(cloudState.loginError)
  }
  await afterSignIn(data)
  return data
}

/** WorkBuddy 账号登录：跳转到授权页（同标签页，PKCE 证明存在本标签页里） */
export async function signInWithWorkBuddy() {
  cloudState.loginError = ''
  const back = new URL(window.location.href)
  back.pathname = '/'
  for (const key of ['code', 'state', 'provider']) back.searchParams.delete(key)

  const { data, error } = await cloud.auth.signInWithOAuth({
    provider: 'workbuddy',
    redirectTo: back.toString(),
  })
  if (error) {
    cloudState.loginError = describeError(error)
    throw new Error(cloudState.loginError)
  }
  window.location.assign(data.url)
}

/** 退出登录：云端数据保留，本机副本清除，避免下一个人看到上一个人的记录 */
export async function signOutCloud() {
  pending.clear()
  if (flushTimer) clearTimeout(flushTimer)
  try {
    await cloud.auth.signOut()
  } catch {
    /* 断网也必须能登出，本地照常清理 */
  }
  applySession(null)
  clearAll({ silent: true })
  cloudState.phase = 'signed-out'
  cloudState.message = ''
  cloudState.syncedCount = 0
  cloudState.lastSyncedAt = null
}

/** 手动重试：立即把待推送的改动送上去 */
export async function retrySync() {
  if (!cloudState.user) return
  await flush()
}

/** 手动拉取：以云端为准覆盖本机 */
export async function pullFromCloud() {
  if (!cloudState.user) throw new Error('未登录')
  cloudState.phase = 'syncing'
  const { data, error } = await cloud.database.from(TABLE).select('data_key, payload')
  if (error) {
    cloudState.phase = 'error'
    cloudState.message = describeError(error)
    throw error
  }

  const remote = new Map()
  for (const row of data || []) {
    if (row?.data_key) remote.set(row.data_key, row.payload)
  }

  for (const [key, payload] of remote) {
    set(key, payload, { silent: true })
  }

  // 本机有、云端没有（首次登录 / 离线期间新写的）→ 补传
  for (const key of listKeys()) {
    if (UNSYNCED.test(key) || remote.has(key)) continue
    queuePush(key, get(key))
  }

  cloudState.phase = pending.size ? 'syncing' : 'synced'
  cloudState.message = ''
  cloudState.lastSyncedAt = Date.now()
  countSynced()
  if (pending.size) scheduleFlush(0)
  return { pulled: remote.size }
}

/* ---------------- 对外：本机改动 → 云端 ---------------- */

function handleLocalChange(key, value) {
  if (!cloudState.user) return
  if (UNSYNCED.test(key)) return
  queuePush(key, value)
}

function queuePush(key, value) {
  pending.set(key, value)
  cloudState.pendingCount = pending.size
  scheduleFlush(PUSH_DEBOUNCE_MS)
}

function scheduleFlush(delay) {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, delay)
}

async function flush() {
  if (!cloudState.user || flushing || pending.size === 0) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    cloudState.phase = 'error'
    cloudState.message = '当前离线：改动已存在本机，联网后会自动补传。'
    return
  }

  flushing = true
  const batch = [...pending.entries()]
  pending.clear()
  cloudState.pendingCount = 0
  cloudState.phase = 'syncing'

  try {
    const upserts = []
    const deletes = []
    for (const [key, value] of batch) {
      if (value === null) {
        deletes.push(key)
      } else {
        upserts.push({
          data_key: key,
          payload: value,
          owner_name: cloudState.user.name ?? null,
        })
      }
    }

    if (upserts.length) {
      const { error } = await cloud.database
        .from(TABLE)
        .upsert(upserts, { onConflict: 'owner_id,data_key' })
      if (error) throw error
    }

    for (const key of deletes) {
      const { error } = await cloud.database.from(TABLE).delete().eq('data_key', key)
      if (error) throw error
    }

    cloudState.phase = 'synced'
    cloudState.message = ''
    cloudState.lastSyncedAt = Date.now()
    countSynced()
  } catch (error) {
    // 没推上去的改动放回队列，下次（或用户点重试时）继续推，不丢
    for (const [key, value] of batch) {
      if (!pending.has(key)) pending.set(key, value)
    }
    cloudState.pendingCount = pending.size
    cloudState.phase = 'error'
    cloudState.message = describeError(error)
  } finally {
    flushing = false
    if (pending.size && cloudState.phase !== 'error') scheduleFlush(PUSH_DEBOUNCE_MS)
  }
}

/* ---------------- 内部 ---------------- */

function applySession(session) {
  if (!session?.user) {
    cloudState.user = null
    return
  }
  const { id, name, email, phone } = session.user
  cloudState.user = { id, name: name || '', email: email || '', phone: phone || '' }
}

async function afterSignIn(session) {
  applySession(session)
  await prepareUserData(session)
  cloudState.phase = 'synced'
  cloudState.lastSyncedAt = Date.now()
}

/** 换账号时先清本机旧数据，再拉当前账号的；同账号则直接拉 */
async function prepareUserData(session) {
  const previousOwner = get(OWNER_KEY, null)
  if (previousOwner && previousOwner !== session.user.id) {
    clearAll({ silent: true })
  }
  set(OWNER_KEY, session.user.id, { silent: true })
  await pullFromCloud()
}

/** 回调落地页：按 provider 分派，绝不对两种提供商无脑都调一次 */
async function consumeOAuthCallback() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) return null

  const provider = url.searchParams.get('provider')
  let handled = null

  if (provider === 'workbuddy') {
    handled = await cloud.auth.handleWorkBuddyCallback(url.search)
  } else if (provider === 'wechat') {
    handled = await cloud.auth.handleWechatWebCallback(url.search)
  } else {
    cleanCallbackParams()
    throw new Error('授权回调缺少有效的登录方式，请重新登录。')
  }

  const { data, error } = handled
  if (error) {
    cleanCallbackParams()
    throw error
  }
  // 清理 code/state/provider，但保留业务参数（如 ?sharecode=）
  cleanCallbackParams()
  return data
}

function cleanCallbackParams() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('code') && !url.searchParams.has('state') && !url.searchParams.has('provider')) {
    return
  }
  for (const key of ['code', 'state', 'provider', 'error', 'error_description']) {
    url.searchParams.delete(key)
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function countSynced() {
  cloudState.syncedCount = listKeys().filter((key) => !UNSYNCED.test(key)).length
}

/** 把 SDK 的错误翻成用户能照着做的下一步，而不是甩一句英文 */
function describeError(error) {
  const code = error?.code
  const kind = error?.kind
  if (code === '42501') return '云端拒绝写入：登录已失效或没有权限，请重新登录。'
  if (code === '42P01') return '云端数据表不存在，请联系维护者。'
  if (code === '23505') return '云端已有同名记录，请重试。'
  if (error?.status === 401) return '登录已过期，请重新登录后再同步。'
  if (kind === 'network') return '网络不可用，改动已存在本机，联网后会自动补传。'
  if (kind === 'unauthenticated' || kind === 'invalid_grant') return '登录已失效，请重新登录。'
  return error?.message || '操作失败，请重试。'
}

/** 手机号脱敏，避免把完整号码显示在页面上 */
export function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone || ''
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

export default {
  cloudState,
  initCloud,
  isSignedIn,
  requestPhoneCode,
  submitPhoneCode,
  signInWithWorkBuddy,
  signOutCloud,
  retrySync,
  pullFromCloud,
  maskPhone,
}
