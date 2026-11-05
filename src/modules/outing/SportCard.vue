<script setup>
/**
 * 出门模块 · 运动适宜度（O-9 / P2）
 *
 * 气温与湿度从首页传入（首页已经取过）；AQI 与紫外线来自 air.js，
 * 数据源和缓存时长都跟天气预报不同，所以由本组件自己取一次。
 *
 * 取不到 AQI 时不让整张卡片消失：传 undefined 给规则，
 * 规则按剩余维度重算并标 degraded，页面写清缺哪项——
 * 「空气数据没取到」不等于「空气很好」。
 */
import { computed, inject, onMounted, ref } from 'vue'
import ActionList from '@/components/ActionList.vue'
import airService from '@/services/air.js'
import { get as readStore, KEYS } from '@/services/storage.js'
import { run } from '@/core/engine.js'

const props = defineProps({
  temp: { type: Number, default: null },
  humidity: { type: Number, default: null },
})

const config = inject('config', {})

const loading = ref(true)
const airError = ref('')
const airStale = ref(false)
const air = ref(null)

onMounted(async () => {
  const settings = readStore(KEYS.SETTINGS, {}) || {}
  const cities = config.cities || []
  const wanted = settings.cityId || config.defaultCityId
  const city = cities.find((item) => item.id === wanted) || cities[0]

  if (!city) {
    airError.value = '没有可用城市配置'
    loading.value = false
    return
  }

  try {
    const response = await airService.get(city)
    if (response?.ok && response.data) {
      air.value = response.data
      airStale.value = Boolean(response.stale)
    } else {
      airError.value = response?.error || '空气质量没取到'
    }
  } catch (err) {
    airError.value = err?.message || '空气质量没取到'
  } finally {
    loading.value = false
  }
})

const result = computed(() => {
  if (!Number.isFinite(props.temp) && !Number.isFinite(props.humidity)) return null
  return run(
    'sport',
    {
      temp: props.temp,
      humidity: props.humidity,
      aqi: air.value?.aqi ?? undefined,
      uv: air.value?.uv ?? undefined,
    },
    config,
  )
})

const rows = computed(() => {
  const dims = result.value?.meta?.dimensions || []
  return dims.map((item) => ({
    key: item.key,
    label: item.label,
    // score 为 null 表示这项没数据，界面上要显示「—」而不是 0 分
    score: typeof item.score === 'number' ? Math.round(item.score) : null,
    value: item.band?.label
      ? `${Math.round(item.value * 10) / 10}（${item.band.label}）`
      : Number.isFinite(item.value)
        ? `${Math.round(item.value * 10) / 10}${item.unit ? ` ${item.unit}` : ''}`
        : '未取到',
  }))
})

const chipClass = computed(() => {
  const level = result.value?.level
  if (result.value?.degraded) return 'chip-lv2'
  return `chip-lv${Math.min(Math.max(level ?? 0, 0), 4)}`
})

const staleText = computed(() => {
  if (!airStale.value) return ''
  return '空气质量是几小时前的缓存，可能已过期'
})

const missingText = computed(() => {
  if (!airError.value) return ''
  return `空气质量与紫外线没取到（${airError.value}），下面按气温与湿度两项判断。`
})
</script>

<template>
  <section class="card stack-sm">
    <div class="row-between">
      <h2 class="section-title section-flush">运动适宜度</h2>
      <span v-if="result" class="chip" :class="chipClass">{{ result.levelLabel }}</span>
    </div>

    <div v-if="loading" class="stack-sm">
      <div class="skeleton skeleton-bar" />
    </div>

    <p v-else-if="!result" class="small faint">气温与湿度都没取到，暂时无法判断运动适宜度。</p>

    <template v-else>
      <p class="small">{{ result.headline }}</p>
      <p v-if="missingText" class="faint tiny">{{ missingText }}</p>
      <p v-if="staleText" class="faint tiny">{{ staleText }}</p>

      <div class="dim-list">
        <div v-for="row in rows" :key="row.key" class="dim">
          <span class="dim-label">{{ row.label }}</span>
          <span class="faint tiny num dim-value">{{ row.value }}</span>
          <span class="dim-bar" aria-hidden="true">
            <span class="dim-fill" :style="{ width: `${row.score ?? 0}%` }" :class="{ 'dim-empty': row.score === null }" />
          </span>
          <span class="tiny num dim-score" :class="{ faint: row.score === null }">
            {{ row.score === null ? '—' : row.score }}
          </span>
        </div>
      </div>

      <ActionList
        v-if="result.actions.length"
        :actions="result.actions"
        storage-key="checklist:sport"
        title="运动建议"
        dense
      />

      <p class="faint tiny">
        四个维度各打 0—100 分再加权（气温 35%、湿度 20%、空气质量 30%、紫外线 15%）；
        气温与湿度在舒适区间内满分，越偏离扣分越多。空气质量用美国 AQI 分档，
        与中国 AQI 的 50/100/150/200 分界一致。
      </p>
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

.dim-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/*
 * 四列：标签 / 数值 / 条 / 分数。
 * 条必须拿到大部分剩余宽度（2fr），60 分与 80 分的差别才看得出来；
 * 早先给的是固定 88px，60% 与 80% 只差 17px，等于没有可比性。
 */
.dim {
  display: grid;
  grid-template-columns: 60px 1fr 2fr 30px;
  align-items: center;
  gap: 8px;
}

.dim-label {
  font-size: 13px;
  color: var(--text-2);
}

.dim-value {
  text-align: right;
}

.dim-bar {
  height: 6px;
  border-radius: 3px;
  background: var(--line);
  overflow: hidden;
}

.dim-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
}

.dim-empty {
  background: transparent;
}

.dim-score {
  text-align: right;
  color: var(--text-2);
}

@media (max-width: 430px) {
  /* 手机上一行放不下四列，把条形放到第二行，数值与分数留在第一行 */
  .dim {
    grid-template-columns: 64px 1fr 28px;
    grid-template-areas:
      'label value score'
      'bar bar bar';
    row-gap: 4px;
  }

  .dim-label {
    grid-area: label;
  }

  .dim-value {
    grid-area: value;
  }

  .dim-bar {
    grid-area: bar;
  }

  .dim-score {
    grid-area: score;
  }
}
</style>
