import { createApp } from 'vue'
import App from './App.vue'
import router from './router.js'
import { loadConfig } from './services/config.js'
import { configure } from './core/engine.js'
import './styles/main.css'

/**
 * 启动顺序（工作指导书 3.5）：
 * 取配置 → 校验 → 注入引擎 → 渲染页面。
 * 校验放在渲染之前，配置异常要在第一屏就看得见，不能藏到演示当天。
 */
async function bootstrap() {
  const { config, loadErrors } = await loadConfig()
  configure(config)

  const app = createApp(App)
  app.provide('config', config)
  app.provide('configErrors', [...loadErrors, ...config.errors])
  app.use(router)
  app.mount('#app')
}

bootstrap()
