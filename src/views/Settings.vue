<script setup>
/**
 * 设置页 · 城市 / 室内温度 / 体感偏移 / 本地数据 / 配置来源
 *
 * 设置只写 KEYS.SETTINGS 一个键，存 { cityId, indoorTemp, feedbackOffset }。
 * 阈值与文案尽量从配置取，页面上不出现“凭印象写的数字”。
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import FormField from '@/components/FormField.vue'
import storage, { get, set, KEYS } from '@/services/storage.js'
import { locate } from '@/services/location.js'
import { describeDistance, findNearestCity } from '@/core/utils/geo.js'

const config = inject('config', {})

/* ---------- 取值来源 ---------- */

const damp = computed(() => config.indices?.damp?.thresholds || {})
const lookbackHours = computed(() => damp.value.indoorTempLookbackHours || 72)
const indoorDefault = computed(() => damp.value.indoorTempDefault ?? 22)

/**
 * 城市列表：全国 370 个，按省份排序。
 * 注意默认城市要取 cities.json 里的 default 字段，不能取列表第一个——
 * 排序后第一个是「安庆」，不是深圳。
 */
const cities = computed(() => config.cities || [])
const defaultCityId = computed(() => config.defaultCityId || cities.value[0]?.id || '')
const defaultCity = computed(
  () => cities.value.find((city) => city.id === defaultCityId.value) || cities.value[0] || null,
)
const cityHint = computed(() =>
  `用于天气取数与穿衣、晾晒结论；共 ${cities.value.length} 个城市可选，默认${defaultCity.value?.name || '—'}`,
)

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

/* ---------- 城市选择与定位 ---------- */

/**
 * 城市选择改成「搜索 + 分组点选」，不用原生下拉：
 * 370 个城市塞进 <select> 里滚动找是很折磨人的，手机上下拉更是灾难。
 *
 * 搜索只匹配汉字与省份名，不做拼音首字母——拼音需要额外的拼音数据，
 * 而中文输入法打「sz」也是先上屏「深圳」再选中，汉字匹配已经够用，
 * 没必要为此让 cities.json 多带一份拼音字段。
 */
const keyword = ref('')

const currentCity = computed(
  () => cities.value.find((city) => city.id === cityId.value) || defaultCity.value,
)

const filteredCities = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) return cities.value
  return cities.value.filter((city) => city.name.includes(kw) || city.province.includes(kw))
})

/** 按省分组，未搜索时保持省份顺序；搜索结果少于一屏时不显示分组标题 */
const cityGroups = computed(() => {
  const groups = []
  let lastProvince = null
  for (const city of filteredCities.value) {
    if (city.province !== lastProvince) {
      groups.push({ province: city.province, cities: [] })
      lastProvince = city.province
    }
    groups[groups.length - 1].cities.push(city)
  }
  return groups
})

const showGroupTitles = computed(() => !keyword.value.trim() && cityGroups.value.length > 1)

const cityState = ref('') // '' | 'saved' | 'memory'

/**
 * 选中即保存：城市是独立设置项，用户点完城市还要滚到下面找「保存设置」会莫名其妙。
 * 只覆盖 cityId，室内温度与偏移沿用已存的值，避免把输入框里未提交的内容顺带写进去。
 */
function applyCity(id, options = {}) {
  cityId.value = id
  const current = get(KEYS.SETTINGS, {}) || {}
  const ok = set(KEYS.SETTINGS, {
    ...current,
    cityId: id,
    indoorTemp: Number.isFinite(current.indoorTemp) ? current.indoorTemp : indoorDefault.value,
    feedbackOffset: Number.isFinite(current.feedbackOffset) ? current.feedbackOffset : 0,
  })
  cityState.value = ok ? 'saved' : 'memory'
  keys.value = storage.listKeys()
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    cityState.value = ''
  }, 2400)
  // 定位是「用户不知道会选到哪个」，得把它滚出来；手动点选本来就在眼前，滚了反而跳
  if (options.reveal) nextTick(scrollActiveIntoView)
}

const locating = ref(false)
const locateState = ref(null) // {kind: 'ok'|'error', text}

const listRef = ref(null)

/**
 * 打开页面时把已选城市滚到列表中间。
 * 不做这件事的话，列表按省份排、默认从「安徽」开头，
 * 而默认城市深圳在「广东」那一段，用户一进来根本看不到自己选的是哪个。
 */
function scrollActiveIntoView() {
  const container = listRef.value
  if (!container) return
  const active = container.querySelector('.city-chip-active')
  if (!active) return
  const box = container.getBoundingClientRect()
  const chip = active.getBoundingClientRect()
  container.scrollTop += chip.top - box.top - (box.height - chip.height) / 2
}

/** 把定位失败的原因翻译成用户能照着做的下一步，而不是「定位失败」四个字 */
const LOCATE_REASON = {
  denied: '你拒绝了定位授权。可以在浏览器地址栏左侧的站点图标里重新允许，或直接手动选城市。',
  insecure: '当前页面不是 HTTPS，浏览器不允许定位。请手动选择城市。',
  unavailable: '系统没有提供位置信息，请检查手机或电脑的定位服务是否开启，或手动选择城市。',
  timeout: '定位超时。可以再试一次，或直接手动选择城市。',
  unsupported: '当前浏览器不支持定位，请手动选择城市。',
}

async function useMyLocation() {
  locating.value = true
  locateState.value = null
  try {
    const position = await locate()
    if (!position.ok) {
      locateState.value = {
        kind: 'error',
        text: LOCATE_REASON[position.reason] || `定位失败：${position.message || position.reason}`,
      }
      return
    }

    const nearest = findNearestCity(cities.value, position.latitude, position.longitude)
    if (!nearest) {
      locateState.value = { kind: 'error', text: '定位到了坐标，但城市表里没有可匹配的城市，请手动选择。' }
      return
    }

    applyCity(nearest.city.id, { reveal: true })
    const accuracyNote = position.accuracy && position.accuracy > 5000
      ? '，设备给的定位精度较低'
      : ''
    locateState.value = {
      kind: 'ok',
      text: `已按位置匹配到「${nearest.city.name}」（${describeDistance(nearest.distanceKm)}${accuracyNote}）。不准确的话在下面手动选。`,
    }
  } finally {
    locating.value = false
  }
}

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

onMounted(() => {
  nextTick(scrollActiveIntoView)
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

      <div class="city-current">
        <div class="city-current-main">
          <span class="city-current-name">{{ currentCity?.name || '—' }}</span>
          <span class="faint tiny">{{ currentCity?.province }}</span>
        </div>
        <button type="button" class="btn btn-sm" :disabled="locating" @click="useMyLocation">
          {{ locating ? '定位中…' : '使用当前位置' }}
        </button>
      </div>

      <p v-if="locateState" class="locate-note" :class="`locate-${locateState.kind}`" role="status">
        {{ locateState.text }}
      </p>

      <div class="field">
        <label class="field-label" for="city-search">选择城市</label>
        <input
          id="city-search"
          v-model="keyword"
          type="search"
          autocomplete="off"
          placeholder="输入城市或省份，如「深圳」「广东」"
        />
        <p class="field-hint">{{ cityHint }}</p>
      </div>

      <p v-if="!cities.length" class="field-error">城市配置未加载，请检查 cities.json。</p>
      <template v-else>
        <div v-if="filteredCities.length" ref="listRef" class="city-list">
          <div v-for="group in cityGroups" :key="group.province" class="city-group">
            <p v-if="showGroupTitles" class="city-group-name">{{ group.province }}</p>
            <div class="city-chips">
              <button
                v-for="city in group.cities"
                :key="city.id"
                type="button"
                class="city-chip"
                :class="{ 'city-chip-active': city.id === cityId }"
                :aria-pressed="city.id === cityId"
                @click="applyCity(city.id)"
              >
                {{ city.name }}
              </button>
            </div>
          </div>
        </div>
        <p v-else class="field-error">没有匹配的城市，换个关键词试试。</p>
      </template>

      <p v-if="cityState" class="faint tiny" role="status">
        {{ cityState === 'saved' ? '城市已保存，回到首页即可看到该城市的结论。' : '已应用，但当前为隐私模式，本次不会保存。' }}
      </p>
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

/* ---------- 城市选择 ---------- */

.city-current {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: var(--surface-2);
}

.city-current-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.city-current-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.city-current .btn {
  flex: none;
}

.locate-note {
  font-size: 12.5px;
  line-height: 1.55;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
}

.locate-ok {
  color: var(--lv4);
  background: var(--lv4-weak);
  border-color: var(--lv4-weak);
}

.locate-error {
  color: var(--lv1);
  background: var(--lv1-weak);
  border-color: var(--lv1-weak);
}

/* 370 个城市不能撑满整页，给固定高度自己滚；
   底部内阴影是「下面还有内容」的提示，否则看着像列表被切断 */
.city-list {
  max-height: 300px;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px 8px;
  border-radius: var(--radius-sm);
  box-shadow: inset 0 -16px 16px -16px rgba(23, 25, 28, 0.22);
}

.city-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.city-group-name {
  font-size: 12px;
  color: var(--text-3);
  margin: 0;
  position: sticky;
  top: 0;
  background: var(--surface);
  padding: 2px 0;
  z-index: 1;
}

.city-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.city-chip {
  font-size: 13px;
  line-height: 1;
  padding: 7px 11px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text-2);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.city-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.city-chip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-weak);
}

.city-chip-active {
  border-color: var(--accent);
  background: var(--accent-weak);
  color: var(--accent-dark);
  font-weight: 600;
}

@media (max-width: 430px) {
  .city-current {
    flex-wrap: wrap;
  }

  .city-current .btn {
    width: 100%;
  }

  .city-list {
    max-height: 260px;
  }
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
