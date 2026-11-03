import { createApp } from 'vue'
import App from './App.vue'
import router from './router.js'
import { loadConfig } from './services/config.js'
import { configure } from './core/engine.js'
import { initCloud } from './services/cloud-sync.js'
import './styles/main.css'

/** 云端会话恢复/拉数据最多等这么久，网络不通也不许把首屏卡住 */
const CLOUD_BOOT_TIMEOUT_MS = 6000

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))])
}

/**
 * 启动顺序（工作指导书 3.5）：
 * 取配置 → 校验 → 注入引擎 → 恢复云同步会话 → 渲染页面。
 * 校验放在渲染之前，配置异常要在第一屏就看得见，不能藏到演示当天。
 * 云同步放在渲染之前，是为了让授权回调（?code=…）在路由守卫/首屏之前处理完，
 * 也避免先渲染一遍“未登录”再跳成已登录。
 */
async function bootstrap() {
  const { config, loadErrors } = await loadConfig()
  configure(config)

  await withTimeout(initCloud().catch(() => null), CLOUD_BOOT_TIMEOUT_MS)

  const app = createApp(App)
  app.provide('config', config)
  app.provide('configErrors', [...loadErrors, ...config.errors])
  app.use(router)
  app.mount('#app')
}

bootstrap()
