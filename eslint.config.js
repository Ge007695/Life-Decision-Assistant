import js from '@eslint/js'

/**
 * 内核层纪律交给工具守（工作指导书 10.2）。
 * src/core/** 是纯函数层：不许取数、不许碰 DOM、不许读本地存储。
 * 一个人的代码没人复核，"我记得不在这里写网络请求"是靠不住的。
 */
const CORE_FORBIDDEN = [
  { name: 'fetch', message: '内核层禁止发起网络请求，取数留在 src/services/。' },
  { name: 'XMLHttpRequest', message: '内核层禁止发起网络请求。' },
  { name: 'window', message: '内核层禁止触碰 DOM 与浏览器全局对象。' },
  { name: 'document', message: '内核层禁止触碰 DOM。' },
  { name: 'localStorage', message: '内核层禁止读写本地存储，交给 services/storage.js。' },
  { name: 'sessionStorage', message: '内核层禁止读写本地存储。' },
  { name: 'navigator', message: '内核层禁止读取浏览器环境。' },
]

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'scripts/backtest/data/**', 'output/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-globals': ['error', ...CORE_FORBIDDEN],
    },
  },
]
