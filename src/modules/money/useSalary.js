/**
 * 花钱模块 · 实习到手工资测算
 *
 * 职责边界：
 *   - 本文件负责「表单状态、校验提示、本地存档」；
 *   - 税额计算全部交给 engine.run('salary', input)，页面与组合式函数都不复制税公式，
 *     否则线上结果与回测脚本会跑两套模型，答辩时对不上；
 *   - 规则返回 degraded（内核组还没接入）时原样透出，由页面显示「该规则尚未接入」。
 *
 * 隐私：只把输入存进 localStorage（KEYS.SALARY），结果不落盘。
 */

import { nextTick, reactive, ref, watch } from 'vue'
import { run } from '@/core/engine.js'
import { get, isPersistent, remove, set, KEYS } from '@/services/storage.js'
import { blankSalaryInput, validateSalaryInput } from './validate.js'

/** 两个口径互为对比项 */
function otherMode(mode) {
  return mode === 'service' ? 'salary' : 'service'
}

export function useSalary() {
  const input = reactive(blankSalaryInput())
  const errors = reactive({})
  const result = ref(null)
  const compare = ref(null)
  /** 上一次成功测算用的入参（数字已转换），用于展示「按 X 计算」与兜底读数 */
  const used = ref(null)
  const savedAt = ref('')
  const restored = ref(false)
  /** 浏览器是否真的能把输入存下来（隐私模式下 set 返回 false） */
  const persistent = ref(isPersistent())

  // 存档里只允许出现表单已知字段，避免历史脏数据污染校验
  const stored = get(KEYS.SALARY, null)
  if (stored && typeof stored === 'object') {
    const blank = blankSalaryInput()
    for (const key of Object.keys(blank)) {
      const value = stored[key]
      if (value === undefined || value === null) continue
      if (key === 'mode' && !['service', 'salary'].includes(value)) continue
      input[key] = String(value)
    }
    restored.value = true
  }

  /** 重置时先屏蔽一次写入，否则空白表单会被 watch 立刻存回去 */
  let suppressSave = false

  function persist() {
    const ok = set(KEYS.SALARY, { ...input })
    persistent.value = ok
    if (ok) savedAt.value = new Date().toISOString()
  }

  watch(
    input,
    () => {
      if (!suppressSave) persist()
    },
    { deep: true },
  )

  function clearErrors() {
    for (const key of Object.keys(errors)) delete errors[key]
  }

  /**
   * 测算：校验 → 跑主口径 → 跑另一口径做对比
   * @returns {boolean} 是否成功产出结果
   */
  function calculate() {
    clearErrors()
    const check = validateSalaryInput(input)
    Object.assign(errors, check.errors)
    if (!check.ok) {
      result.value = null
      compare.value = null
      used.value = null
      return false
    }

    used.value = check.value
    result.value = run('salary', check.value)
    compare.value = run('salary', { ...check.value, mode: otherMode(check.value.mode) })
    return true
  }

  function reset() {
    suppressSave = true
    Object.assign(input, blankSalaryInput())
    clearErrors()
    result.value = null
    compare.value = null
    used.value = null
    savedAt.value = ''
    restored.value = false
    remove(KEYS.SALARY)
    nextTick(() => {
      suppressSave = false
    })
  }

  return {
    input,
    result,
    compare,
    errors,
    calculate,
    reset,
    savedAt,
    // 页面额外需要的状态
    used,
    restored,
    persistent,
  }
}

export default useSalary
