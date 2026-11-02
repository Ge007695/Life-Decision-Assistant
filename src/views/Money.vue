<script setup>
/**
 * 花钱 · 实习到手工资测算 / 分期真实年化
 *
 * 本页只做三件事：收集输入、调用 engine.run、把 DecisionResult 画出来。
 * 税公式与 IRR 全部在内核规则里，页面不重复实现——否则页面上的数字和回测报告
 * 会跑两套模型，验收时对不上。
 *
 * 规则尚未接入（degraded）时页面照常可用：表单、校验、结构都在，只把结果区
 * 换成「该规则尚未接入」的提示。
 */

import { computed, inject, ref } from 'vue'
import DecisionCard from '@/components/DecisionCard.vue'
import FormField from '@/components/FormField.vue'
import { useSalary } from '@/modules/money/useSalary.js'
import { useInstallment, MAX_PLANS } from '@/modules/money/useInstallment.js'
import { validateSalaryInput } from '@/modules/money/validate.js'
import {
  adaptInstallmentResult,
  adaptSalaryResult,
  buildCashflow,
} from '@/modules/money/adapters.js'
import { clockTime, money, percent, signedMoney } from '@/modules/money/format.js'

const config = inject('config', {})

/* ---------- 板块切换（页内，不走路由） ---------- */

const sections = [
  { id: 'salary', label: '实习工资测算' },
  { id: 'installment', label: '分期真实年化' },
]
const tab = ref('salary')

/* ---------- 板块一：工资测算 ---------- */

const {
  input: salaryInput,
  result: salaryResult,
  compare: salaryCompare,
  errors: salaryErrors,
  calculate: calculateSalary,
  reset: resetSalary,
  savedAt: salarySavedAt,
  used: salaryUsed,
  restored: salaryRestored,
  persistent: salaryPersistent,
} = useSalary()

/** 收入填写方式：有日薪/工作日存档时直接进「按日」 */
const incomeMode = ref(salaryInput.dayRate || salaryInput.workDays ? 'daily' : 'monthly')

function setIncomeMode(mode) {
  incomeMode.value = mode
  // 切到按月就把日薪字段清掉，否则校验仍会走「日薪优先」
  if (mode === 'monthly') {
    salaryInput.dayRate = ''
    salaryInput.workDays = ''
  }
}

function handleResetSalary() {
  resetSalary()
  incomeMode.value = 'monthly'
}

const modeHint = computed(() =>
  salaryInput.mode === 'service'
    ? '劳务报酬：按次预扣，适合按项目结算的实习补贴'
    : '工资薪金：累计预扣，适合签订劳动合同、由单位代扣代缴的实习工资',
)

const salaryView = computed(() => adaptSalaryResult(salaryResult.value, salaryUsed.value || {}))

/**
 * 工资薪金口径：内核按月均口径返回（累计值另存在 meta.cumulative），
 * 明细表直接展示月均，不再二次折算；只在表下说明实际预扣会逐月变化。
 */
const salaryRows = computed(() => {
  const fields = salaryView.value.fields
  if (!fields) return []
  return [
    { key: 'gross', label: '收入', value: money(fields.gross) },
    { key: 'deduction', label: '扣除额', value: money(fields.deduction) },
    { key: 'taxable', label: '应纳税所得额', value: money(fields.taxable) },
    { key: 'rate', label: '适用税率', value: percent(fields.rate) },
    { key: 'quickDeduction', label: '速算扣除数', value: money(fields.quickDeduction) },
    { key: 'tax', label: '预扣税额', value: money(fields.tax) },
    { key: 'net', label: '到手金额', value: money(fields.net), strong: true },
  ]
})

const detailNote = computed(() => {
  const used = salaryUsed.value
  if (!used) return ''
  if (used.mode === 'salary') {
    return '工资薪金按累计预扣计算，表中为月均口径；实际每月预扣额会随累计所得逐月变化。'
  }
  if (used.months > 1) {
    return '劳务报酬按次预扣，上表为单次（每月一次）结果，年度汇算时再并入综合所得。'
  }
  return '收入扣除顺序与税率档位由内核规则按 tax-rules.json 计算，本页只展示返回值。'
})

const salaryUsedSummary = computed(() => {
  const used = salaryUsed.value
  if (!used) return ''
  if (used.dayRate && used.workDays) {
    return `按日薪 ${money(used.dayRate)} × ${used.workDays} 个工作日 = ${money(used.gross)} / 月计算`
  }
  return `按月收入 ${money(used.gross)} 计算，共 ${used.months} 个月`
})

/** 两个口径并排：主结果当前口径，另一次 engine.run 的结果做对比 */
const comparison = computed(() => {
  const used = salaryUsed.value
  if (!used) return null
  const serviceRaw = used.mode === 'service' ? salaryResult.value : salaryCompare.value
  const payrollRaw = used.mode === 'salary' ? salaryResult.value : salaryCompare.value
  const fallback = { gross: used.gross }
  const service = adaptSalaryResult(serviceRaw, fallback)
  const payroll = adaptSalaryResult(payrollRaw, fallback)
  const ready = service.available && payroll.available
  return {
    current: used.mode,
    service,
    payroll,
    ready,
    diff: ready ? payroll.fields.net - service.fields.net : null,
  }
})

const comparisonNote = computed(() => {
  const item = comparison.value
  if (!item || !item.ready) return ''
  if (Math.abs(item.diff) < 0.005) return '两种口径当期到手基本相同'
  const less = item.diff > 0 ? '劳务报酬' : '工资薪金'
  return `${less}当期到手少 ${money(Math.abs(item.diff))}`
})

/** 免责声明优先取配置，配置缺字段时退回契约里写死的那句话 */
const settlementDisclaimer = computed(
  () =>
    config?.taxRules?.annualSettlement?.disclaimer ||
    '本结果为估算，实际以税务部门年度汇算为准',
)

const savedLabel = computed(() => {
  if (salarySavedAt.value) return `输入已保存 ${clockTime(salarySavedAt.value)}`
  if (salaryRestored.value) return '已恢复上次输入'
  return '输入只保存在本机'
})

/* ---------- 板块二：分期真实年化 ---------- */

const {
  input: instInput,
  result: instResult,
  plans,
  errors: instErrors,
  calculate: calculateInstallment,
  addPlan,
  removePlan,
  used: instUsed,
} = useInstallment()

const instView = computed(() => adaptInstallmentResult(instResult.value, instUsed.value || {}))

const usedSummary = computed(() => {
  const used = instUsed.value
  if (!used) return ''
  return `按本金 ${money(used.principal)} · ${used.periods} 期 · 每期费率 ${used.feeRate}% 计算`
})

const ratioNote = computed(() => {
  const view = instView.value
  if (!view.available) return ''
  const nominal = view.nominalRate
  if (!nominal) return '每期费率为 0，这笔分期没有额外成本。'
  const ratio = view.annualRate / nominal
  if (ratio < 1.05) {
    return `真实年化约为名义值的 ${ratio.toFixed(2)} 倍，两者基本一致。`
  }
  return `真实成本约为名义值的 ${ratio.toFixed(1)} 倍：手续费按初始本金计收，而本金逐期归还，实际占用资金逐月减少。`
})

const cashflow = computed(() => buildCashflow(instUsed.value || {}))

/** 现金流只展示期初 + 前 6 期，再跟一行合计，避免手机上翻很久 */
const CASHFLOW_PREVIEW = 6
const cashflowRows = computed(() => {
  const data = cashflow.value
  if (!data) return []
  const head = data.rows.slice(0, CASHFLOW_PREVIEW + 1)
  return [
    ...head,
    {
      period: 'total',
      label: `合计（共 ${data.rows.length - 1} 期）`,
      amount: data.total,
      total: true,
    },
  ]
})

const spreadText = computed(() => {
  const spread = instView.value.spread
  if (spread === null || spread === undefined) return ''
  const points = spread * 100
  if (points === 0) return '0'
  // 差值可能小到 1e-9 个百分点，四舍五入会变成 0，显示成「< 0.0001」更诚实
  if (points < 0.0001) return '< 0.0001'
  return String(Number(points.toFixed(4)))
})

const spreadLow = computed(
  () => instView.value.spread !== null && instView.value.spread * 100 < 0.01,
)

/** 「3 种算法结果差 0.0012 个百分点，符合实验要求」——差值动态算，不写死 */
const spreadNote = computed(() => {
  const spread = instView.value.spread
  if (spread === null || spread === undefined) return ''
  const methodCount = instView.value.methods.length
  const verdict = spreadLow.value
    ? '符合实验要求（< 0.01 个百分点）'
    : '超过实验要求（< 0.01 个百分点），需要复核'
  return `${methodCount} 种算法结果差 ${spreadText.value} 个百分点，${verdict}。`
})

/** 方案对比：每组跑一次规则，取真实年化并标出最低的一组 */
const planViews = computed(() => {
  const list = plans.value.map((plan) => {
    const view = adaptInstallmentResult(plan.result, plan)
    return {
      id: plan.id,
      principal: plan.principal,
      periods: plan.periods,
      feeRate: plan.feeRate,
      available: view.available,
      annualRate: view.annualRate,
    }
  })
  const rates = list.filter((item) => item.available).map((item) => item.annualRate)
  const best = rates.length > 0 ? Math.min(...rates) : null
  return list.map((item) => ({
    ...item,
    best: best !== null && item.available && item.annualRate === best,
  }))
})

/** 误差可能是 1e-12 这种量级，普通 toFixed 会显示成 0 */
function formatError(value) {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  if (num === 0) return '0'
  if (Math.abs(num) < 1e-4) return num.toExponential(2)
  return String(Number(num.toFixed(6)))
}

/**
 * 首屏就出结论，不等挂载：
 *   - 分期用默认算例跑一次，打开页面就能看到 6000 / 12 / 0.6% 的结果；
 *   - 工资若从本地恢复了输入且仍然合法，自动补算，刷新后不用再点一次。
 * 规则返回 degraded 时同样走这条路，页面显示「该规则尚未接入」。
 */
calculateInstallment()
if (salaryRestored.value && validateSalaryInput(salaryInput).ok) {
  calculateSalary()
}
</script>

<template>
  <div class="page stack">
    <header class="stack-sm">
      <h1 class="card-title">花钱</h1>
      <p class="muted small">
        实习到手工资与分期真实成本。计算全部走内核规则，本页只负责输入与展示。
      </p>
    </header>

    <nav class="tabs" aria-label="花钱板块切换">
      <button
        v-for="item in sections"
        :key="item.id"
        type="button"
        class="tab"
        :class="{ active: tab === item.id }"
        :aria-pressed="tab === item.id"
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>
    </nav>

    <!-- ==================== 板块一：实习到手工资测算 ==================== -->
    <template v-if="tab === 'salary'">
      <section class="card stack-sm form-card">
        <div class="row-between">
          <h2 class="card-title">实习到手工资测算</h2>
          <span class="chip chip-accent">预扣预缴</span>
        </div>
        <p class="card-sub">
          税率与速算扣除数来自 tax-rules.json，由内核规则查表；页面不重算税额。
        </p>

        <div class="field">
          <span class="field-label">计税口径</span>
          <div class="segment" role="group" aria-label="计税口径">
            <button
              type="button"
              :class="{ active: salaryInput.mode === 'service' }"
              :aria-pressed="salaryInput.mode === 'service'"
              @click="salaryInput.mode = 'service'"
            >
              劳务报酬
            </button>
            <button
              type="button"
              :class="{ active: salaryInput.mode === 'salary' }"
              :aria-pressed="salaryInput.mode === 'salary'"
              @click="salaryInput.mode = 'salary'"
            >
              工资薪金
            </button>
          </div>
          <p class="field-hint">{{ modeHint }}</p>
        </div>

        <div class="field">
          <span class="field-label">收入填写方式</span>
          <div class="segment" role="group" aria-label="收入填写方式">
            <button
              type="button"
              :class="{ active: incomeMode === 'monthly' }"
              :aria-pressed="incomeMode === 'monthly'"
              @click="setIncomeMode('monthly')"
            >
              按月收入
            </button>
            <button
              type="button"
              :class="{ active: incomeMode === 'daily' }"
              :aria-pressed="incomeMode === 'daily'"
              @click="setIncomeMode('daily')"
            >
              日薪 × 工作日
            </button>
          </div>
        </div>

        <FormField
          v-if="incomeMode === 'monthly'"
          label="月收入"
          suffix="元"
          :error="salaryErrors.gross"
          hint="税前金额，0 到 100 万之间"
        >
          <template #default="{ id }">
            <input
              :id="id"
              v-model="salaryInput.gross"
              class="input"
              type="number"
              inputmode="decimal"
              min="0"
              step="100"
              placeholder="例如 6000"
            />
          </template>
        </FormField>

        <div v-else class="grid-2">
          <FormField label="日薪" suffix="元" :error="salaryErrors.dayRate" hint="按天结算的实习报酬">
            <template #default="{ id }">
              <input
                :id="id"
                v-model="salaryInput.dayRate"
                class="input"
                type="number"
                inputmode="decimal"
                min="0"
                step="10"
                placeholder="例如 200"
              />
            </template>
          </FormField>
          <FormField
            label="每月工作日"
            suffix="天"
            :error="salaryErrors.workDays"
            hint="1—31 天"
          >
            <template #default="{ id }">
              <input
                :id="id"
                v-model="salaryInput.workDays"
                class="input"
                type="number"
                inputmode="numeric"
                min="1"
                max="31"
                step="1"
                placeholder="例如 22"
              />
            </template>
          </FormField>
        </div>

        <div class="grid-2">
          <FormField label="实习月数" suffix="个月" :error="salaryErrors.months" hint="1—12 个月">
            <template #default="{ id }">
              <input
                :id="id"
                v-model="salaryInput.months"
                class="input"
                type="number"
                inputmode="numeric"
                min="1"
                max="12"
                step="1"
                placeholder="1"
              />
            </template>
          </FormField>
          <FormField
            label="专项附加扣除"
            suffix="元"
            :error="salaryErrors.specialDeduction"
            hint="按月合计，没有就填 0"
          >
            <template #default="{ id }">
              <input
                :id="id"
                v-model="salaryInput.specialDeduction"
                class="input"
                type="number"
                inputmode="decimal"
                min="0"
                step="100"
                placeholder="0"
              />
            </template>
          </FormField>
        </div>

        <div class="row">
          <button type="button" class="btn btn-primary" @click="calculateSalary()">开始测算</button>
          <button type="button" class="btn btn-ghost" @click="handleResetSalary()">重置</button>
          <span class="spacer" />
          <span class="tiny faint">{{ savedLabel }}</span>
        </div>

        <p v-if="!salaryPersistent" class="notice">
          浏览器未允许本地存储，本次输入不会保存，刷新后需要重新填写。
        </p>
      </section>

      <div v-if="!salaryResult" class="card-flat stack-sm">
        <p class="card-title">还没有测算结果</p>
        <p class="card-sub">
          填好收入、实习月数和专项附加扣除，点「开始测算」。结果会给出到手金额、逐项扣除明细，
          以及劳务报酬与工资薪金两种口径的当期到手对比。
        </p>
        <p class="tiny faint">输入只保存在本机浏览器，不上传、不记录结果。</p>
      </div>

      <template v-else>
        <DecisionCard
          v-if="salaryView.available"
          :result="salaryResult"
          title="测算结论"
          hero
          :show-actions="true"
          :show-evidence="true"
        />

        <div v-if="salaryView.degraded" class="notice">
          <strong>{{ salaryView.notWired ? '该规则尚未接入' : '暂时算不出结果' }}</strong>
          <p v-if="salaryView.notWired">
            {{ salaryView.reason }}。页面已按契约预留结果区，内核规则接入后这里会自动显示明细。
          </p>
          <p v-else>{{ salaryView.reason }}。请检查输入或配置后重试。</p>
        </div>

        <div v-else-if="!salaryView.available" class="notice notice-error">
          <strong>结果不完整</strong>
          <p>{{ salaryView.reason }}</p>
        </div>

        <template v-else>
          <section class="card stack-sm">
            <div class="payout">
              <span class="tiny faint">到手金额</span>
              <p class="payout-value num">{{ money(salaryView.fields.net) }}</p>
              <span class="tiny faint">{{ salaryUsedSummary }}</span>
            </div>

            <div class="detail">
              <div
                v-for="row in salaryRows"
                :key="row.key"
                class="detail-row"
                :class="{ strong: row.strong }"
              >
                <span class="detail-label">{{ row.label }}</span>
                <span class="detail-value num">{{ row.value }}</span>
              </div>
            </div>
            <p class="tiny faint">{{ detailNote }}</p>
          </section>

          <section v-if="comparison" class="card stack-sm">
            <h2 class="card-title">计税口径对比</h2>
            <div class="compare-grid">
              <div
                class="compare-cell"
                :class="{ current: comparison.current === 'service' }"
              >
                <span class="compare-name">
                  劳务报酬
                  <span v-if="comparison.current === 'service'" class="chip chip-accent">当前</span>
                </span>
                <span class="compare-value num">
                  {{ comparison.service.available ? money(comparison.service.fields.net) : '—' }}
                </span>
                <span class="tiny faint">当期到手</span>
              </div>
              <div class="compare-cell" :class="{ current: comparison.current === 'salary' }">
                <span class="compare-name">
                  工资薪金
                  <span v-if="comparison.current === 'salary'" class="chip chip-accent">当前</span>
                </span>
                <span class="compare-value num">
                  {{ comparison.payroll.available ? money(comparison.payroll.fields.net) : '—' }}
                </span>
                <span class="tiny faint">当期到手</span>
              </div>
            </div>

            <p v-if="comparison.ready" class="small">口径差额：{{ comparisonNote }}。</p>
            <p v-else class="notice notice-error">
              另一口径的结果暂不可用，无法比较。
            </p>

            <p class="tiny faint">
              劳务报酬按次预扣预缴，预扣率按单次收入查表且不享受每月基本减除费用，
              所以实习期当期到手通常少于工资薪金；年度汇算按综合所得合并计算，可能多退少补。
            </p>
          </section>

          <div class="notice">
            <strong>年度汇算提示</strong>
            <p>
              {{ settlementDisclaimer }}。年度汇算时综合所得合并计算，多退少补；
              本页不预测汇算结果，也不能作为申报依据。
            </p>
          </div>
        </template>
      </template>
    </template>

    <!-- ==================== 板块二：分期真实年化 ==================== -->
    <template v-else>
      <section class="card stack-sm form-card">
        <div class="row-between">
          <h2 class="card-title">分期真实年化</h2>
          <span class="chip chip-accent">IRR</span>
        </div>
        <p class="card-sub">
          等额本金 + 固定费率的手续费，按现金流求内部收益率，再折算为年化。默认是验收算例。
        </p>

        <div class="grid-2">
          <FormField label="本金" suffix="元" :error="instErrors.principal" hint="0 到 100 万">
            <template #default="{ id }">
              <input
                :id="id"
                v-model="instInput.principal"
                class="input"
                type="number"
                inputmode="decimal"
                min="0"
                step="100"
                placeholder="6000"
              />
            </template>
          </FormField>
          <FormField label="期数" suffix="期" :error="instErrors.periods" hint="1—60 期">
            <template #default="{ id }">
              <input
                :id="id"
                v-model="instInput.periods"
                class="input"
                type="number"
                inputmode="numeric"
                min="1"
                max="60"
                step="1"
                placeholder="12"
              />
            </template>
          </FormField>
        </div>

        <FormField
          label="每期费率"
          suffix="%"
          :error="instErrors.feeRate"
          hint="填 0.6 表示每期 0.6%，范围 0—10"
        >
          <template #default="{ id }">
            <input
              :id="id"
              v-model="instInput.feeRate"
              class="input"
              type="number"
              inputmode="decimal"
              min="0"
              max="10"
              step="0.1"
              placeholder="0.6"
            />
          </template>
        </FormField>

        <div class="row">
          <button type="button" class="btn btn-primary" @click="calculateInstallment()">
            计算真实年化
          </button>
          <button type="button" class="btn" @click="addPlan()">加入方案对比</button>
        </div>
      </section>

      <div v-if="!instResult" class="card-flat stack-sm">
        <p class="card-title">还没有计算结果</p>
        <p class="card-sub">填好本金、期数和每期费率后点「计算真实年化」，这里会给出真实年化与现金流。</p>
      </div>

      <template v-else>
        <div v-if="instView.degraded" class="notice">
          <strong>{{ instView.notWired ? '该规则尚未接入' : '暂时算不出结果' }}</strong>
          <p v-if="instView.notWired">
            {{ instView.reason }}。默认算例已预填，内核规则接入后打开页面即可看到结论。
          </p>
          <p v-else>{{ instView.reason }}。请调整本金、期数或费率后重试。</p>
        </div>

        <div v-else-if="!instView.available" class="notice notice-error">
          <strong>无法计算真实年化</strong>
          <p>{{ instView.reason }}</p>
        </div>

        <template v-else>
          <section class="card stack">
            <div class="rate-hero">
              <div>
                <p class="tiny faint">真实年化（含手续费）</p>
                <p class="rate-big num">{{ percent(instView.annualRate) }}</p>
              </div>
              <div class="rate-side">
                <p class="tiny faint">名义年化 每期费率 × 12</p>
                <p class="rate-small num">{{ percent(instView.nominalRate) }}</p>
              </div>
            </div>
            <p class="card-sub">{{ ratioNote }}</p>
            <p class="tiny faint">{{ usedSummary }}</p>
          </section>

          <section class="card stack-sm">
            <div class="row-between">
              <h2 class="card-title">三种算法交叉验证</h2>
              <span v-if="instView.spread !== null" class="chip" :class="spreadLow ? 'chip-lv4' : 'chip-lv2'">
                {{ spreadLow ? '结果一致' : '存在偏差' }}
              </span>
            </div>

            <div v-if="instView.methods.length" class="mini-table">
              <div class="mini-row mini-head">
                <span>算法</span>
                <span>迭代次数</span>
                <span>误差</span>
              </div>
              <div
                v-for="(method, index) in instView.methods"
                :key="`${method.method}-${index}`"
                class="mini-row"
              >
                <span>{{ method.method }}</span>
                <span class="num">{{ method.iterations === null ? '—' : method.iterations }}</span>
                <span class="num">{{ formatError(method.error) }}</span>
              </div>
            </div>
            <p v-else class="small faint">规则未返回分算法数据，无法交叉验证。</p>

            <p v-if="spreadNote" class="tiny faint">{{ spreadNote }}</p>
          </section>

          <section class="card stack-sm">
            <h2 class="card-title">现金流明细</h2>
            <p class="tiny faint">
              期初拿到本金，此后每期支出「本金 / 期数 + 本金 × 每期费率」，展示前
              {{ CASHFLOW_PREVIEW }} 期与合计。
            </p>
            <div v-if="cashflowRows.length" class="cashflow">
              <div
                v-for="row in cashflowRows"
                :key="row.period"
                class="cf-row"
                :class="{ total: row.total }"
              >
                <span class="cf-label">{{ row.label }}</span>
                <span class="cf-value num" :class="row.amount >= 0 ? 'cf-in' : 'cf-out'">
                  {{ signedMoney(row.amount) }}
                </span>
              </div>
            </div>
            <p v-else class="small faint">当前输入无法构造现金流。</p>
          </section>
        </template>
      </template>

      <section class="card stack-sm">
        <div class="row-between">
          <h2 class="card-title">方案对比</h2>
          <span class="tiny faint">{{ plans.length }} / {{ MAX_PLANS }} 组</span>
        </div>

        <p v-if="plans.length === 0" class="card-sub">
          调好本金、期数、费率后点「加入方案对比」，最多 {{ MAX_PLANS }} 组，按真实年化并排比较。
        </p>

        <div v-else class="plan-list">
          <div v-for="(plan, index) in planViews" :key="plan.id" class="plan-row">
            <div class="plan-main">
              <span class="plan-title">
                方案 {{ index + 1 }}
                <span v-if="plan.best" class="chip chip-lv4">最低</span>
              </span>
              <span class="tiny faint">
                {{ money(plan.principal) }} · {{ plan.periods }} 期 · 每期 {{ plan.feeRate }}%
              </span>
            </div>
            <span class="plan-rate num" :class="{ 'lv-4': plan.best }">
              {{ plan.available ? percent(plan.annualRate) : '—' }}
            </span>
            <button type="button" class="btn btn-ghost btn-sm" @click="removePlan(plan.id)">
              移除
            </button>
          </div>
        </div>

        <p v-if="instErrors.plans" class="field-error">{{ instErrors.plans }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
/* ---------- 板块切换 ---------- */

.tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
}

.tab {
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-2);
  text-align: center;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}

.tab.active {
  background: var(--text);
  color: var(--surface);
}

/* ---------- 分段控件 ---------- */

.segment {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 4px;
  padding: 3px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.segment button {
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-2);
  text-align: center;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}

.segment button.active {
  background: var(--surface);
  border-color: var(--line);
  color: var(--text);
  font-weight: 600;
}

/* 带后缀的输入框右侧留位，避免金额被「元」压住 */
.form-card :deep(.control input) {
  padding-right: 44px;
}

/* ---------- 到手金额 ---------- */

.payout {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--line);
}

.payout-value {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

/* ---------- 明细（两列网格，不横滚） ---------- */

.detail {
  display: flex;
  flex-direction: column;
}

.detail-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 14px;
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-row.strong {
  font-size: 15px;
  font-weight: 650;
}

.detail-label {
  color: var(--text-2);
  min-width: 0;
}

.detail-value {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---------- 口径对比 ---------- */

.compare-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.compare-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.compare-cell.current {
  background: var(--accent-weak);
  border-color: var(--accent);
}

.compare-name {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text-2);
}

.compare-value {
  font-size: 18px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---------- 年化大字 ---------- */

.rate-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.rate-big {
  font-size: 40px;
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.015em;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.rate-side {
  text-align: right;
}

.rate-small {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}

/* ---------- 三算法小表 ---------- */

.mini-table {
  display: flex;
  flex-direction: column;
}

.mini-row {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr 1fr;
  gap: 8px;
  padding: 7px 0;
  font-size: 13px;
  border-bottom: 1px dashed var(--line);
}

.mini-row:last-child {
  border-bottom: none;
}

.mini-head {
  font-size: 12px;
  color: var(--text-3);
}

.mini-row span:nth-child(2),
.mini-row span:nth-child(3) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ---------- 现金流 ---------- */

.cashflow {
  display: flex;
  flex-direction: column;
}

.cf-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 12px;
  padding: 6px 0;
  font-size: 13.5px;
  border-bottom: 1px dashed var(--line);
}

.cf-row.total {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  border-bottom: none;
  font-weight: 650;
}

.cf-label {
  color: var(--text-2);
  min-width: 0;
}

.cf-value {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.cf-in {
  color: var(--lv4);
}

.cf-out {
  color: var(--text);
}

/* ---------- 方案对比 ---------- */

.plan-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plan-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.plan-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.plan-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 600;
}

.plan-rate {
  font-size: 17px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@media (max-width: 420px) {
  .payout-value {
    font-size: 30px;
  }

  .rate-big {
    font-size: 34px;
  }

  .plan-row {
    flex-wrap: wrap;
  }
}
</style>
