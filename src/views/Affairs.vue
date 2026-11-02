<script setup>
/**
 * 办事页 · 六类常用办事清单
 *
 * 数据全部来自 checklists.json（config.checklists），页面只负责展开、勾选与进度统计。
 * 顶部免责声明是这个模块唯一的“信息可能过期”提示，任何改动都不能删掉它。
 */
import { computed, inject, ref } from 'vue'
import { get } from '@/services/storage.js'
import { affairsKey, countChecked, percentOf } from '@/modules/affairs/progress.js'
import ChecklistCard from '@/modules/affairs/ChecklistCard.vue'

const config = inject('config', {})

const items = computed(() => config.checklists || [])
const meta = computed(() => config.checklistsMeta || {})

/** id → 已勾选材料数 */
const progress = ref({})
/** id → 是否展开 */
const openMap = ref({})

function loadProgress() {
  const next = {}
  for (const item of items.value) {
    next[item.id] = countChecked(get(affairsKey(item.id), {}))
  }
  progress.value = next
}
loadProgress()

function onToggle(id) {
  openMap.value = { ...openMap.value, [id]: !openMap.value[id] }
}

function onProgress(id, saved) {
  progress.value = { ...progress.value, [id]: countChecked(saved) }
}

const allOpen = computed(() => items.value.length > 0 && items.value.every((item) => openMap.value[item.id]))

function toggleAll() {
  if (allOpen.value) {
    openMap.value = {}
    return
  }
  const next = {}
  for (const item of items.value) next[item.id] = true
  openMap.value = next
}

const totalMaterials = computed(() =>
  items.value.reduce((sum, item) => sum + (item.materials?.length || 0), 0),
)
const doneMaterials = computed(() =>
  items.value.reduce((sum, item) => sum + (progress.value[item.id] || 0), 0),
)
const completeCount = computed(
  () =>
    items.value.filter((item) => {
      const total = item.materials?.length || 0
      return total > 0 && (progress.value[item.id] || 0) >= total
    }).length,
)
const totalPercent = computed(() => percentOf(doneMaterials.value, totalMaterials.value))
</script>

<template>
  <div class="page stack">
    <header class="stack-sm">
      <h1 class="card-title">办事</h1>
      <p class="faint tiny">
        六类高频事项的材料与渠道 · 采集于 {{ meta.collectedAt || '—' }} · 配置版本 v{{ meta.version || '—' }}
      </p>
    </header>

    <!-- 免责声明：模块唯一的信息时效提示，不能省 -->
    <div class="notice">
      {{ meta.disclaimer || '信息采集日期待补充，办理前请以官方最新公告为准。' }}
    </div>

    <div v-if="items.length" class="row-between toolbar">
      <span class="faint tiny num">
        共 {{ items.length }} 项，已备齐 {{ completeCount }} 项 · 材料 {{ doneMaterials }} /
        {{ totalMaterials }}
      </span>
      <button type="button" class="btn btn-sm" @click="toggleAll">
        {{ allOpen ? '全部收起' : '全部展开' }}
      </button>
    </div>

    <div v-if="items.length" class="list">
      <ChecklistCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        :open="!!openMap[item.id]"
        :done="progress[item.id] || 0"
        @toggle="onToggle(item.id)"
        @change="(saved) => onProgress(item.id, saved)"
      />
    </div>
    <div v-else class="notice notice-error">
      办事清单配置未加载，请检查 <code>public/data/checklists.json</code>。
    </div>

    <!-- 进度总览 -->
    <section v-if="items.length" class="card stack-sm">
      <div class="row-between">
        <h2 class="section-title section-flush">进度总览</h2>
        <span class="chip" :class="completeCount === items.length ? 'chip-lv4' : 'chip-lv0'">
          已备齐 {{ completeCount }} / {{ items.length }} 项
        </span>
      </div>

      <div class="track" role="progressbar" :aria-valuenow="totalPercent" aria-valuemin="0" aria-valuemax="100">
        <div class="fill" :style="{ width: `${totalPercent}%` }" />
      </div>
      <p class="faint tiny num">
        材料合计 {{ doneMaterials }} / {{ totalMaterials }} 项（{{ totalPercent }}%），勾选状态保存在本机浏览器。
      </p>

      <ul class="stack-sm overview">
        <li v-for="item in items" :key="item.id" class="row-between line">
          <span class="small truncate">{{ item.title }}</span>
          <span class="small faint num">
            {{ progress[item.id] || 0 }} / {{ item.materials?.length || 0 }}
          </span>
        </li>
      </ul>

      <p class="faint tiny">
        办理要求可能随政策调整，本页不代办、不提交任何材料，只做清单与进度备忘。
      </p>
    </section>
  </div>
</template>

<style scoped>
.toolbar {
  align-items: center;
}

.section-flush {
  margin: 0;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.track {
  height: 6px;
  border-radius: 999px;
  background: var(--lv0-weak);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.2s ease;
}

.overview {
  margin-top: 2px;
}

.line {
  padding: 5px 0;
  border-bottom: 1px dashed var(--line);
}

.line:last-child {
  border-bottom: none;
}

.truncate {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
