/**
 * 花钱模块 · 分期真实年化
 *
 * 职责边界：
 *   - 本文件负责「表单状态、校验提示、方案列表」；
 *   - 月利率 / 年化 / 三算法对比全部由 engine.run('installment', input) 返回，
 *     页面绝不自己解 IRR（重复实现会让页面数字与实验报告对不上）；
 *   - 规则返回 degraded 时原样透出：引擎兜底（version 0.0.0）是「尚未接入」，
 *     规则自己判的无解是「暂时算不出」，两种都给中文原因，不报错、不显示 NaN。
 */

import { reactive, ref } from 'vue'
import { run } from '@/core/engine.js'
import { validateInstallmentInput } from './validate.js'

/** 验收算例：6000 元 / 12 期 / 每期 0.6%，打开页面就能看到结论 */
const DEFAULT_INPUT = { principal: '6000', periods: '12', feeRate: '0.6' }

/** 方案对比最多几组：再多在手机上并排就挤了，也没必要 */
export const MAX_PLANS = 4

/**
 * 传给内核的入参。
 * 规则默认把 feeRate 当「每期百分比」（0.6 表示 0.6%），与页面输入口径一致；
 * 这里仍显式带上 feeRateUnit，规则默认值将来若改变也不会静默算错。
 */
function toRuleInput(value) {
  return {
    principal: value.principal,
    periods: value.periods,
    feeRate: value.feeRate,
    feeRateUnit: 'percent',
  }
}

export function useInstallment() {
  const input = reactive({ ...DEFAULT_INPUT })
  const errors = reactive({})
  const result = ref(null)
  /** 上一次成功计算用的入参，页面据此标注「按 X 计算」并兜底算名义成本 */
  const used = ref(null)
  /** 方案快照：每组独立存一份入参与结论，改主表单不会影响已加入的方案 */
  const plans = ref([])

  let nextPlanId = 1

  function clearErrors() {
    for (const key of Object.keys(errors)) delete errors[key]
  }

  /**
   * 计算当前输入的真实年化
   * @returns {boolean} 是否成功
   */
  function calculate() {
    clearErrors()
    const check = validateInstallmentInput(input)
    Object.assign(errors, check.errors)
    if (!check.ok) {
      result.value = null
      used.value = null
      return false
    }
    used.value = check.value
    result.value = run('installment', toRuleInput(check.value))
    return true
  }

  /**
   * 把当前输入加入方案对比（快照，不跟随主表单变化）
   * @returns {boolean} 是否加入成功
   */
  function addPlan() {
    clearErrors()
    const check = validateInstallmentInput(input)
    Object.assign(errors, check.errors)
    if (!check.ok) return false

    if (plans.value.length >= MAX_PLANS) {
      errors.plans = `最多对比 ${MAX_PLANS} 组方案，请先移除一组再加入`
      return false
    }

    const duplicate = plans.value.some(
      (plan) =>
        plan.principal === check.value.principal &&
        plan.periods === check.value.periods &&
        plan.feeRate === check.value.feeRate,
    )
    if (duplicate) {
      errors.plans = '这组方案已经在对比列表里了，改一个条件再加'
      return false
    }

    plans.value = [
      ...plans.value,
      { id: nextPlanId, ...check.value, result: run('installment', toRuleInput(check.value)) },
    ]
    nextPlanId += 1
    return true
  }

  function removePlan(id) {
    plans.value = plans.value.filter((plan) => plan.id !== id)
    delete errors.plans
  }

  return {
    input,
    result,
    plans,
    errors,
    calculate,
    addPlan,
    removePlan,
    // 页面额外需要的状态
    used,
  }
}

export default useInstallment
