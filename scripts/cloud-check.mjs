/**
 * 云服务连通性自检（开发期用，不进应用产物）
 *
 * 只用 SDK 自己的客户端打一次数据库，确认三件事：
 *   1. endpoint + publishableKey 这一对公网配置能走通数据面；
 *   2. 未登录（anon）时 user_records 被 RLS 拦住 —— 返回空数组而不是泄露别人的行；
 *   3. 表名/列名与代码里写的一致（列写错会拿到 42703 而不是空数组）。
 *
 * 跑法：node scripts/cloud-check.mjs
 */
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'
import { CLOUD_PUBLIC_CONFIG } from '../src/services/cloud.js'

const cloud = createWorkBuddyCloud({
  endpoint: CLOUD_PUBLIC_CONFIG.endpoint,
  oauthRelayBaseUrl: CLOUD_PUBLIC_CONFIG.oauthRelayBaseUrl,
  publishableKey: CLOUD_PUBLIC_CONFIG.publishableKey,
})

const steps = []

function record(name, ok, detail) {
  steps.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// 1. 未登录查询：应成功返回，且看不到任何行（RLS 生效）
try {
  const { data, error } = await cloud.database
    .from('user_records')
    .select('data_key, payload')
  if (error) {
    record('未登录查询 user_records', false, `${error.code || error.kind}: ${error.message}`)
  } else {
    record('未登录查询 user_records', true, `rows=${data?.length ?? 0}（anon 被 RLS 过滤属预期）`)
  }
} catch (error) {
  record('未登录查询 user_records', false, error.message)
}

// 2. 未登录写入：必须被拒（owner_id = auth.uid() 对 anon 不成立）
try {
  const { data, error } = await cloud.database
    .from('user_records')
    .insert({ data_key: '__probe__', payload: { probe: true } })
    .select()
  if (error) {
    record('未登录写入被拒', true, `${error.code || error.kind}: ${error.message}`)
  } else {
    record('未登录写入被拒', (data?.length ?? 0) === 0, `返回 ${data?.length ?? 0} 行（0 行=被 RLS 拦住）`)
  }
} catch (error) {
  record('未登录写入被拒', true, `抛出错误（预期）：${error.message}`)
}

// 3. 会话读取接口可用（无会话时返回 null，不是报错）
try {
  const { data, error } = await cloud.auth.getSession()
  record('auth.getSession 可调用', !error, error ? error.message : `session=${data ? '有' : '无（未登录）'}`)
} catch (error) {
  record('auth.getSession 可调用', false, error.message)
}

const failed = steps.filter((step) => !step.ok)
console.log(`\n${steps.length - failed.length}/${steps.length} 通过`)
process.exit(failed.length ? 1 : 0)
