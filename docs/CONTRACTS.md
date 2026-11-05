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
| `weeklyWear` | `days: [{date, tempMax, tempMin}]` | O-8。查同一张穿衣表后按档位汇总件数；`score` 表示预报覆盖度，不是好坏评分 |
| `sport` | `temp, humidity, aqi?, uv?` | O-9。四维折分再加权；`aqi`/`uv` 缺失时按剩余权重重归一并标 `degraded` |
| `holiday` | `year?, today?` | 读 `config.holidays`，无数据年份返回“待公布” |
| `salary` | `gross, mode: 'service'\|'salary', months?, specialDeduction?, dayRate?, workDays?` | 读 `config.taxRules` |
| `installment` | `principal, periods, feeRate, feeRateUnit?` | 返回月利率与年化，含三算法对比。**`feeRate` 默认按百分数理解**：`0.6` = 每期 0.6%。小数口径必须显式传 `feeRateUnit: 'decimal'`（`0.006`）。传错单位不报错、年化差 100 倍 |

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
  schoolTerms: [{ name, start, end }]      // 已废弃，统一用下面的 schoolCalendar
}

// 校历放在顶层：一个学期只维护一次，跨年学期不会在两年里各写一半
config.holidays.schoolCalendar = {
  source, sourceUrl, collectedAt, note,
  terms: [{ name, kind: 'term' | 'break', start, end }],
}
```
`status: 'pending'` 是正常状态，页面显示“待公布”，**不能报错或白屏**。
`schoolCalendar` 的 `kind` 取 `term`（学期）或 `break`（寒暑假）；缺省按 `term` 处理，
所以老数据不会因为没写 `kind` 而失效。校历日期属于**外部事实**，
只允许来自教务部公布或用户确认，不允许按往年推算——`note` 里必须写清转录来源。

### tax-rules.json
`serviceIncome`（劳务报酬预扣）、`salaryIncome`（工资薪金累计预扣）、`annualSettlement`（年度汇算）。
各段均含 `brackets: [{ upper, rate, quickDeduction }]`，最后一档 `upper: null`。

### 其他
- `clothing-table.json`：`{ table: [{ min, max, level, label, outfit, extras[] }] }`，`min` 含、`max` 不含
- `cities.json`：`{ default, cities: [{ id, name, province, lat, lon, timezone }] }`
  - 覆盖全国 370 个城市（34 个省级行政区），由 `scripts/build-cities.mjs` 生成，**不要手改**
  - `default` 是城市 id（当前为 `shenzhen`）。取默认城市必须读这个字段，
    **不能用 `cities[0]`**——列表按省份排序，第一个是「安庆」
  - `id` 为行政区划 adcode（如 `440300`），深圳/广州/珠海/汕头沿用旧的拼音 id，
    保证用户已存的 `cityId` 不失效。新增城市不得复用旧 id
- `checklists.json`：`{ meta: { collectedAt, disclaimer }, checklists: [{ id, title, channel, timeline, materials[] }] }`

---

## 五、服务层 API（`src/services/`）

### storage.js
```js
import storage, { get, set, remove, listKeys, clearAll, isPersistent, setSyncSink, KEYS } from '@/services/storage.js'
get(key, fallback)      // key 不带前缀，自动补 lda:
set(key, value, opts?)  // 返回 boolean：false 表示降级到内存态；opts.silent 不通知云同步
remove(key, opts?)
clearAll(opts?)
KEYS = { SETTINGS, WEATHER, SALARY, CHECKLIST, FEEDBACK }
```
隐私模式下 `set` 返回 `false`，页面要提示“本次记录不会保存”。

**本机仍是唯一的同步读写入口**，页面代码照旧同步调用，不要为了"上云"改成 `await`。
`setSyncSink(fn)` 只由 `cloud-sync.js` 调用一次；云同步回填本机必须传 `{ silent: true }`，
否则"拉下来又推回去"会形成无限回声。以 `__` 开头的键是内部标记，不参与同步。

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

### location.js
```js
import { locate, locationCapability, reasonFromErrorCode } from '@/services/location.js'

locationCapability()   // → { available, reason }  reason: '' | unsupported | insecure
await locate({ timeout?, maxAge? })
// → { ok, latitude, longitude, accuracy, reason, message }
//   reason: '' | unsupported | insecure | denied | unavailable | timeout
```

**永不 throw**，失败一律返回 `ok: false` + 具体 `reason`。页面必须按 `reason`
分别给提示——四种失败的下一步动作完全不同，一句"定位失败"等于没说：
`denied` 要引导去改权限、`insecure` 要明说 http 页面根本不允许、
`unavailable` 要提示系统开关、`timeout` 可以重试。

拿到坐标后**不要在本模块内做"最近的哪个城市"判断**，交给内核 `findNearestCity`：

```js
import { findNearestCity, haversineKm, describeDistance, NEARBY_KM } from '@/core/utils/geo.js'
haversineKm(lat1, lon1, lat2, lon2)      // 球面距离 km，坐标非法返回 NaN
findNearestCity(cities, lat, lon)        // → { city, distanceKm } | null
describeDistance(km)                     // → '约 N 公里内' / '约 N 公里外'
```
坐标非法或列表为空时返回 `null`，**不允许硬凑一个城市**。

### air.js（空气质量与紫外线，O-9 用）

```js
import air from '@/services/air.js'
await air.get(city, { force })  // → { ok, stale, data: { aqi, pm25, uv, observedAt }, error }
```

缓存 3 小时（比天气的 24 小时短：AQI 变化快）。`aqi` 是 **us_aqi**，分档 50/100/150/200/300，
与中国 AQI 基本对齐；**不要换成 `european_aqi`**（0—20 优），分级与用户认知不符。
失败返回 `ok:false`，不抛异常。

### climate.js（历史同期，O-11 用）

```js
import climate from '@/services/climate.js'
await climate.getSamePeriod(city, '2026-11-05', 7)
// → { ok, stale, start, end, sourceStart, sourceEnd, data: [{ date, tempMax, tempMin, precip }], error }
```

数据源是 archive-api（ERA5 再分析），缓存 7 天（历史值不再变）。
`precip` 是**降水量 mm**，与预报侧的 `precipProb`（降水概率 %）不是一回事，**不得混用**。
「去年同期」= 起始日减一年；2 月 29 日会落到 3 月 1 日（JS Date 的行为）。

### cloud.js / cloud-sync.js
```js
import { cloud, CLOUD_PUBLIC_CONFIG } from '@/services/cloud.js'   // 全应用唯一客户端
import {
  cloudState, initCloud, isSignedIn,
  requestPhoneCode, submitPhoneCode, signInWithWorkBuddy, signOutCloud,
  retrySync, pullFromCloud, maskPhone,
} from '@/services/cloud-sync.js'

await initCloud()                       // 启动时调一次：处理 OAuth 回调 → 恢复会话 → 拉云端
cloudState                              // 响应式：{ ready, user, phase, message, pendingCount, … }
await requestPhoneCode(phone)           // → { verificationId, isExistingUser }
await submitPhoneCode(phone, challenge, token)
await signInWithWorkBuddy()             // 跳授权页（同标签页）
await signOutCloud()                    // 云端保留，本机清空
await pullFromCloud()                   // 手动拉取，以云端覆盖本机
```

`endpoint` / `publishableKey` / `oauthRelayBaseUrl` 是**公开配置**，随前端产物发布；
真正的环境凭据在服务端，前端拿不到。**不要**在前端自己传 `owner_id`——由数据库
`DEFAULT auth.uid()` 填充，越权交给 RLS。

`initCloud()` 必须在 `app.mount()` 之前 await（否则首屏会闪一下"未登录"），
并且要带超时兜底：`main.js` 用 `CLOUD_BOOT_TIMEOUT_MS = 6000` 包了一层，
网络不通时最多等 6 秒就继续渲染。

数据表 `public.user_records`（每用户每键一行）。RLS 必须写 `TO authenticated`
并显式排除 `auth.uid() = 'anon'`——未登录时 `auth.uid()` 返回字符串 `'anon'` 而非 NULL，
只写 `owner_id = auth.uid()` 会让所有匿名访客共用一个数据桶。
自检：`node scripts/cloud-check.mjs`（未登录查询应 0 行、写入应被 42501 拒）。

### 模块层纯函数（`src/modules/`）
```js
import { buildCountdown, buildSchoolStatus, schoolTerms } from '@/modules/time/countdown.js'
buildSchoolStatus(config, today)   // → { state, name?, days?, lead?, detail, term?, gap? }
schoolTerms(config)                // → [{ name, kind, start, end }]，顶层优先、旧结构兜底
```
这两个函数是纯的（不读 `window`、不写存储），测试与 `verify-acceptance` 直接调用。
`state` 只取 `inTerm` / `onBreak` / `beforeTerm` / `unknown` 四种。
**不要在这里推"第几教学周"**——我们只有起止日期，周次要按教务部教学周历算，
推错比不给更糟。

**约定**：会被 `node --test` 直接 import 的模块一律用相对路径 import，不要用 `@` 别名，
否则 Node 解析不到（`@` 只在 Vite 里有效）。`countdown.js`、`tripPlan.js`、`compare.js`、
`history.js` 都是这么做的。

```js
import { buildCompare } from '@/modules/outing/compare.js'
buildCompare({ config, left: { city, weather }, right: { city, weather }, settings })
// → { left, right, metrics[], weekRows[], indices[], summary }

import { buildHistory, describe } from '@/modules/outing/history.js'
buildHistory({ forecastDaily, historyDaily, today, days })
// → { rows[], summary, status: 'ok' | 'insufficient' }
describe(summary)   // → 一句话结论，只陈述差异
```

两条硬约束：

- **compare 不判「哪个城市更好」**。好坏取决于用户要做什么（晒被子看晾晒、跑步看体感、
  避雨看降水），给总分排名等于替用户做决定。只给差异事实，箭头只表示哪边分数高。
  一边降级时 `delta` 为 `null`，**不用 0 顶替**。
- **history 的平均值只统计两边都有值的天**。各自独立求平均会在缺数据时比不同批日子，
  差值看着有数、实际没有意义。

---

## 六、组件层 Props（`src/components/`）
| 组件 | props | emits | 说明 |
|---|---|---|---|
| `DecisionCard` | `result`(必填) `title` `showActions` `showEvidence` `feedbackable` `storageKey` `hero` | `feedback('cold'\|'hot')` | 结论 + 清单 + 依据折叠 |
| `ScoreBar` | `items[{id,label,score,level,levelLabel}]` `activeId` `selectable` | `select('id')` | 指数条组 |
| `ActionList` | `actions[]` `storageKey` `title` `dense` | `change` | 勾选状态存本地 |
| `FormField` | `label` `hint` `error` `suffix` `inline` + 默认插槽(作用域含 `id`/`error`) | — | 统一输入控件 |
| `TrendChart` | `option`(ECharts option) `height` | — | 按需引入 echarts |
| `CloudAccount` | — | — | 登录态与同步状态卡片，状态全取 `cloudState`，无 props |

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

### 跨模块联动（8.2 第一条：T-5 假期出行清单）

已有实现：`src/modules/time/tripPlan.js` 在时间模块内调 `engine.run('clothing')` 与
`engine.run('umbrella')`，生成假期打包清单。

规矩只有一条：**跨模块只能读对方的 `DecisionResult`，不能 import 对方的内部函数。**
`buildWeatherInput`、`lookupOutfit`、`apparentTemperature` 这类都算内部实现，
复制一份以后内核改了这边不会跟着变，两边结论迟早对不上。

需要新的输入形状时，在本模块内做适配（如按日聚合），不要改对方的适配层。

另外两条由 T-5 实践得出的约定：

- **不能给未来 7 天以外的日子出天气建议**。接口只到这个窗口，
  超出范围必须显式说"临近再看"，不用往年气候均值顶替。
- **多天结论汇总到一份清单时，先问这个结论是"每天各自成立"还是"整天择一"**。
  衣物是前者（取并集），雨具是后者（取最坏一天）。取错会得到自相矛盾的清单。

---

## 九、验证方式

```bash
npm run m1        # M1 判据：命令行输出合法 DecisionResult
npm run test      # 单元测试（每个规则至少三条：典型值 / 边界值 / 异常值）
npm run lint      # 内核层纪律检查
npm run build     # 构建，必须零报错
npm run dev       # 本地起服务
```
