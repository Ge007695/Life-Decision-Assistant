<script setup>
/**
 * 组件层 · 可勾选清单
 * 只负责“把已有的动作数组画出来”，不做业务判断。
 * 勾选状态按 storageKey 存本地，刷新后保留（工作指导书 8.1）。
 */
import { computed, ref, watch } from 'vue'
import { get, set } from '@/services/storage.js'

const props = defineProps({
  actions: { type: Array, default: () => [] },
  storageKey: { type: String, default: '' },
  title: { type: String, default: '' },
  dense: { type: Boolean, default: false },
})

const emit = defineEmits(['change'])

const checked = ref({})

// 用动作文案做键：动作内容变了，旧的勾选自然失效，比用下标可靠
function keyOf(action, index) {
  return `${index}::${action}`
}

watch(
  () => props.storageKey,
  (key) => {
    checked.value = key ? get(key, {}) || {} : {}
  },
  { immediate: true },
)

function toggle(action, index) {
  const key = keyOf(action, index)
  const next = { ...checked.value, [key]: !checked.value[key] }
  if (!next[key]) delete next[key]
  checked.value = next
  if (props.storageKey) set(props.storageKey, next)
  emit('change', next)
}

const doneCount = computed(
  () => props.actions.filter((action, index) => checked.value[keyOf(action, index)]).length,
)
</script>

<template>
  <div class="action-list" :class="{ dense }">
    <div v-if="title || actions.length" class="list-head">
      <span class="card-sub">{{ title || '行动清单' }}</span>
      <span v-if="actions.length" class="faint tiny num">{{ doneCount }} / {{ actions.length }}</span>
    </div>

    <ul>
      <li v-for="(action, index) in actions" :key="index">
        <label class="item" :class="{ done: checked[keyOf(action, index)] }">
          <input
            type="checkbox"
            :checked="!!checked[keyOf(action, index)]"
            @change="toggle(action, index)"
          />
          <span class="box" aria-hidden="true">
            <svg viewBox="0 0 12 10" width="10" height="8">
              <path d="M1 5.2 4.2 8.4 11 1.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <span class="text">{{ action }}</span>
        </label>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.action-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.list-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 6px;
}

.item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 7px 0;
  cursor: pointer;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text);
}

.dense .item {
  padding: 5px 0;
  font-size: 13.5px;
}

.item input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.box {
  flex: none;
  width: 17px;
  height: 17px;
  margin-top: 2px;
  border: 1.5px solid var(--line-strong);
  border-radius: 5px;
  display: grid;
  place-items: center;
  color: transparent;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  background: var(--surface);
}

.item:hover .box {
  border-color: var(--text-3);
}

.item input:focus-visible + .box {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.done .box {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.done .text {
  color: var(--text-3);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.text {
  flex: 1;
  min-width: 0;
}
</style>
