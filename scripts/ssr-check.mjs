#!/usr/bin/env node
/**
 * 页面运行时冒烟测试
 *
 * `vite build` 只能证明模板能编译，证明不了渲染时不炸。
 * 这个脚本用 Vite 的 SSR 加载真实 .vue 组件，注入真实配置渲染一遍，
 * 检查有没有 undefined、NaN、未替换的占位符、以及 Vue 的警告。
 *
 * 运行：node scripts/ssr-check.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createSSRApp, h, Suspense } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { createConfig } from '../src/core/config.js'
import { configure } from '../src/core/engine.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'public', 'data')
const readJson = (file) => JSON.parse(readFileSync(join(DATA, file), 'utf8'))

const config = createConfig(
  {
    indices: readJson('indices.json'),
    holidays: readJson('holidays.json'),
    taxRules: readJson('tax-rules.json'),
    clothingTable: readJson('clothing-table.json'),
    cities: readJson('cities.json'),
    checklists: readJson('checklists.json'),
  },
  { now: Date.now() },
)
configure(config)

const warnings = []
const originalWarn = console.warn
console.warn = (...args) => {
  warnings.push(args.join(' '))
  originalWarn(...args)
}

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const VIEWS = ['Home', 'Time', 'Money', 'Affairs', 'Settings']
const BAD = [/undefined/, /NaN/, /\[object Object\]/, /\{[a-zA-Z]+\}/, /待实现/]

let failed = 0

for (const name of VIEWS) {
  let html = ''
  try {
    const mod = await vite.ssrLoadModule(`/src/views/${name}.vue`)
    const app = createSSRApp({ render: () => h(Suspense, null, { default: () => h(mod.default) }) })
    app.provide('config', config)
    app.provide('configErrors', [])
    html = await renderToString(app)
  } catch (error) {
    failed += 1
    console.log(`  ✗ ${name.padEnd(9)} 渲染抛异常：${error?.message || error}`)
    continue
  }

  // 只检查可见文本，排除脚本与样式里的合法出现
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')

  const hits = BAD.filter((re) => re.test(text)).map((re) => re.source)
  if (hits.length > 0) {
    failed += 1
    console.log(`  ✗ ${name.padEnd(9)} 文本里出现可疑内容：${hits.join('、')}`)
    for (const re of BAD.filter((rx) => rx.test(text))) {
      const at = text.search(re)
      console.log(`        …${text.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' ')}…`)
    }
  } else if (html.length < 400) {
    failed += 1
    console.log(`  ✗ ${name.padEnd(9)} 渲染结果过短（${html.length} 字符），疑似空页`)
  } else {
    console.log(`  ✓ ${name.padEnd(9)} 渲染正常，${html.length} 字符`)
  }
}

await vite.close()

console.warn = originalWarn

const vueWarnings = warnings.filter((line) => line.includes('[Vue warn]'))
if (vueWarnings.length > 0) {
  failed += 1
  console.log(`\n  ✗ 有 ${vueWarnings.length} 条 Vue 警告：`)
  for (const line of vueWarnings.slice(0, 10)) console.log(`      ${line.split('\n')[0]}`)
} else {
  console.log('\n  ✓ 无 Vue 警告')
}

console.log(`\n${failed === 0 ? '✓ 五个页面全部通过冒烟测试' : `✗ ${failed} 个页面有问题`}`)
if (failed > 0) process.exitCode = 1
