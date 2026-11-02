<script setup>
/**
 * 设置页 · 城市 / 室内温度 / 体感偏移 / 本地数据 / 配置来源
 *
 * 设置只写 KEYS.SETTINGS 一个键，存 { cityId, indoorTemp, feedbackOffset }。
 * 阈值与文案尽量从配置取，页面上不出现“凭印象写的数字”。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import FormField from '@/components/FormField.vue'
import storage, { get, set, KEYS } from '@/services/storage.js'

const config = inject('config', {})

/* ---------- 取值来源 ---------- */

const damp = computed(() => config.indices?.damp?.thresholds || {})
const lookbackHours = computed(() => damp.value.indoorTempLookbackHours || 72)
const indoorDefault = computed(() => damp.value.indoorTempDefault ?? 22)

/** 城市列表：createConfig 只保留 cities 数组（丢弃了 cities.json 的 default 字段），默认取列表首个 */
const cities = computed(() => config.cities || [])
const defaultCityId = computed(() => cities.value[0]?.id || '')
const defaultCityName = computed(() => cities.value[0]?.name || '—')
const cityHint = computed(() => `用于天气取数与穿衣、晾晒结论；默认${defaultCityName.value}`)

/* ---------- 输入范围（界面约束，不是业务阈值） ---------- */

const INDOOR_MIN = 5
const INDOOR_MAX = 40
const OFFSET_MIN = -5
const OFFSET_MAX = 5
const OFFSET_STEP = 0.5
/** 示例气温：仅用于演示偏移对穿衣建议的影响 */
const SAMPLE_TEMP = 22

const saved = get(KEYS.SETTINGS, {}) || {}

/** 存过的城市如果已从配置里移除，回落到默认城市，避免下拉框空白 */
const savedCityId = cities.value.some((city) => city.id === saved.cityId) ? saved.cityId : defaultCityId.value

const cityId = ref(savedCityId)
const indoorTemp = ref(saved.indoorTemp ?? indoorDefault.value)
const feedbackOffset = ref(saved.feedbackOffset ?? 0)

const tempError = computed(() => {
  const value = indoorTemp.value
  if (value === '' || value === null) return '请填写室内温度'
  const num = Number(value)
  if (!Number.isFinite(num)) return '请输入数字'
  if (num < INDOOR_MIN || num > INDOOR_MAX) return `请在 ${INDOOR_MIN}—${INDOOR_MAX} ℃ 之间填写`
  return ''
})

const offsetError = computed(() => {
  const num = Number(feedbackOffset.value)
  if (!Number.isFinite(num)) return '请输入数字'
  if (num < OFFSET_MIN || num > OFFSET_MAX) return `请在 ${OFFSET_MIN}—+${OFFSET_MAX} ℃ 之间调整`
  return ''
})

/* ---------- 体感偏移的效果预览 ---------- */

const offsetLabel = computed(() => {
  const num = Number(feedbackOffset.value) || 0
  if (num === 0) return '不偏移'
  return `${num > 0 ? '+' : ''}${num} ℃`
})

/** 查穿衣表：min 含、max 不含（与 clothing-table.json 约定一致） */
function rowFor(temp) {
  return (config.clothingTable || []).find((row) => temp >= row.min && temp < row.max) || null
}

const preview = computed(() => {
  const offset = Number(feedbackOffset.value) || 0
  const felt = SAMPLE_TEMP + offset
  const base = rowFor(SAMPLE_TEMP)
  const shifted = rowFor(felt)

  if (!shifted) {
    return {
      text: `示例气温 ${SAMPLE_TEMP} ℃，偏移后按 ${felt} ℃ 查表，表内没有覆盖该温度，建议以实际体感为准。`,
      sub: '',
    }
  }

  const same = base && base.label === shifted.label
  return {
    text: `示例气温 ${SAMPLE_TEMP} ℃，偏移后按 ${felt} ℃ 查表 →「${shifted.label}：${shifted.outfit}」。`,
    sub: !base
      ? ''
      : same
        ? `与不偏移时的「${base.label}」同档，穿衣建议不变。`
        : `不偏移时为「${base.label}：${base.outfit}」，偏移后换了档位。`,
  }
})

/* ---------- 保存 ---------- */

const saveState = ref('') // '' | 'saved' | 'memory'
let timer = null

function save() {
  if (tempError.value || offsetError.value) return
  const ok = set(KEYS.SETTINGS, {
    cityId: cityId.value,
    indoorTemp: Number(indoorTemp.value),
    feedbackOffset: Number(feedbackOffset.value),
  })
  saveState.value = ok ? 'saved' : 'memory'
  keys.value = storage.listKeys()
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    saveState.value = ''
  }, 2400)
}

/* ---------- 本地数据 ---------- */

const persistent = ref(storage.isPersistent())
const keys = ref(storage.listKeys())
const confirming = ref(false)
const clearState = ref('')

function askClear() {
  confirming.value = true
}

function cancelClear() {
  confirming.value = false
}

function doClear() {
  storage.clearAll()
  keys.value = storage.listKeys()
  persistent.value = storage.isPersistent()
  confirming.value = false
  cityId.value = defaultCityId.value
  indoorTemp.value = indoorDefault.value
  feedbackOffset.value = 0
  clearState.value = '已清除本应用全部本地数据，页面上的设置已恢复默认，需要时请重新保存。'
}

/* ---------- 配置版本与来源 ---------- */

const versions = computed(() => config.versions || {})
const indicesUpdated = computed(() => config.indicesMeta?.updated || '—')
const holidaysUpdated = computed(() => config.holidays?.meta?.updated || '—')
const taxSource = computed(() => config.taxRules?.meta?.source || '—')
const holidaysSource = computed(() => config.holidays?.meta?.source || '')
const checklistsMeta = computed(() => config.checklistsMeta || {})

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="page stack">
    <header class="stack-sm">
      <h1 class="card-title">设置</h1>
      <p class="faint tiny">设置只保存在本机浏览器，不上传、不关联账号。</p>
    </header>

    <!-- 城市 -->
    <section class="card stack-sm">
      <h2 class="section-title section-flush">常用城市</h2>
      <FormField label="城市" :hint="cityHint">
        <template #default="{ id }">
          <select :id="id" v-model="cityId">
            <option v-for="city in cities" :key="city.id" :value="city.id">
              {{ city.name }}（{{ city.province }}）
            </option>
          </select>
        </template>
      </FormField>
      <p v-if="!cities.length" class="field-error">城市配置未加载，请检查 cities.json。</p>
    </section>

    <!-- 室内温度与体感偏移 -->
    <section class="card stack-sm">
      <h2 class="section-title section-flush">体感校准</h2>

      <FormField
        label="室内温度"
        suffix="℃"
        :error="tempError"
        :hint="`用于返潮判定，室内表面温度无实测时，用过去 ${lookbackHours} 小时最低气温近似`"
      >
        <template #default="{ id }">
          <input
            :id="id"
            v-model="indoorTemp"
            type="number"
            inputmode="decimal"
            :min="INDOOR_MIN"
            :max="INDOOR_MAX"
            step="1"
            :aria-invalid="!!tempError"
          />
        </template>
      </FormField>

      <div class="field">
        <label class="field-label" for="setting-offset">体感偏移</label>
        <div class="offset-row">
          <input
            id="setting-offset"
            v-model="feedbackOffset"
            type="range"
            :min="OFFSET_MIN"
            :max="OFFSET_MAX"
            :step="OFFSET_STEP"
            aria-describedby="setting-offset-hint"
          />
          <span class="chip chip-accent num">{{ offsetLabel }}</span>
        </div>
        <p v-if="offsetError" class="field-error">{{ offsetError }}</p>
        <p v-else id="setting-offset-hint" class="field-hint">
          总觉得自己比别人怕冷怕热时可以调整，正值表示按更热来查穿衣建议
        </p>
      </div>

      <div class="preview">
        <p class="small">{{ preview.text }}</p>
        <p v-if="preview.sub" class="faint tiny">{{ preview.sub }}</p>
      </div>

      <div class="row">
        <button type="button" class="btn btn-primary btn-sm" :disabled="!!tempError || !!offsetError" @click="save">
          保存设置
        </button>
        <span v-if="saveState === 'saved'" class="chip chip-lv4" role="status">已保存</span>
        <span v-else-if="saveState === 'memory'" class="chip chip-lv2" role="status">
          已应用，但当前为隐私模式，本次不会保存
        </span>
        <span class="spacer" />
        <span class="faint tiny">写入键：{{ KEYS.SETTINGS }}</span>
      </div>
    </section>

    <!-- 偏差说明：答辩会被问到的诚实边界 -->
    <section class="card stack-sm">
      <h2 class="section-title section-flush">偏差说明</h2>
      <p class="muted small">{{ damp.indoorTempSource || '室内温度采用近似值，未实测。' }}</p>
      <p class="faint tiny">
        因此返潮判定只能说明「趋势」，不能替代湿度计与墙面实测；判定阈值写在
        <code>indices.json#damp.thresholds</code>，本页不改阈值，只提供输入。
      </p>
    </section>

    <!-- 本地数据 -->
    <section class="card stack-sm">
      <div class="row-between">
        <h2 class="section-title section-flush">本地数据</h2>
        <span class="chip" :class="persistent ? 'chip-lv4' : 'chip-lv2'">
          {{ persistent ? '可持久保存' : '隐私模式' }}
        </span>
      </div>

      <p v-if="!persistent" class="notice notice-error">
        当前为隐私模式，本次记录不会保存：刷新页面后勾选与设置会丢失。
      </p>

      <p class="small muted">
        所有键都带 <code>lda:</code> 前缀，清除只影响本应用，不动同域其他站点数据。
      </p>

      <ul v-if="keys.length" class="key-list">
        <li v-for="key in keys" :key="key" class="key-item mono tiny">lda:{{ key }}</li>
      </ul>
      <p v-else class="faint tiny">暂无本地记录。</p>

      <div class="divider" />

      <div v-if="!confirming" class="row">
        <button type="button" class="btn btn-sm" @click="askClear">清除本应用全部本地数据</button>
        <span class="faint tiny">共 {{ keys.length }} 个键</span>
      </div>
      <div v-else class="confirm stack-sm">
        <p class="small">
          确认清除这 {{ keys.length }} 个键吗？设置、勾选进度与天气缓存都会被删除，且无法恢复。
        </p>
        <div class="row">
          <button type="button" class="btn btn-sm confirm-btn" @click="doClear">确认清除</button>
          <button type="button" class="btn btn-sm" @click="cancelClear">取消</button>
        </div>
      </div>

      <p v-if="clearState" class="faint tiny" role="status">{{ clearState }}</p>
    </section>

    <!-- 配置版本与来源 -->
    <section class="card stack-sm">
      <h2 class="section-title section-flush">配置版本与来源</h2>
      <dl class="ver-list">
        <div class="ver">
          <dt>指数配置</dt>
          <dd class="num">v{{ versions.indices || '—' }} · 更新于 {{ indicesUpdated }}</dd>
        </div>
        <div class="ver">
          <dt>假期政策</dt>
          <dd class="num">v{{ versions.holidays || '—' }} · 更新于 {{ holidaysUpdated }}</dd>
        </div>
        <div class="ver">
          <dt>税率</dt>
          <dd class="num">v{{ versions.taxRules || '—' }}</dd>
        </div>
        <div class="ver">
          <dt>穿衣表</dt>
          <dd class="num">v{{ versions.clothingTable || '—' }}</dd>
        </div>
        <div class="ver">
          <dt>办事清单</dt>
          <dd class="num">v{{ checklistsMeta.version || '—' }} · 采集于 {{ checklistsMeta.collectedAt || '—' }}</dd>
        </div>
      </dl>

      <div class="divider" />

      <p class="small muted">税率来源：{{ taxSource }}</p>
      <p class="small muted">
        假期来源：{{ holidaysSource || '按年度分别记录，见「时间」页页脚政策依据' }}
      </p>
      <p class="faint tiny">
        配置改动只需替换 <code>public/data</code> 下的 JSON，页面会通过版本号提示差异；
        不用改代码。
      </p>
    </section>
  </div>
</template>

<style scoped>
.section-flush {
  margin: 0;
}

.offset-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.offset-row input[type='range'] {
  flex: 1;
  min-width: 0;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  accent-color: var(--accent);
}

.preview {
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  border: 1px solid var(--line);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.key-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.key-item {
  background: var(--lv0-weak);
  color: var(--text-2);
  border-radius: 6px;
  padding: 1px 7px;
  word-break: break-all;
}

.confirm {
  border-radius: var(--radius-sm);
  border: 1px solid var(--lv1);
  background: var(--lv1-weak);
  padding: 10px 12px;
}

.confirm-btn {
  background: var(--lv1);
  border-color: var(--lv1);
  color: #fff;
}

.confirm-btn:hover {
  background: var(--lv1);
  border-color: var(--lv1);
  opacity: 0.9;
}

.ver-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ver {
  display: flex;
  gap: 10px;
  font-size: 13px;
  line-height: 1.6;
}

.ver dt {
  flex: none;
  width: 76px;
  color: var(--text-3);
}

.ver dd {
  margin: 0;
  color: var(--text-2);
  min-width: 0;
}
</style>
