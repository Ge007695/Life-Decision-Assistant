<script setup>
/**
 * 组件层 · 趋势与对比图
 * ECharts 按需引入，只加载本组件用到的图表与组件，避免整包进构建。
 * 调用方传入完整 option，本组件不拼业务数据。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
} from 'echarts/components'

use([
  CanvasRenderer,
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
])

const props = defineProps({
  option: { type: Object, default: () => ({}) },
  height: { type: String, default: '240px' },
})

const el = ref(null)
let chart = null
let observer = null

function render() {
  if (!chart) return
  chart.setOption(props.option, { notMerge: true })
}

onMounted(async () => {
  const { init } = await import('echarts/core')
  if (!el.value) return
  chart = init(el.value, null, { renderer: 'canvas' })
  render()
  observer = new ResizeObserver(() => chart && chart.resize())
  observer.observe(el.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  chart?.dispose()
  chart = null
})

watch(() => props.option, render, { deep: true })
</script>

<template>
  <div ref="el" class="trend-chart" :style="{ height }" />
</template>

<style scoped>
.trend-chart {
  width: 100%;
}
</style>
