<script setup>
/**
 * 组件层 · 统一输入控件与校验提示
 * 只负责排版与错误呈现，校验规则由调用方在内核层算好传进来。
 */
import { computed, useId } from 'vue'

const props = defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  suffix: { type: String, default: '' },
  inline: { type: Boolean, default: false },
})

const uid = useId()
const fieldId = computed(() => `field-${uid}`)
</script>

<template>
  <div class="field" :class="{ inline }">
    <label v-if="label" class="field-label" :for="fieldId">{{ label }}</label>
    <div class="control">
      <slot :id="fieldId" :error="!!error" />
      <span v-if="suffix" class="suffix">{{ suffix }}</span>
    </div>
    <p v-if="error" class="field-error">{{ error }}</p>
    <p v-else-if="hint" class="field-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.control {
  position: relative;
  display: flex;
  align-items: center;
}

.control :deep(input),
.control :deep(select) {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.control :deep(input:focus),
.control :deep(select:focus) {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-weak);
}

.control :deep(input[aria-invalid='true']) {
  border-color: var(--lv1);
}

.suffix {
  position: absolute;
  right: 12px;
  font-size: 12px;
  color: var(--text-3);
  pointer-events: none;
}

.inline {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

.inline .control {
  flex: 1;
}
</style>
