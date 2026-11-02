<script setup>
/**
 * 组件层 · 结论卡
 * 唯一职责：把一个 DecisionResult 画出来（工作指导书 8.1）。
 * 不做任何业务判断——等级色、文案、依据全部来自传入结构。
 */
import { computed } from 'vue'
import ActionList from './ActionList.vue'

const props = defineProps({
  result: { type: Object, required: true },
  title: { type: String, default: '' },
  showActions: { type: Boolean, default: true },
  showEvidence: { type: Boolean, default: true },
  feedbackable: { type: Boolean, default: false },
  storageKey: { type: String, default: '' },
  hero: { type: Boolean, default: false },
})

const emit = defineEmits(['feedback'])

const level = computed(() => Math.max(0, Math.min(4, Number(props.result?.level) || 0)))
const levelClass = computed(() => `lv-${level.value}`)
const evidence = computed(() => props.result?.evidence || [])
const actions = computed(() => props.result?.actions || [])

const maxContribution = computed(() => {
  const values = evidence.value.map((item) => Number(item.contribution) || 0)
  return Math.max(0.0001, ...values)
})

function updatedLabel() {
  const raw = props.result?.updatedAt
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function percent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—'
  return `${Math.round(value * 100)}%`
}
</script>

<template>
  <article class="decision-card" :class="[levelClass, { hero }]">
    <header class="head">
      <div class="head-left">
        <span v-if="title" class="title">{{ title }}</span>
        <span class="chip" :class="`chip-${levelClass}`">{{ result.levelLabel || '未知' }}</span>
        <span v-if="result.degraded" class="chip chip-lv2">数据降级</span>
      </div>
      <div class="score num" :class="levelClass">
        {{ Math.round(result.score ?? 0) }}<span class="unit">分</span>
      </div>
    </header>

    <p class="headline">{{ result.headline }}</p>

    <ActionList
      v-if="showActions && actions.length"
      :actions="actions"
      :storage-key="storageKey"
      class="actions"
    />

    <details v-if="showEvidence && evidence.length" class="evidence">
      <summary>
        <span>依据</span>
        <span class="faint tiny">为什么这么判 · {{ evidence.length }} 项</span>
      </summary>
      <ul class="evidence-list">
        <li v-for="item in evidence" :key="item.key || item.label" class="evidence-item">
          <div class="ev-head">
            <span class="ev-label">{{ item.label }}</span>
            <span class="ev-value num">{{ item.value }}</span>
          </div>
          <div class="ev-meta">
            <span v-if="item.weight !== null && item.weight !== undefined" class="faint tiny">
              权重 {{ percent(item.weight) }}
            </span>
            <span v-if="item.contribution !== null && item.contribution !== undefined" class="faint tiny">
              贡献 {{ percent(item.contribution) }}
            </span>
            <span v-if="item.missing" class="faint tiny">数据缺失，已按剩余项归一</span>
          </div>
          <div v-if="typeof item.contribution === 'number'" class="ev-track">
            <div
              class="ev-fill"
              :class="levelClass"
              :style="{ width: `${Math.max(1.5, (item.contribution / maxContribution) * 100)}%` }"
            />
          </div>
        </li>
      </ul>
    </details>

    <footer class="foot">
      <span v-if="feedbackable" class="feedback">
        <span class="faint tiny">体感校准：</span>
        <button class="btn btn-ghost btn-sm" @click="emit('feedback', 'cold')">偏冷</button>
        <button class="btn btn-ghost btn-sm" @click="emit('feedback', 'hot')">偏热</button>
      </span>
      <span class="spacer" />
      <span v-if="updatedLabel()" class="faint tiny num">更新于 {{ updatedLabel() }}</span>
    </footer>
  </article>
</template>

<style scoped>
.decision-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 16px 18px 12px;
  box-shadow: var(--shadow);
  position: relative;
  overflow: hidden;
}

/* 左侧等级色条：一眼能扫出好坏，不靠读文字 */
.decision-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--lv0);
}

.decision-card.lv-4::before {
  background: var(--lv4);
}
.decision-card.lv-3::before {
  background: var(--lv3);
}
.decision-card.lv-2::before {
  background: var(--lv2);
}
.decision-card.lv-1::before {
  background: var(--lv1);
}

.hero {
  padding: 20px 20px 14px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}

.score {
  font-size: 15px;
  font-weight: 700;
  flex: none;
}

.unit {
  font-size: 10px;
  font-weight: 500;
  margin-left: 1px;
  opacity: 0.7;
}

.headline {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.5;
  letter-spacing: 0.005em;
  color: var(--text);
  text-wrap: pretty;
}

.hero .headline {
  font-size: 20px;
  line-height: 1.45;
}

.actions {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
}

.evidence {
  margin-top: 10px;
  border-top: 1px dashed var(--line);
  padding-top: 8px;
}

.evidence summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-2);
  list-style: none;
  padding: 2px 0;
}

.evidence summary::-webkit-details-marker {
  display: none;
}

.evidence summary::before {
  content: '';
  width: 0;
  height: 0;
  border-left: 4.5px solid currentColor;
  border-top: 3.5px solid transparent;
  border-bottom: 3.5px solid transparent;
  transition: transform 0.15s ease;
  flex: none;
}

.evidence[open] summary::before {
  transform: rotate(90deg);
}

.evidence-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 2px 4px;
}

.evidence-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ev-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.ev-label {
  color: var(--text-2);
}

.ev-value {
  font-weight: 600;
}

.ev-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.ev-track {
  height: 3px;
  border-radius: 999px;
  background: var(--lv0-weak);
  overflow: hidden;
  margin-top: 2px;
}

.ev-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--lv3);
}

.ev-fill.lv-4 {
  background: var(--lv4);
}
.ev-fill.lv-3 {
  background: var(--lv3);
}
.ev-fill.lv-2 {
  background: var(--lv2);
}
.ev-fill.lv-1 {
  background: var(--lv1);
}

.foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  min-height: 26px;
}

.feedback {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
</style>
