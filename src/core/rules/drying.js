/**
 * 内核层 · 晾晒指数（P0）
 *
 * 输入：当前温湿度、风速、降水概率、日照；可选逐小时序列用于时间窗推荐。
 * 输出：0—100 分、等级、一句话结论、可执行动作、逐项依据。
 *
 * 算法：五项指标按 [劣端, 优端] 归一化后加权求和（见 utils/normalize.js）。
 * 时间窗：未来 24 小时逐小时，取 2 小时滑动窗口平均分最高者；
 *         最高分低于 minScore 时返回“全天不建议”，不硬给时间。
 */

import { weightedScore, pickLevel, round } from '../utils/normalize.js'

export const id = 'drying'
export const version = '1.0.0'

const HOUR_RE = /(\d{2}):(\d{2})/

function hourOf(time) {
  const match = HOUR_RE.exec(String(time || ''))
  return match ? Number(match[1]) : null
}

function labelOf(time) {
  const match = HOUR_RE.exec(String(time || ''))
  return match ? `${match[1]}:${match[2]}` : String(time || '')
}

/** 把一条小时记录折算成晾晒分 */
function scoreHour(hour, indexNode) {
  const { score } = weightedScore(
    {
      temp: hour.temp,
      humidity: hour.humidity,
      windSpeed: hour.windSpeed,
      precipProb: hour.precipProb,
      solar: hour.solar,
    },
    indexNode,
  )
  return score
}

/**
 * 最佳晾晒时间窗
 * @param {Array} hourly 逐小时数据，按时间升序
 * @param {object} indexNode indices.json#drying
 * @returns {{start: string, end: string, score: number} | null}
 */
export function bestWindow(hourly, indexNode) {
  const config = indexNode?.bestWindow
  if (!config || !Array.isArray(hourly) || hourly.length === 0) return null

  const size = Math.max(1, config.windowHours || 2)
  const horizon = Math.min(hourly.length, config.horizonHours || 24)
  const slice = hourly.slice(0, horizon)
  if (slice.length < size) return null

  let best = null
  for (let i = 0; i + size <= slice.length; i += 1) {
    const windowHours = slice.slice(i, i + size)
    const scores = windowHours.map((hour) => scoreHour(hour, indexNode))
    const avg = scores.reduce((acc, value) => acc + value, 0) / scores.length
    if (!best || avg > best.score) {
      const startHour = hourOf(windowHours[0].time)
      const endHour = hourOf(windowHours[windowHours.length - 1].time)
      // 结束时间取窗口最后一小时的下一小时整点，读起来才是“到几点”
      const endLabel = endHour === null ? '' : `${String((endHour + 1) % 24).padStart(2, '0')}:00`
      best = {
        start: labelOf(windowHours[0].time),
        end: endLabel,
        startHour,
        endHour,
        score: round(avg, 1),
      }
    }
  }

  if (!best) return null
  if (best.score < (config.minScore ?? 60)) return null
  return best
}

/** 由等级生成动作清单 */
function actionsFor(level, window, config) {
  const collectBefore = config?.bestWindow?.collectBefore || '18:00'
  if (level >= 4) {
    const slot = window ? `在 ${window.start}—${window.end} 晾出` : '趁天晴尽早晾出'
    return [slot, `${collectBefore} 前收回`]
  }
  if (level === 3) {
    return ['延长晾晒时间，优先晾薄衣物', `${collectBefore} 前收回，未干转室内`]
  }
  if (level === 2) {
    return ['改为室内除湿或使用烘干机', '关闭朝南窗户，减少水汽进入']
  }
  return ['改用烘干或推迟到下一次晴天', '已晾衣物先收回，避免返潮']
}

/**
 * @param {object} input 见 indices.json#drying.inputs，可附 hourly 逐小时序列
 * @param {object} ctx { config, index }
 */
export function evaluate(input = {}, ctx = {}) {
  const indexNode = ctx.index
  const { score, evidence, missing } = weightedScore(input, indexNode)
  const levelHit = pickLevel(score, indexNode.levels)

  const hasHourly = Array.isArray(input.hourly) && input.hourly.length > 0
  const window = hasHourly ? bestWindow(input.hourly, indexNode) : null
  const noWindowText = indexNode.bestWindow?.noWindowText || '全天不建议'

  const vars = { bestWindow: window ? `${window.start}—${window.end}` : noWindowText }

  // 时间窗本身也是一条依据：答辩时要能说清“为什么推荐这个时段”
  if (hasHourly) {
    evidence.unshift({
      key: 'bestWindow',
      label: '最佳时段',
      value: window ? `${window.start}—${window.end}（均分 ${window.score}）` : noWindowText,
      weight: null,
      contribution: null,
      ratio: null,
    })
  }

  return {
    level: levelHit.level,
    levelLabel: levelHit.label,
    score,
    headline: levelHit.headline,
    actions: actionsFor(levelHit.level, window, indexNode),
    evidence,
    vars,
    ...(missing.length > 0 ? { degraded: true } : {}),
    meta: {
      bestWindow: window,
      missing,
      configVersion: indexNode.version || null,
    },
  }
}
