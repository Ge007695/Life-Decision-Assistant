<script setup>
/**
 * 时间模块 · 年度日历（12 个月网格）
 *
 * 只负责把 calendar.withMeta() 给出的格子画出来：
 * 颜色、文案、优先级全部是查表结果，模板里没有任何 if 判断日期类型。
 */
import { computed, ref, watch } from 'vue'
import { LEGEND, WEEKDAYS, describeCell, describeShort } from './calendar.js'

const props = defineProps({
  year: { type: Number, required: true },
  months: { type: Array, default: () => [] },
  today: { type: String, default: '' },
})

const selected = ref('')

// 默认选中今天（只在浏览今天所在年份时才有意义）
watch(
  () => [props.year, props.today, props.months.length],
  () => {
    selected.value = String(props.today || '').startsWith(`${props.year}-`) ? props.today : ''
  },
  { immediate: true },
)

/** 当前选中的格子，用于底部说明行 */
const activeCell = computed(() => {
  for (const month of props.months) {
    for (const cell of month.cells) {
      if (cell && cell.date === selected.value) return cell
    }
  }
  return null
})

const activeText = computed(() => describeShort(activeCell.value))

function pick(cell) {
  if (!cell) return
  selected.value = selected.value === cell.date ? '' : cell.date
}
</script>

<template>
  <div class="cal">
    <ul class="legend">
      <li v-for="item in LEGEND" :key="item.key" class="legend-item">
        <span class="dot" :class="item.className" aria-hidden="true" />
        <span class="tiny">{{ item.label }}</span>
        <span class="faint tiny">{{ item.hint }}</span>
      </li>
    </ul>

    <p class="active-line small" aria-live="polite">
      <span class="chip" :class="activeCell ? activeCell.meta.chip : 'chip-lv0'">
        {{ activeCell ? activeCell.meta.label : '未选择' }}
      </span>
      <span class="muted">{{ activeText }}</span>
    </p>

    <div class="months">
      <section v-for="month in months" :key="month.month" class="month">
        <h3 class="month-title">{{ month.label }}</h3>
        <div class="week-head" aria-hidden="true">
          <span v-for="day in WEEKDAYS" :key="day" class="week-cell">{{ day }}</span>
        </div>
        <div class="grid">
          <template v-for="(cell, index) in month.cells" :key="cell ? cell.date : `blank-${index}`">
            <span v-if="!cell" class="cell blank" aria-hidden="true" />
            <button
              v-else
              type="button"
              class="cell"
              :class="[cell.meta.className, { today: cell.date === today, active: cell.date === selected }]"
              :aria-label="describeCell(cell)"
              :aria-current="cell.date === today ? 'date' : null"
              :title="describeCell(cell)"
              @click="pick(cell)"
            >
              {{ cell.day }}
            </button>
          </template>
        </div>
      </section>
    </div>

    <p class="faint tiny note">
      优先级：调休上班 &gt; 假期 &gt; 周末 &gt; 工作日。点击某天查看当天安排；今天为方框加圆点。
    </p>
  </div>
</template>

<style scoped>
.cal {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid var(--line);
  background: var(--surface);
}

.active-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 24px;
}

/* 12 个月：宽度够时两列以上，375px 手机上自动单列顺排，不横向滚动 */
.months {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 14px;
}

.month {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px 10px 12px;
  background: var(--surface);
}

.month-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 6px;
}

.week-head,
.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
}

.week-cell {
  text-align: center;
  font-size: 10px;
  color: var(--text-3);
  line-height: 1.8;
}

.cell {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  font-size: 11px;
  line-height: 1;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.cell.blank {
  background: transparent;
}

.cell:hover {
  border-color: var(--text-3);
}

/* ---- 四类底色，全部取等级色变量 ---- */
.t-holiday {
  background: var(--lv1-weak);
  color: var(--lv1);
  font-weight: 600;
}

.t-makeup {
  background: var(--lv0-weak);
  color: var(--lv0);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.t-weekend {
  background: var(--lv3-weak);
  color: var(--lv3);
}

.t-workday {
  color: var(--text-2);
}

/* 今天：方框 + 下方圆点，双重标记，不依赖颜色区分 */
.cell.today {
  position: relative;
  border-color: var(--text);
  font-weight: 700;
  color: var(--text);
}

.cell.today::after {
  content: '';
  position: absolute;
  bottom: 3px;
  left: 50%;
  width: 3px;
  height: 3px;
  margin-left: -1.5px;
  border-radius: 50%;
  background: var(--text);
}

.cell.active {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.note {
  line-height: 1.7;
}
</style>
