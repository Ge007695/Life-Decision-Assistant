/**
 * 内核层 · 规则注册表
 *
 * 只用静态 import，不用动态扫描：构建时可摇树，回测时 Node 也能直接加载。
 * 新增规则只需两步：写 rules/<id>.js，再在下面加一行。
 */

import * as drying from './drying.js'
import * as damp from './damp.js'
import * as umbrella from './umbrella.js'
import * as clothing from './clothing.js'
import * as weeklyWear from './weeklyWear.js'
import * as sport from './sport.js'
import * as holiday from './holiday.js'
import * as salary from './salary.js'
import * as installment from './installment.js'

/** 顺序即首页指数条的默认展示顺序（首页固定四条由 useOuting 的 INDEX_IDS 决定，这里是全量注册表） */
export const RULES = [drying, damp, umbrella, clothing, weeklyWear, sport, holiday, salary, installment]

export default RULES
