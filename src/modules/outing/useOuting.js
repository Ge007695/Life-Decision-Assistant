/**
 * 出门模块 · 首页组合式函数
 *
 * 页面只负责「把这里算好的结构画出来」：取数、拼入参、跑规则、挑 banner、
 * 汇总清单、拼 7 天简表、体感反馈全部在这一层（工作指导书 4.4 / 8.1）。
 *
 * 失败与降级策略：
 *   - ok:false（一次都没取到过）→ error 有文案，页面显示占位 + 稍后重试，不白屏；
 *   - stale:true（接口挂了但有旧缓存）→ stale 为真，页面标注「数据更新于 X 小时前」；
 *   - 气象字段缺失 → 规则自己降级，这里把 degraded 透出去，页面显示「数据不足」。
 */

import { computed, ref } from 'vue'
import weatherService from '@/services/weather.js'
import { get as readStore, set as writeStore, KEYS } from '@/services/storage.js'
import { getConfig, run, runBatch } from '@/core/engine.js'
import { weekdayLabel } from '@/services/policy.js'
import {
  FEEDBACK_LIMIT,
  buildWeatherInput,
  clampOffset,
  offsetDelta,
  resolveIndoorTemp,
} from './weatherInput.js'

/** 首页固定四条指数，顺序与 indices.json / 规则注册表一致 */
export const INDEX_IDS = ['drying', 'damp', 'umbrella', 'clothing']

/** 指数条上的短标签：全称（晾晒指数）在小屏上换行，条组只留两个字 */
const SHORT_LABELS = { drying: '晾晒', damp: '返潮', umbrella: '出行', clothing: '穿衣' }

/** 趋势图横轴取未来多少小时 */
const TREND_HOURS = 24
/** 7 天简表取几天 */
const DAYS_AHEAD = 7
/** 小时数小于 1 时按分钟显示，避免出现「0.3 小时前」 */
const MINUTES_PER_HOUR = 60
/** 缓存新鲜度按半小时粒度显示，够用且不啰嗦 */
const HALF_HOUR = 0.5

function shortLabel(id, config) {
  return SHORT_LABELS[id] || config?.indices?.[id]?.label || id
}

/**
 * 选城市：设置里选的优先，其次 cities.json 的默认城市。
 * 注意：createConfig() 只保留了 cities 数组，把 cities.json 顶层的 default 字段丢掉了
 * （已在交付报告里列为契约坑，这里只做降级，不去改地基文件）。
 */
function resolveCity(config, cityId) {
  const cities = config?.cities || []
  if (cities.length === 0) return null
  const wanted = cityId || config?.defaultCityId || 'shenzhen'
  return cities.find((city) => city.id === wanted) || cities.find((city) => city.id === 'shenzhen') || cities[0]
}

/** '2026-11-02T14:00' → '14:00' */
function hourLabel(time) {
  const match = /T(\d{2}:\d{2})/.exec(String(time || ''))
  if (match) return match[1]
  const loose = /(\d{2}:\d{2})/.exec(String(time || ''))
  return loose ? loose[1] : ''
}

/** '2026-11-02' → '11 月 2 日 周一' */
function dateLabelOf(dateText) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ''))
  if (!match) return ''
  const month = Number(match[2])
  const day = Number(match[3])
  const weekday = weekdayLabel(dateText)
  return `${month} 月 ${day} 日 ${weekday}`.trim()
}

function formatAge(hours) {
  if (hours === null || hours === undefined) return null
  if (hours < 1) return `${Math.max(1, Math.round(hours * MINUTES_PER_HOUR))} 分钟`
  const rounded = Math.round(hours / HALF_HOUR) * HALF_HOUR
  return `${rounded} 小时`
}

/**
 * 挑 banner：风险优先（level 越小越差）。
 * 降级结论不是「风险判断」，只是「没算出来」，所以先把降级项排到最后，
 * 全都降级时才退回「有依据的那条」，避免横幅写「规则尚未接入」。
 */
function pickBanner(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  const solid = list.filter((item) => !item.degraded)
  const withEvidence = list.filter((item) => Array.isArray(item.evidence) && item.evidence.length > 0)
  const pool = solid.length > 0 ? solid : withEvidence.length > 0 ? withEvidence : list
  return pool.reduce((worst, item) => {
    if (!worst) return item
    if (item.level !== worst.level) return item.level < worst.level ? item : worst
    return item.score < worst.score ? item : worst
  }, null)
}

/**
 * 逐小时晾晒分：直接复用 drying 规则，不在页面重写公式。
 * 这样图上的曲线与卡片上的分数一定来自同一个模型（答辩口径一致）。
 */
function buildTrend(data, config) {
  const hourly = Array.isArray(data?.hourly) ? data.hourly.slice(0, TREND_HOURS) : []
  return hourly.map((hour, index) => {
    const result = run(
      'drying',
      {
        temp: hour.temp,
        humidity: hour.humidity,
        windSpeed: hour.windSpeed,
        precipProb: hour.precipProb,
        solar: hour.solar,
      },
      config,
    )
    return {
      index,
      label: hourLabel(hour.time),
      score: result.score,
      level: result.level,
      levelLabel: result.levelLabel,
    }
  })
}

/** 当日平均气温：接口只给日最高/最低，取中值代表白天体感 */
function meanTemp(day) {
  const max = typeof day?.tempMax === 'number' ? day.tempMax : null
  const min = typeof day?.tempMin === 'number' ? day.tempMin : null
  if (max === null || min === null) return null
  return Math.round(((max + min) / 2) * 10) / 10
}

function tempText(day) {
  const max = typeof day?.tempMax === 'number' ? Math.round(day.tempMax) : null
  const min = typeof day?.tempMin === 'number' ? Math.round(day.tempMin) : null
  if (min === null && max === null) return '—'
  return `${min ?? '—'} / ${max ?? '—'}`
}

/**
 * 7 天简表：每天跑一次 drying 规则拿等级色。
 * 日级数据只有气温与降水概率（weather.js 的 daily 字段就这些），
 * 湿度/风速/日照缺失，规则会按剩余权重重新归一，因此表下要注明「粗估」。
 */
function buildDailyRows(data, config) {
  const daily = Array.isArray(data?.daily) ? data.daily : []
  const today = data?.date || ''
  let start = daily.findIndex((day) => !today || day.date >= today)
  if (start < 0) start = 0
  return daily.slice(start, start + DAYS_AHEAD).map((day) => {
    const result = run('drying', { temp: meanTemp(day), precipProb: day?.precipProb }, config)
    return {
      date: day?.date || '',
      dateLabel: String(day?.date || '').slice(5),
      weekday: weekdayLabel(day?.date),
      precipProb: typeof day?.precipProb === 'number' ? Math.round(day.precipProb) : null,
      tempText: tempText(day),
      level: result.level,
      levelLabel: result.levelLabel,
    }
  })
}

/**
 * 首页组合式函数
 * @param {object} [injectedConfig] 启动时 provide 进来的配置；缺省用引擎里注入的那份
 */
export function useOuting(injectedConfig = null) {
  const config = injectedConfig || getConfig() || null

  const loading = ref(true)
  const error = ref('')
  /** 软提示：有数据但接口失败、或本地存储不可用 */
  const warning = ref('')
  const stale = ref(false)
  const ageHours = ref(null)
  const fetchedAt = ref(null)
  const weatherData = ref(null)
  const cityName = ref('')
  const dateText = ref(weatherService.localDateString())
  /** 四条 DecisionResult，额外挂了 label / shortLabel 供页头与指数条使用 */
  const results = ref([])
  const trend = ref([])
  const dailyRows = ref([])
  const activeId = ref('')
  const feedbackOffset = ref(0)

  const banner = computed(() => pickBanner(results.value))
  const hasData = computed(() => !!weatherData.value)
  const bars = computed(() =>
    results.value.map((item) => ({
      id: item.id,
      label: shortLabel(item.id, config),
      score: item.score,
      level: item.level,
      levelLabel: item.levelLabel,
    })),
  )
  const activeResult = computed(
    () => results.value.find((item) => item.id === activeId.value) || banner.value,
  )
  /** 有降级结论时页面提示「数据不足」，不要假装结论可靠 */
  const incompleteCount = computed(() => results.value.filter((item) => item.degraded).length)

  /** 出门清单：四条结论的动作汇总去重，顺序按 drying → damp → umbrella → clothing */
  const mergedActions = computed(() => {
    const seen = new Set()
    const merged = []
    for (const result of results.value) {
      for (const action of result.actions || []) {
        const text = String(action).trim()
        if (!text || seen.has(text)) continue
        seen.add(text)
        merged.push(text)
      }
    }
    return merged
  })

  const dryingNode = computed(() => config?.indices?.drying || null)
  const bestWindow = computed(() => results.value.find((item) => item.id === 'drying')?.meta?.bestWindow || null)
  const bestWindowText = computed(() => {
    const window = bestWindow.value
    if (window) return `${window.start}—${window.end}`
    return dryingNode.value?.bestWindow?.noWindowText || '全天不建议'
  })
  const dryThreshold = computed(() => {
    const value = dryingNode.value?.bestWindow?.minScore
    return typeof value === 'number' ? value : null
  })
  const windowHours = computed(() => {
    const value = dryingNode.value?.bestWindow?.windowHours
    return typeof value === 'number' ? value : null
  })

  /** 最佳时段在横轴上的起止下标，供 ECharts markArea 高亮 */
  const bestRange = computed(() => {
    const window = bestWindow.value
    const points = trend.value
    if (!window || points.length === 0) return null
    const startIndex = points.findIndex((point) => point.label === window.start)
    if (startIndex < 0) return null
    let endIndex = points.findIndex((point, i) => i > startIndex && point.label === window.end)
    if (endIndex < 0) endIndex = Math.min(points.length - 1, startIndex + (windowHours.value || 1) - 1)
    return { startIndex, endIndex, startLabel: points[startIndex].label, endLabel: points[endIndex].label }
  })

  const freshnessText = computed(() => {
    if (!hasData.value) return error.value ? '数据未取到' : '正在取数'
    const age = formatAge(ageHours.value)
    if (stale.value) {
      return age ? `数据更新于 ${age}前，可能已过期` : '缓存数据，更新时间未知，可能已过期'
    }
    if (ageHours.value === 0) return '刚刚更新'
    if (!age) return '更新时间未知'
    return `数据更新于 ${age}前`
  })

  const dateLabel = computed(() => dateLabelOf(dateText.value))
  /** 清单勾选按天隔离，跨天自动换一份 */
  const checklistKey = computed(() => `${KEYS.CHECKLIST}:${dateText.value}`)

  /** 用当前内存里的天气重算四条结论（体感反馈后立即生效，不再取数） */
  function applyRules() {
    const data = weatherData.value
    if (!data || !config) return
    const settings = readStore(KEYS.SETTINGS, {}) || {}
    const input = buildWeatherInput(data, {
      indoorTemp: resolveIndoorTemp(settings, config),
      feedbackOffset: feedbackOffset.value,
    })
    results.value = runBatch(INDEX_IDS, input, config).map((item) => ({
      ...item,
      label: config?.indices?.[item.id]?.label || item.id,
      shortLabel: shortLabel(item.id, config),
    }))
    if (!results.value.some((item) => item.id === activeId.value)) {
      activeId.value = banner.value?.id || INDEX_IDS[0]
    }
    trend.value = buildTrend(data, config)
    dailyRows.value = buildDailyRows(data, config)
  }

  /**
   * 取数并重算
   * @param {boolean} force 是否绕过 24 小时缓存
   */
  async function load(force = false) {
    loading.value = true
    error.value = ''
    warning.value = ''

    const settings = readStore(KEYS.SETTINGS, {}) || {}
    feedbackOffset.value = clampOffset(settings.feedbackOffset)

    const city = resolveCity(config, settings.cityId)
    if (!city) {
      error.value = '城市配置缺失，暂时无法取天气数据。'
      weatherData.value = null
      results.value = []
      trend.value = []
      dailyRows.value = []
      loading.value = false
      return
    }
    cityName.value = city.name

    try {
      const response = await weatherService.get(city, { force })
      stale.value = !!response.stale
      ageHours.value = typeof response.ageHours === 'number' ? response.ageHours : null
      fetchedAt.value = response.fetchedAt || null

      if (!response.ok || !response.data) {
        weatherData.value = null
        results.value = []
        trend.value = []
        dailyRows.value = []
        error.value = response.error
          ? `天气数据暂时取不到（${response.error}）`
          : '天气数据暂时取不到，请稍后重试。'
        return
      }

      weatherData.value = response.data
      dateText.value = response.data.date || weatherService.localDateString()
      // stale 时 error 里是这次请求失败的原因，降级成软提示，不挡住整页
      if (response.error) warning.value = '气象接口暂时不可用，以下结论基于上次缓存。'
      applyRules()
    } catch (err) {
      // weather.get 内部已兜底，这里只防意外（例如时钟、存储异常）
      weatherData.value = null
      results.value = []
      error.value = `天气数据读取失败：${err?.message || err}`
    } finally {
      loading.value = false
    }
  }

  function refresh() {
    return load(true)
  }

  function selectIndex(id) {
    if (!id) return
    activeId.value = id
  }

  /**
   * 体感反馈：偏冷把校准偏移 +1℃，偏热 −1℃，累计不超过 ±5℃。
   * 记录进 FEEDBACK（最多 90 条），偏移写回 SETTINGS，然后立刻重算穿衣。
   * @param {'cold'|'hot'} sense
   */
  function submitFeedback(sense) {
    const delta = offsetDelta(sense)
    if (delta === 0) return

    const settings = readStore(KEYS.SETTINGS, {}) || {}
    const nextOffset = clampOffset((Number(settings.feedbackOffset) || 0) + delta)
    const records = (readStore(KEYS.FEEDBACK, []) || []).slice(-(FEEDBACK_LIMIT - 1))
    records.push({
      at: new Date().toISOString(),
      date: dateText.value,
      cityId: settings.cityId || '',
      sense,
      delta,
      offset: nextOffset,
    })

    const savedFeedback = writeStore(KEYS.FEEDBACK, records)
    const savedSettings = writeStore(KEYS.SETTINGS, { ...settings, feedbackOffset: nextOffset })
    feedbackOffset.value = nextOffset
    warning.value = savedFeedback && savedSettings ? '' : '本次记录不会保存（浏览器存储不可用）。'

    // 改完立即重算，穿衣建议当场按新偏移变化
    applyRules()
  }

  load(false)

  return {
    // 契约要求的返回项
    loading,
    error,
    stale,
    ageHours,
    weather: weatherData,
    indices: results,
    banner,
    refresh,
    feedbackOffset,
    // 页面额外需要的派生结构
    warning,
    fetchedAt,
    hasData,
    cityName,
    dateText,
    dateLabel,
    freshnessText,
    bars,
    activeId,
    activeResult,
    selectIndex,
    mergedActions,
    checklistKey,
    trend,
    dailyRows,
    bestWindow,
    bestWindowText,
    bestRange,
    dryThreshold,
    windowHours,
    incompleteCount,
    submitFeedback,
  }
}

export default useOuting
