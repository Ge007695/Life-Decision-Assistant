# 核心契约（唯一接口标准）

> 本文件是并行开发的唯一接口依据。任何一组改动下面任一结构，**先改本文件，再改代码**
> （工作指导书 10.2：接口先定后写）。
>
> 版本：v1.0　定稿日期：2026-11-02　对应 `indices.json` v1.0.0

---

## 一、分层与纪律

```
视图层 src/views/ src/modules/**   → 组件层 / 服务层 / 内核层
组件层 src/components/             → 无依赖，纯展示
服务层 src/services/               → 无依赖（可用 fetch / localStorage）
内核层 src/core/                   → 只依赖配置层，禁止 fetch / window / document / localStorage
配置层 public/data/*.json          → 被所有人读取，谁都不写
```

**硬纪律（ESLint 已配置，`npm run lint` 会拦）**

1. `src/core/**` 内禁止出现 `fetch`、`XMLHttpRequest`、`window`、`document`、`localStorage`、`navigator`。
2. 内核层不 import 视图层、服务层、任何 UI 库。
3. 组件层不做业务判断，只把已有结构画出来。
4. 代码里不允许出现未命名的数字——阈值、权重、文案一律进 `public/data/`。

---

## 二、统一结论对象 DecisionResult

所有规则函数、所有结论卡、所有回测输出都用这一个结构。

```js
{
  id: 'drying',                    // 规则唯一标识，与 indices.json 的键一致
  version: '1.0.0',                // 规则版本，回测报告必须写清用哪一版
  level: 3,                        // 0—4 整数，0 最差、4 最佳
  levelLabel: '一般',              // 等级文案，来自配置的 levels
  score: 68.3,                     // 0—100 连续得分，用于排序与时间窗比较
  headline: '可以晾，但干得慢…',    // 一句话结论，占位符已由引擎替换
  actions: ['延长晾晒时间', '18:00 前收回'],
  evidence: [                      // 判定依据，用于解释“为什么这么判”
    { key:'humidity', label:'相对湿度', value:'60%', weight:0.3, contribution:0.18, ratio:0.6 }
  ],
  configRef: 'indices.json#drying',// 指向配置节点，便于排查
  updatedAt: '2026-11-02T09:00:00+08:00',
  degraded: false                  // 可选：数据缺失时的降级标记
}
```

- `evidence` 不是装饰：答辩被问“凭什么说今天适合晾衣服”，投出来就是答案。
- `evidence[].weight` / `contribution` 为 `null` 表示该项不参与加权（如“最佳时段”）。
- `level` 语义统一为**对用户越好分越高**。返潮预警要反向：3 条条件全中 → `level: 1`。

---

## 三、规则模块契约（`src/core/rules/<id>.js`）

每个规则文件导出：

```js
export const id = 'drying'          // 必填，与 indices.json 键一致
export const version = '1.0.0'      // 必填
export const requiresIndex = false  // 可选，默认 true；纯计算类规则（假期/工资/分期）设 false
export const configRef = 'holidays.json'  // 可选，默认 `indices.json#${id}`

/**
 * @param {object} input 规则入参
 * @param {{config: object, index: object|null, now: string}} ctx
 * @returns {{level, levelLabel, score, headline, actions, evidence, vars?, degraded?, meta?}}
 */
export function evaluate(input, ctx) { ... }
```

**返回值只填这七项，其余字段由引擎补**：`level`、`levelLabel`、`score`、`headline`、
`actions`、`evidence`、`vars`（用于 headline 里的 `{bestWindow}` 占位符）。

**禁止**：在规则里拼字符串（用 `vars` 交给引擎替换）、读写存储、调用 `fetch`、抛出异常
（引擎会兜底降级，但正常路径不应依赖兜底）。

新增规则两步：写 `rules/<id>.js` → 在 `rules/index.js` 的 `RULES` 数组加一行。

### 已有规则的入参约定

| id | input 字段 | 说明 |
|---|---|---|
| `drying` | `temp, humidity, windSpeed, precipProb, solar, hourly[]` | `hourly` 为未来逐小时，元素同 weather.js 的 hourly |
| `damp` | `temp, humidity, windDir, windSpeed, hourly[], pastMinTemp72h, indoorTemp` | 三条判定见 `indices.json#damp.thresholds` |
| `umbrella` | `precipProb, windSpeed, hourly[]` | 是否带伞、是否推迟 |
| `clothing` | `temp, humidity, windSpeed, apparentTemp?, feedbackOffset?` | 体感温度查 `clothing-table.json` |
| `holiday` | `year?, today?` | 读 `config.holidays`，无数据年份返回“待公布” |
| `salary` | `gross, mode: 'service'\|'salary', months?, specialDeduction?, dayRate?, workDays?` | 读 `config.taxRules` |
| `installment` | `principal, periods, feeRate` | 返回月利率与年化，含三算法对比 |

---

## 四、配置层结构（`public/data/`）

由地基组维护，**其他组只读，不要修改**。需要新字段请提出，由地基组统一改。

### indices.json
```js
config.indices.drying = {
  type: 'weighted',              // weighted | rule | table
  label: '晾晒指数',
  inputs: ['temp', ...],
  weights: { temp: 0.2, ... },   // 之和必须为 1（±0.01）
  normalize: { temp: [10, 32] }, // [劣端, 优端]，两端不能相等
  evidenceLabel: { temp: '气温' },
  format: { temp: '{v} ℃' },
  bestWindow: { windowHours: 2, minScore: 60, horizonHours: 24, collectBefore: '18:00' },
  levels: [{ min: 80, level: 4, label: '适宜', headline: '…{bestWindow}…' }]
}
```
`type: 'rule'` 用 `thresholds` 代替 `weights`；`type: 'table'` 只给 `tableRef`，等级来自映射表。

### holidays.json
```js
config.holidays.years['2026'] = {
  status: 'official' | 'pending' | 'partial',
  source, sourceUrl, collectedAt,
  holidays: [{ name, start, end, days }],
  makeupWorkdays: ['2026-01-04'],
  schoolTerms: [{ name, start, end }]
}
```
`status: 'pending'` 是正常状态，页面显示“待公布”，**不能报错或白屏**。

### tax-rules.json
`serviceIncome`（劳务报酬预扣）、`salaryIncome`（工资薪金累计预扣）、`annualSettlement`（年度汇算）。
各段均含 `brackets: [{ upper, rate, quickDeduction }]`，最后一档 `upper: null`。

### 其他
- `clothing-table.json`：`{ table: [{ min, max, level, label, outfit, extras[] }] }`，`min` 含、`max` 不含
- `cities.json`：`{ default, cities: [{ id, name, lat, lon, timezone }] }`
- `checklists.json`：`{ meta: { collectedAt, disclaimer }, checklists: [{ id, title, channel, timeline, materials[] }] }`

---

## 五、服务层 API（`src/services/`）

### storage.js
```js
import storage, { get, set, remove, listKeys, clearAll, isPersistent, KEYS } from '@/services/storage.js'
get(key, fallback)      // key 不带前缀，自动补 lda:
set(key, value)         // 返回 boolean：false 表示降级到内存态
KEYS = { SETTINGS, WEATHER, SALARY, CHECKLIST, FEEDBACK }
```
隐私模式下 `set` 返回 `false`，页面要提示“本次记录不会保存”。

### weather.js
```js
import weather from '@/services/weather.js'
await weather.get(city, { force? })
// → { ok, stale, ageHours, fetchedAt, data, error }
// data: { city, date, temp, humidity, windSpeed, windDir, windDeg, precipProb, solar,
//         hourly[48], hourlyAll[], daily[7], pastMinTemp72h, sunrise, sunset }
```
`stale: true` 时页面必须标注“数据更新于 X 小时前”。

### policy.js
```js
availableYears(config)        // [2026, 2027]
getYearNode(config, year)     // 不存在时返回合法的 pending 节点
buildDateMap(yearNode)        // { '2026-01-01': { type:'holiday', name:'元旦' } }
buildYearGrid(year, yearNode) // [{ month, cells: [{ day, date, type, name }] }]
nextHoliday(yearNode, today)  // 最近假期
makeupList(yearNode)          // 调休上班日
daysBetween('2026-11-02', '2027-01-01')
weekdayLabel('2026-01-01')    // '周四'
```
`type` 取值：`holiday`（红）/ `makeup`（灰）/ `weekend`（蓝）/ `workday`。

### config.js（地基组维护，其他组不要改）
`loadConfig()` 取回六份 JSON 并校验，返回 `{ config, loadErrors }`。

---

## 六、组件层 Props（`src/components/`）

| 组件 | props | emits | 说明 |
|---|---|---|---|
| `DecisionCard` | `result`(必填) `title` `showActions` `showEvidence` `feedbackable` `storageKey` `hero` | `feedback('cold'\|'hot')` | 结论 + 清单 + 依据折叠 |
| `ScoreBar` | `items[{id,label,score,level,levelLabel}]` `activeId` `selectable` | `select('id')` | 指数条组 |
| `ActionList` | `actions[]` `storageKey` `title` `dense` | `change` | 勾选状态存本地 |
| `FormField` | `label` `hint` `error` `suffix` `inline` + 默认插槽(作用域含 `id`/`error`) | — | 统一输入控件 |
| `TrendChart` | `option`(ECharts option) `height` | — | 按需引入 echarts |

引入方式统一用别名：`import DecisionCard from '@/components/DecisionCard.vue'`。

---

## 七、样式约定

全部使用 `src/styles/main.css` 里的 CSS 变量，不要写死颜色：

- 颜色：`--text` `--text-2` `--text-3` `--bg` `--surface` `--line` `--accent`
- 等级色：`--lv4`(绿) `--lv3`(蓝) `--lv2`(橙) `--lv1`(红) `--lv0`(灰)，配套 `--lvN-weak`
- 圆角：`--radius`(14) `--radius-sm`(10)；阴影：`--shadow`
- 工具类：`.page` `.stack` `.stack-sm` `.row` `.row-between` `.card` `.card-flat`
  `.card-title` `.card-sub` `.section-title` `.muted` `.faint` `.small` `.tiny` `.num`
  `.chip` `.chip-lv4..lv0` `.btn` `.btn-primary` `.btn-ghost` `.btn-sm`
  `.field` `.field-label` `.input` `.field-hint` `.field-error` `.notice` `.notice-error`
  `.grid-2` `.spacer` `.divider` `.skeleton` `.sr-only` `.lv-0..lv-4`（文字色）
- 页面外层统一 `<div class="page stack">`，最大宽度 760px，移动端优先。

---

## 八、文件边界（并行开发时不要越界）

| 组 | 可写文件 |
|---|---|
| 内核规则组 | `src/core/rules/*.js`（除 `index.js` 的导入行）、`src/core/utils/*.js`（除 `normalize.js`）、`tests/**`、`scripts/experiments/**` |
| 出门模块组 | `src/modules/outing/**`、`src/views/Home.vue` |
| 时间与办事组 | `src/modules/time/**`、`src/modules/affairs/**`、`src/views/Time.vue`、`src/views/Affairs.vue`、`src/views/Settings.vue` |
| 花钱模块组 | `src/modules/money/**`、`src/views/Money.vue` |
| 回测与文档组 | `scripts/backtest/**`、`docs/**`（除 `docs/decisions/0001-核心契约.md`） |
| 地基（已完成） | `package.json` `vite.config.js` `index.html` `eslint.config.js` `public/data/**` `src/core/config.js` `src/core/engine.js` `src/core/utils/normalize.js` `src/core/rules/index.js` `src/services/**` `src/components/**` `src/App.vue` `src/router.js` `src/main.js` `src/styles/**` |

需要改别人的文件，先说明理由，由地基组统一改。

---

## 九、验证方式

```bash
npm run m1        # M1 判据：命令行输出合法 DecisionResult
npm run test      # 单元测试（每个规则至少三条：典型值 / 边界值 / 异常值）
npm run lint      # 内核层纪律检查
npm run build     # 构建，必须零报错
npm run dev       # 本地起服务
```
