<script setup>
import { computed, inject } from 'vue'
import { useRoute } from 'vue-router'

const config = inject('config', {})
const configErrors = inject('configErrors', [])
const route = useRoute()

const tabs = [
  { path: '/', label: '出门' },
  { path: '/time', label: '时间' },
  { path: '/money', label: '花钱' },
  { path: '/affairs', label: '办事' },
]

const activePath = computed(() => route.path)

const versions = computed(() => config.versions || {})
const hasConfigError = computed(() => configErrors.length > 0)
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="app-header-inner">
        <RouterLink to="/" class="brand">
          <span class="brand-mark">决</span>
          <span class="brand-text">
            <strong>生活决策助手</strong>
            <small>深圳 · 一句话结论</small>
          </span>
        </RouterLink>

        <nav class="app-nav" aria-label="主导航">
          <RouterLink
            v-for="tab in tabs"
            :key="tab.path"
            :to="tab.path"
            class="nav-item"
            :class="{ active: activePath === tab.path }"
          >
            {{ tab.label }}
          </RouterLink>
          <RouterLink to="/settings" class="nav-item nav-icon" :class="{ active: activePath === '/settings' }">
            设置
          </RouterLink>
        </nav>
      </div>
    </header>

    <div v-if="hasConfigError" class="page" style="padding-bottom: 0">
      <div class="notice notice-error">
        <strong>配置异常</strong>：页面结论可能不可信。共 {{ configErrors.length }} 项待修。
        <ul class="error-list">
          <li v-for="(error, i) in configErrors.slice(0, 8)" :key="i">· {{ error }}</li>
        </ul>
      </div>
    </div>

    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <component :is="Component" />
      </RouterView>
    </main>

    <footer class="app-footer">
      <p>
        配置版本：指数 v{{ versions.indices || '—' }} · 税率 {{ versions.taxRules || '—' }} · 假期
        {{ versions.holidays || '—' }}
      </p>
      <p>登录后设置与记录同步保存在你的账号下；未登录时仅存在本机浏览器。数据与政策以官方最新公告为准。</p>
    </footer>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 40;
  background: rgba(245, 246, 248, 0.88);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}

.app-header-inner {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--text);
  min-width: 0;
}

.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--text);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 700;
  flex: none;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
  min-width: 0;
}

.brand-text strong {
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.brand-text small {
  font-size: 11px;
  color: var(--text-3);
}

.app-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 3px;
}

.nav-item {
  padding: 5px 13px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  transition: background 0.15s ease, color 0.15s ease;
  white-space: nowrap;
}

.nav-item:hover {
  color: var(--text);
}

.nav-item.active {
  background: var(--text);
  color: #fff;
}

.nav-icon {
  color: var(--text-3);
}

.app-main {
  flex: 1;
}

.app-footer {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 24px 16px 40px;
  font-size: 11px;
  line-height: 1.8;
  color: var(--text-3);
  text-align: center;
}

.error-list {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
}

@media (max-width: 600px) {
  .app-header-inner {
    gap: 8px;
  }

  .brand-text small {
    display: none;
  }

  /* 品牌名不许换行，改为压缩导航内边距——两行标题比挤一点更难看 */
  .brand-text strong {
    font-size: 13px;
  }

  .nav-item {
    padding: 4px 9px;
    font-size: 12px;
  }
}

@media (max-width: 400px) {
  .app-header-inner {
    padding: 10px 12px;
  }

  .brand-text strong {
    font-size: 12.5px;
  }

  .nav-item {
    padding: 4px 7px;
  }
}
</style>
