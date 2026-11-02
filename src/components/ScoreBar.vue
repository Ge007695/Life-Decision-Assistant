<script setup>
/**
 * 组件层 · 指数分值与等级色条
 * items: [{ id, label, score, level, levelLabel }]
 */
const props = defineProps({
  items: { type: Array, default: () => [] },
  activeId: { type: String, default: '' },
  selectable: { type: Boolean, default: true },
})

const emit = defineEmits(['select'])

function levelClass(level) {
  const safe = Math.max(0, Math.min(4, Number(level) || 0))
  return `lv-${safe}`
}
</script>

<template>
  <ul class="score-bars">
    <li
      v-for="item in props.items"
      :key="item.id"
      class="bar-row"
      :class="{ active: item.id === activeId, clickable: selectable }"
      @click="selectable && emit('select', item.id)"
    >
      <div class="bar-head">
        <span class="label">{{ item.label }}</span>
        <span class="value num" :class="levelClass(item.level)">
          <span class="score">{{ Math.round(item.score) }}</span>
          <span class="unit">分</span>
        </span>
      </div>
      <div class="track">
        <div class="fill" :class="levelClass(item.level)" :style="{ width: `${Math.max(2, Math.min(100, item.score))}%` }" />
      </div>
      <span class="chip" :class="`chip-${levelClass(item.level)}`">{{ item.levelLabel }}</span>
    </li>
  </ul>
</template>

<style scoped>
.score-bars {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bar-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'head value'
    'track chip';
  align-items: center;
  gap: 6px 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  transition: background 0.15s ease;
}

.bar-row.clickable {
  cursor: pointer;
}

.bar-row.clickable:hover {
  background: var(--surface-2);
}

.bar-row.active {
  background: var(--accent-weak);
}

.bar-head {
  grid-area: head;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.label {
  font-size: 13px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.value {
  grid-area: value;
  font-size: 13px;
  font-weight: 650;
}

.unit {
  font-size: 10px;
  font-weight: 500;
  margin-left: 1px;
  opacity: 0.75;
}

.track {
  grid-area: track;
  height: 5px;
  border-radius: 999px;
  background: var(--lv0-weak);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.fill.lv-4 {
  background: var(--lv4);
}
.fill.lv-3 {
  background: var(--lv3);
}
.fill.lv-2 {
  background: var(--lv2);
}
.fill.lv-1 {
  background: var(--lv1);
}
.fill.lv-0 {
  background: var(--lv0);
}

.chip {
  grid-area: chip;
  justify-self: end;
}
</style>
