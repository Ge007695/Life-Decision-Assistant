/**
 * 办事模块 · 清单进度
 *
 * 勾选状态由 ActionList 存在本机，键名统一由这里生成，避免各处手写字符串写错。
 * 这里只做计数，不判断“该怎么办”——办理规则都在 checklists.json 里。
 */

/** 某个办事事项的勾选存档键 */
export function affairsKey(id) {
  return `checklist:affairs:${id}`
}

/**
 * 已勾选的材料数。
 * ActionList 的存档是 { '下标::文案': true }，只保留勾上的项，
 * 所以直接数值为 true 的键即可。
 */
export function countChecked(saved) {
  if (!saved || typeof saved !== 'object') return 0
  return Object.values(saved).filter(Boolean).length
}

/** 进度百分比（0—100 整数），总额为 0 时返回 0，避免除零 */
export function percentOf(done, total) {
  if (!total || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

export default { affairsKey, countChecked, percentOf }
