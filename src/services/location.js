/**
 * 服务层 · 浏览器定位
 *
 * 只做一件事：把 navigator.geolocation 的回调式接口包成 async，并把各种失败
 * 翻译成固定的 reason 值，让界面上能给出**具体**的下一步，而不是一句「定位失败」。
 *
 * 三个必须区分的失败：
 *   denied      用户点了「拒绝」→ 不能反复弹窗骚扰，只能引导手动选择
 *   insecure    http 页面（或浏览器不支持安全上下文）→ 无论怎么点都不会成功，必须说明原因
 *   unavailable 设备/系统拿不到位置（无 GPS、被系统关闭）→ 提示检查系统定位开关
 *
 * 定位结果不在这里做「最近的哪个城市」判断——那是内核层的活（core/utils/geo.js），
 * 内核层也不允许碰 navigator，两边正好分开。
 */

/** 定位耗时上限：超过就判超时，避免用户对着转圈干等 */
const TIMEOUT_MS = 12000

/** 接受缓存位置的最长年龄：5 分钟内可复用，免得每次进设置页都重新定位 */
const MAX_AGE_MS = 5 * 60 * 1000

/** 允许的精度（米）。城市级天气不需要更精确，精度太低反而说明定位很差 */
const ACCURACY_M = 20000

/**
 * 把 GeolocationPositionError.code 翻译成固定 reason
 * 单独抽出来是为了能脱离浏览器环境做单测（Node 里没有 geolocation）。
 *   1 PERMISSION_DENIED / 2 POSITION_UNAVAILABLE / 3 TIMEOUT
 * 未知 code 归到 unavailable：至少提示用户去检查系统开关，比笼统的「失败」有用。
 */
export function reasonFromErrorCode(code) {
  if (code === 1) return 'denied'
  if (code === 2) return 'unavailable'
  if (code === 3) return 'timeout'
  return 'unavailable'
}

/**
 * 当前环境是否可能定位成功
 * @returns {{available: boolean, reason: string}}
 */
export function locationCapability() {
  if (typeof navigator === 'undefined') {
    return { available: false, reason: 'unsupported' }
  }
  if (!('geolocation' in navigator)) {
    return { available: false, reason: 'unsupported' }
  }
  // 浏览器只在 HTTPS 或 localhost 下暴露定位能力；http 部署时点了也不会有反应
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { available: false, reason: 'insecure' }
  }
  return { available: true, reason: '' }
}

/**
 * 请求当前位置
 *
 * @param {{timeout?: number, maxAge?: number}} [options]
 * @returns {Promise<{ok: boolean, latitude: number|null, longitude: number|null,
 *   accuracy: number|null, reason: string, message: string}>}
 *   reason 取值：'' | unsupported | insecure | denied | unavailable | timeout
 */
export function locate(options = {}) {
  const capability = locationCapability()
  if (!capability.available) {
    return Promise.resolve({
      ok: false,
      latitude: null,
      longitude: null,
      accuracy: null,
      reason: capability.reason,
      message: capability.reason === 'insecure' ? '当前页面不是 HTTPS，浏览器不允许定位' : '当前浏览器不支持定位',
    })
  }

  const timeout = options.timeout ?? TIMEOUT_MS
  const maxAge = options.maxAge ?? MAX_AGE_MS

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords || {}
        resolve({
          ok: true,
          latitude: typeof latitude === 'number' ? latitude : null,
          longitude: typeof longitude === 'number' ? longitude : null,
          accuracy: typeof accuracy === 'number' ? Math.round(accuracy) : null,
          reason: '',
          message: '',
        })
      },
      (error) => {
        // error.code: 1 权限拒绝 / 2 位置不可用 / 3 超时
        resolve({
          ok: false,
          latitude: null,
          longitude: null,
          accuracy: null,
          reason: reasonFromErrorCode(error?.code),
          message: error?.message || '',
        })
      },
      { enableHighAccuracy: false, timeout, maximumAge: maxAge },
    )
  })
}

export const LOCATION_TIMEOUT_MS = TIMEOUT_MS
export const LOCATION_ACCURACY_M = ACCURACY_M

export default { locate, locationCapability, reasonFromErrorCode, LOCATION_TIMEOUT_MS, LOCATION_ACCURACY_M }
