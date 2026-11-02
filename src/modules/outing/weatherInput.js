/**
 * 出门模块 · 天气数据 → 内核规则入参
 *
 * 这里是「视图层数据」与「内核层入参」之间唯一的翻译处：
 * 字段名严格对齐 docs/CONTRACTS.md 第三节的「已有规则的入参约定」。
 *
 * 纯函数、零依赖（不引 Vue / DOM / 存储），因此可以用 node 单独跑单测；
 * 缺字段时统一给 null 而不是 undefined——规则里的 isNumeric 只认数字，
 * null 会进 evidence 标成「缺失」，页面就能显示「数据不足」而不是崩掉。
 */

/** 入参字段清单，顺序与交付报告里的映射表一致 */
export const WEATHER_INPUT_KEYS = [
  'temp',
  'humidity',
  'windSpeed',
  'windDir',
  'precipProb',
  'solar',
  'hourly',
  'pastMinTemp72h',
  'indoorTemp',
  'feedbackOffset',
]

/** 体感反馈每次的修正步长（偏冷 +1℃，偏热 −1℃） */
export const FEEDBACK_STEP = 1
/** 体感偏移上限，单位 ℃；不设上限会让偏移一路漂到荒谬值 */
export const FEEDBACK_OFFSET_LIMIT = 5
/** 反馈记录最多保留条数，超出淘汰最旧 */
export const FEEDBACK_LIMIT = 90

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 逐小时元素：只留规则用得到的字段，形状与 weather.js 的 hourly 一致 */
function mapHour(hour) {
  const source = hour || {}
  return {
    time: typeof source.time === 'string' ? source.time : '',
    temp: toNumber(source.temp),
    humidity: toNumber(source.humidity),
    windSpeed: toNumber(source.windSpeed),
    windDir: toText(source.windDir),
    precipProb: toNumber(source.precipProb),
    solar: toNumber(source.solar),
  }
}

/**
 * 拼装内核入参
 *
 * | 入参 | 来源 |
 * |---|---|
 * | temp | data.temp（当前气温，缺失时 weather.js 已回退到首个预报小时） |
 * | humidity | data.humidity |
 * | windSpeed | data.windSpeed（m/s，接口已用 wind_speed_unit=ms） |
 * | windDir | data.windDir（16 方位文字，返潮规则按方位判断） |
 * | precipProb | data.precipProb（首个预报小时的降水概率） |
 * | solar | data.solar（短波辐射 W/m²） |
 * | hourly | data.hourly（未来 48 小时，元素同上字段） |
 * | pastMinTemp72h | data.pastMinTemp72h（近似室内表面温度） |
 * | indoorTemp | 设置项，缺失时为 null 交由规则兜底 |
 * | feedbackOffset | 体感校准累计偏移，默认 0 |
 *
 * @param {object} data weather.get() 返回的 data
 * @param {{indoorTemp?: number, feedbackOffset?: number}} [options]
 * @returns {object} 内核入参
 */
export function buildWeatherInput(data, options = {}) {
  const source = data || {}
  return {
    temp: toNumber(source.temp),
    humidity: toNumber(source.humidity),
    windSpeed: toNumber(source.windSpeed),
    windDir: toText(source.windDir),
    precipProb: toNumber(source.precipProb),
    solar: toNumber(source.solar),
    hourly: Array.isArray(source.hourly) ? source.hourly.map(mapHour) : [],
    pastMinTemp72h: toNumber(source.pastMinTemp72h),
    indoorTemp: toNumber(options.indoorTemp),
    feedbackOffset: toNumber(options.feedbackOffset) ?? 0,
  }
}

/**
 * 室内表面温度：优先生效用户设置，没设则回落到指数配置里的兜底值。
 * 规则组明确「无实测，优先取过去 72 小时最低气温，缺失时用配置值兜底」，
 * 所以这里只补「用户显式设置过的那一层」，其余交给规则自己判断。
 */
export function resolveIndoorTemp(settings, config) {
  const fromSettings = toNumber(settings?.indoorTemp)
  if (fromSettings !== null) return fromSettings
  return toNumber(config?.indices?.damp?.thresholds?.indoorTempDefault)
}

/** 把偏移限制在 ±LIMIT ℃ 内，非数字按 0 处理 */
export function clampOffset(value) {
  const num = toNumber(value)
  if (num === null) return 0
  return Math.max(-FEEDBACK_OFFSET_LIMIT, Math.min(FEEDBACK_OFFSET_LIMIT, num))
}

/** 反馈方向 → 偏移增量 */
export function offsetDelta(sense) {
  if (sense === 'cold') return FEEDBACK_STEP
  if (sense === 'hot') return -FEEDBACK_STEP
  return 0
}
