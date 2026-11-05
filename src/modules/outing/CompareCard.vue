<script setup>
/**
 * 出门模块 · 两地对比（O-10 / P2）
 *
 * 左边固定是设置里的常用城市，右边由用户选。
 * 两个城市各走一次 weather.js 的 24 小时缓存，同一城市重复打开不会重复请求。
 *
 * 不自动挑一个「热门城市」做默认右边：
 *   默认值一旦猜错，用户看到的是两个都不关心的城市，还得先改下拉才能用。
 *   留空 + 几个快捷按钮，选哪边由用户决定。
 */
import { computed, inject, onMounted, ref } from 'vue'
import weatherService from '@/services/weather.js'
import { get as readStore, KEYS } from '@/services/storage.js'
import { buildCompare } from './compare.js'

const config = inject('config', {})

/** 快捷对比城市：按名字查 id，找不到就自动跳过 */
const QUICK_NAMES = ['北京', '上海', '广州', '杭州', '成都']

const cities = computed(() => config.cities || [])

const loadingLeft = ref(true)
const loadingRight = ref(false)
const errorLeft = ref('')
const errorRight = ref('')
const leftId = ref('')
const leftCity = ref(null)
const leftWeather = ref(null)
const rightId = ref('')
const rightCity = ref(null)
const rightWeather = ref(null)

const settings = readStore(KEYS.SETTINGS, {}) || {}

const quickCities = computed(() =>
  QUICK_NAMES.map((name) => cities.value.find((city) => city.name === name)).filter(
    (city) => city && city.id !== leftId.value,
  ),
)

/** 按省分组，原生下拉的 optgroup 在手机上也支持 */
const grouped = computed(() => {
  const map = new Map()
  for (const city of cities.value) {
    if (city.id === leftId.value) continue
    const province = city.province || '其他'
    if (!map.has(province)) map.set(province, [])
    map.get(province).push(city)
  }
  return [...map.entries()].map(([province, list]) => ({ province, cities: list }))
})

const compare = computed(() => {
  if (!leftWeather.value || !rightWeather.value) return null
  return buildCompare({
    config,
    left: { city: leftCity.value, weather: leftWeather.value },
    right: { city: rightCity.value, weather: rightWeather.value },
    settings,
  })
})

const sameCity = computed(() => Boolean(rightId.value) && rightId.value === leftId.value)

onMounted(async () => {
  const wanted = settings.cityId || config.defaultCityId
  const city = cities.value.find((item) => item.id === wanted) || cities.value[0]
  if (!city) {
    errorLeft.value = '没有可用城市配置'
    loadingLeft.value = false
    return
  }
  leftId.value = city.id
  leftCity.value = city

  try {
    const response = await weatherService.get(city)
    if (response?.ok && response.data) leftWeather.value = response.data
    else errorLeft.value = response?.error || '天气数据没取到'
  } catch (err) {
    errorLeft.value = err?.message || '天气数据没取到'
  } finally {
    loadingLeft.value = false
  }
})

async function loadRight(id) {
  rightId.value = id
  rightWeather.value = null
  errorRight.value = ''
  if (!id) return
  if (id === leftId.value) {
    errorRight.value = '和左边是同一个城市，换一个再比'
    return
  }

  const city = cities.value.find((item) => item.id === id)
  if (!city) {
    errorRight.value = '找不到这个城市'
    return
  }

  loadingRight.value = true
  rightCity.value = city
  try {
    const response = await weatherService.get(city)
    if (response?.ok && response.data) rightWeather.value = response.data
    else errorRight.value = response?.error || '天气数据没取到'
  } catch (err) {
    errorRight.value = err?.message || '天气数据没取到'
  } finally {
    loadingRight.value = false
  }
}

function pickQuick(city) {
  loadRight(city.id)
}

/** 指数差值的箭头：只表示哪边高，不表示哪边好 */
function deltaArrow(delta) {
  if (delta === null || Math.abs(delta) < 0.5) return '≈'
  return delta > 0 ? '→' : '←'
}
</script>

<template>
  <section class="card stack-sm">
    <div class="row-between">
      <h2 class="section-title section-flush">两地对比</h2>
      <span v-if="leftCity" class="chip">{{ leftCity.name }}</span>
    </div>

    <p v-if="errorLeft" class="notice notice-error">
      常用城市的天气没取到：{{ errorLeft }}
    </p>

    <template v-else>
      <div class="picker">
        <label class="picker-label small muted" for="cmp-city">对比城市</label>
        <select
          id="cmp-city"
          class="picker-select"
          :value="rightId"
          :disabled="loadingLeft"
          @change="loadRight($event.target.value)"
        >
          <option value="">选一个城市</option>
          <optgroup v-for="group in grouped" :key="group.province" :label="group.province">
            <option v-for="city in group.cities" :key="city.id" :value="city.id">
              {{ city.name }}
            </option>
          </optgroup>
        </select>
        <div class="quick">
          <button
            v-for="city in quickCities"
            :key="city.id"
            type="button"
            class="btn btn-sm quick-btn"
            :class="{ 'quick-on': rightId === city.id }"
            @click="pickQuick(city)"
          >
            {{ city.name }}
          </button>
        </div>
      </div>

      <div v-if="loadingRight" class="stack-sm">
        <div class="skeleton skeleton-bar" />
      </div>

      <p v-else-if="errorRight" class="notice">{{ errorRight }}</p>

      <p v-else-if="!rightWeather" class="small faint">
        选一个城市，和 {{ leftCity?.name }} 并排比较当日气温、降水与四项指数。
      </p>

      <template v-else-if="compare">
        <p v-if="sameCity" class="notice">两边是同一个城市，数据完全一样。</p>
        <p v-if="compare.summary" class="small">{{ compare.summary }}</p>

        <div class="cmp-table">
          <div class="cmp-row cmp-head">
            <span class="cmp-label" />
            <span class="cmp-city num">{{ compare.left.city?.name }}</span>
            <span class="cmp-city num">{{ compare.right.city?.name }}</span>
          </div>

          <div v-for="row in compare.metrics" :key="row.key" class="cmp-row">
            <span class="cmp-label">{{ row.label }}</span>
            <span class="num cmp-val">{{ row.a }}<em v-if="row.unit && row.a !== '—'" class="cmp-unit">{{ row.unit }}</em></span>
            <span class="num cmp-val">{{ row.b }}<em v-if="row.unit && row.b !== '—'" class="cmp-unit">{{ row.unit }}</em></span>
          </div>

          <div v-for="row in compare.weekRows" :key="row.key" class="cmp-row">
            <span class="cmp-label">{{ row.label }}</span>
            <span class="num cmp-val">{{ row.a }}<em v-if="row.a !== '—'" class="cmp-unit">{{ row.unit }}</em></span>
            <span class="num cmp-val">{{ row.b }}<em v-if="row.b !== '—'" class="cmp-unit">{{ row.unit }}</em></span>
          </div>
        </div>

        <div class="divider" />

        <div class="cmp-table">
          <div class="cmp-row cmp-head">
            <span class="cmp-label" />
            <span class="cmp-city num">{{ compare.left.city?.name }}</span>
            <span class="cmp-city num">{{ compare.right.city?.name }}</span>
          </div>
          <div v-for="item in compare.indices" :key="item.id" class="cmp-row">
            <span class="cmp-label">{{ item.label }}</span>
            <span class="cmp-chip">
              <span v-if="item.a" class="chip" :class="`chip-lv${item.a.level}`">{{ item.a.label }}</span>
              <span v-else class="faint tiny">—</span>
            </span>
            <span class="cmp-chip">
              <span v-if="item.b" class="chip" :class="`chip-lv${item.b.level}`">{{ item.b.label }}</span>
              <span v-else class="faint tiny">—</span>
            </span>
            <span v-if="item.delta !== null" class="faint tiny cmp-arrow" :title="`指数差 ${item.delta}`">
              {{ deltaArrow(item.delta) }}
            </span>
          </div>
        </div>

        <p class="faint tiny">
          两列用同一份规则、同一份配置算出，箭头只表示哪边分数高（→ 右边高），不代表哪边更适合你。
          「7 天最高/最低」取未来 7 天预报的极值，有雨天数按降水概率 ≥50% 计。
        </p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.section-flush {
  margin: 0;
}

.skeleton-bar {
  height: 14px;
  width: 60%;
}

.picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.picker-label {
  margin: 0;
}

.picker-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
}

.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.quick-btn {
  padding: 4px 10px;
  font-size: 13px;
}

.quick-on {
  border-color: var(--accent);
  color: var(--accent);
}

/* 三列：指标名 / 左城 / 右城。指标列给固定宽度，两列数值才能对齐 */
.cmp-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cmp-row {
  display: grid;
  grid-template-columns: 96px 1fr 1fr 18px;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px dashed var(--line);
}

.cmp-row:last-child {
  border-bottom: none;
}

.cmp-head {
  border-bottom: 1px solid var(--line);
  padding-bottom: 6px;
}

.cmp-label {
  font-size: 13px;
  color: var(--text-2);
}

.cmp-city {
  font-size: 13px;
  font-weight: 700;
  text-align: right;
}

.cmp-val {
  text-align: right;
  font-size: 14px;
}

/* 单位靠 margin 分开，不靠模板里的空格——Vue 编译会把元素间的空白吃掉，粘成「30.7℃」 */
.cmp-unit {
  margin-left: 3px;
  font-style: normal;
  font-size: 12px;
  color: var(--text-3, var(--text-2));
}

.cmp-chip {
  text-align: right;
}

.cmp-arrow {
  text-align: center;
}

@media (max-width: 430px) {
  .cmp-row {
    grid-template-columns: 78px 1fr 1fr 16px;
    gap: 6px;
  }

  .cmp-label {
    font-size: 12px;
  }
}
</style>
