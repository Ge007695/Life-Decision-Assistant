import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 用 hash 路由：静态托管到 Vercel / GitHub Pages / 校内任意目录时，
 * 刷新子页面都不会 404，不需要额外的重写规则或 404.html。
 * 本项目是纯前端工具站，URL 里带 # 不影响任何验收要求。
 */
const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('./views/Home.vue'),
    meta: { title: '今天', nav: '出门' },
  },
  {
    path: '/time',
    name: 'time',
    component: () => import('./views/Time.vue'),
    meta: { title: '时间', nav: '时间' },
  },
  {
    path: '/money',
    name: 'money',
    component: () => import('./views/Money.vue'),
    meta: { title: '花钱', nav: '花钱' },
  },
  {
    path: '/affairs',
    name: 'affairs',
    component: () => import('./views/Affairs.vue'),
    meta: { title: '办事', nav: '办事' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('./views/Settings.vue'),
    meta: { title: '设置', nav: '设置' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const title = to.meta?.title
  document.title = title ? `${title} · 生活决策助手` : '生活决策助手'
})

export default router
