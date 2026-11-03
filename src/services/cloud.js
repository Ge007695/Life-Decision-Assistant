/**
 * 服务层 · 云服务客户端（唯一实例）
 *
 * endpoint / publishableKey / oauthRelayBaseUrl 来自 WorkBuddy 云服务开通结果的 publicConfig。
 * 这三个值本来就是发给浏览器用的公开配置：publishableKey 只标识“是哪个应用”，
 * 不带任何权限，服务端还会校验请求来源域名，所以可以随前端产物一起发布。
 * 真正的环境凭据在服务端，前端永远拿不到，也不该拿。
 *
 * 全应用只初始化一次，auth / database 共用这一个客户端。
 */
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'

export const CLOUD_PUBLIC_CONFIG = {
  endpoint: 'https://life-decision-assistant-80560.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_DaCrZD6FnJqkfinATZNJpJ_ciCmRuzdrUUJuI50EkrfwKgg7Nmyb2OZ',
}

export const cloud = createWorkBuddyCloud({
  endpoint: CLOUD_PUBLIC_CONFIG.endpoint,
  oauthRelayBaseUrl: CLOUD_PUBLIC_CONFIG.oauthRelayBaseUrl,
  publishableKey: CLOUD_PUBLIC_CONFIG.publishableKey,
})

export default cloud
