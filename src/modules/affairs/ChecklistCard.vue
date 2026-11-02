<script setup>
/**
 * 办事模块 · 可展开的单条事项
 *
 * 材料清单的可勾选状态交给 ActionList（组件层已封装存储），
 * 本组件只负责展开/收起、渠道与时限展示、进度条。
 */
import { computed } from 'vue'
import ActionList from '@/components/ActionList.vue'
import { affairsKey, percentOf } from './progress.js'

const props = defineProps({
  item: { type: Object, required: true },
  open: { type: Boolean, default: false },
  done: { type: Number, default: 0 },
})

const emit = defineEmits(['toggle', 'change'])

const materials = computed(() => props.item.materials || [])
const total = computed(() => materials.value.length)
const percent = computed(() => percentOf(props.done, total.value))
const complete = computed(() => total.value > 0 && props.done >= total.value)
</script>

<template>
  <article class="item card-flat" :class="{ complete }">
    <button
      type="button"
      class="head"
      :aria-expanded="open"
      :aria-controls="`materials-${item.id}`"
      @click="emit('toggle')"
    >
      <span class="head-main">
        <span class="title">{{ item.title }}</span>
        <span class="meta faint tiny">
          材料 {{ done }} / {{ total }}
          <template v-if="complete"> · 已备齐</template>
        </span>
      </span>
      <span class="right">
        <span class="chip" :class="complete ? 'chip-lv4' : 'chip-lv0'">{{ percent }}%</span>
        <span class="arrow" :class="{ rotated: open }" aria-hidden="true" />
      </span>
    </button>

    <div class="track" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
      <div class="fill" :class="{ done: complete }" :style="{ width: `${percent}%` }" />
    </div>

    <div v-show="open" :id="`materials-${item.id}`" class="body stack-sm">
      <dl class="facts">
        <div class="fact">
          <dt>办理渠道</dt>
          <dd>{{ item.channel }}</dd>
        </div>
        <div class="fact">
          <dt>办理时限</dt>
          <dd>{{ item.timeline }}</dd>
        </div>
      </dl>

      <div class="divider" />

      <ActionList
        :actions="materials"
        :storage-key="affairsKey(item.id)"
        title="材料清单（勾选表示已备齐）"
        dense
        @change="(next) => emit('change', next)"
      />
    </div>
  </article>
</template>

<style scoped>
.item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  transition: border-color 0.15s ease;
}

.item.complete {
  border-color: var(--lv4);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 0;
}

.head-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
}

.meta {
  display: block;
}

.right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.arrow {
  width: 0;
  height: 0;
  border-left: 4.5px solid var(--text-3);
  border-top: 3.5px solid transparent;
  border-bottom: 3.5px solid transparent;
  transition: transform 0.15s ease;
}

.arrow.rotated {
  transform: rotate(90deg);
}

.track {
  height: 4px;
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

.fill.done {
  background: var(--lv4);
}

.body {
  padding-top: 4px;
}

.facts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fact {
  display: flex;
  gap: 10px;
  font-size: 13px;
  line-height: 1.6;
}

.fact dt {
  flex: none;
  width: 62px;
  color: var(--text-3);
}

.fact dd {
  margin: 0;
  color: var(--text-2);
  min-width: 0;
}
</style>
