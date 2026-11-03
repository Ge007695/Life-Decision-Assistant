/**
 * 测试入口聚合
 *
 * 为什么需要这个文件：`npm test` 的脚本是 `node --test tests/`。
 * 部分 Node 22 版本在 Windows 上把目录参数当成单个文件去解析（而不是递归发现
 * `*.test.js`），于是会报 Cannot find module '.../tests'。
 * 这个入口让目录解析能落到一个真实文件上，再用 import 把各测试文件拉起来。
 * 文件名刻意不叫 `*.test.js`：在不支持目录参数的版本里它只会被排除，
 * 支持递归发现的版本也不会重复加载它。
 *
 * 维护提醒：**新增 tests/*.test.js 后必须在这里补一行 import**，
 * 否则 `npm test` 的计数不会包含它——测试跑绿了但新用例根本没执行，
 * 这种「假绿」比测试失败更难发现。
 */

import './dewpoint.test.js'
import './apparent-temp.test.js'
import './irr.test.js'
import './drying.test.js'
import './damp.test.js'
import './umbrella.test.js'
import './clothing.test.js'
import './holiday.test.js'
import './salary.test.js'
import './installment.test.js'
import './tripPlan.test.js'
