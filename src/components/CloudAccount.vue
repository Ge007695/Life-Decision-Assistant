<script setup>
/**
 * 组件层 · 云同步账号
 *
 * 只负责“登录 / 登出 / 显示同步状态”，同步逻辑全在 services/cloud-sync.js。
 * 明确两件事，不含糊：
 *   1. 没登录就是“只存本机”，页面上直说，不假装已上云；
 *   2. 同步失败要显示原因，并且改动仍留在本机等补传，不静默丢。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  cloudState,
  maskPhone,
  requestPhoneCode,
  retrySync,
  signInWithWorkBuddy,
  signOutCloud,
  submitPhoneCode,
} from '@/services/cloud-sync.js'

const PHONE_RE = /^1\d{10}$/
const COUNTDOWN_S = 60

const phone = ref('')
const phoneError = ref('')
const code = ref('')
const challenge = ref(null)
const sending = ref(false)
const submitting = ref(false)
const countdown = ref(0)
const oauthLoading = ref(false)
const done = ref('')

let countdownTimer = null

const signedIn = computed(() => !!cloudState.user)
const displayName = computed(() => {
  const user = cloudState.user
  if (!user) return ''
  if (user.name) return user.name
  if (user.phone) return maskPhone(user.phone)
  if (user.email) return user.email.split('@')[0]
  return '已登录账户'
})

const phaseText = computed(() => {
  switch (cloudState.phase) {
    case 'syncing':
      return '同步中…'
    case 'synced':
      return `已同步 ${cloudState.syncedCount} 项记录`
    case 'error':
      return '同步未完成'
    case 'signed-out':
      return '未登录，只存本机'
    default:
      return '准备中…'
  }
})

const phaseClass = computed(() => {
  if (cloudState.phase === 'synced') return 'chip-lv4'
  if (cloudState.phase === 'error') return 'chip-lv1'
  if (cloudState.phase === 'syncing') return 'chip-lv3'
  return 'chip-lv0'
})

const lastSyncedText = computed(() => {
  if (!cloudState.lastSyncedAt) return ''
  const date = new Date(cloudState.lastSyncedAt)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `今天 ${hh}:${mm}`
})

function onPhoneInput() {
  phoneError.value = ''
}

function startCountdown() {
  countdown.value = COUNTDOWN_S
  if (countdownTimer) clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }, 1000)
}

async function sendCode() {
  if (sending.value || countdown.value > 0) return
  const value = phone.value.trim()
  if (!PHONE_RE.test(value)) {
    phoneError.value = '请输入正确的 11 位手机号'
    return
  }
  phoneError.value = ''
  sending.value = true
  try {
    const sent = await requestPhoneCode(value)
    // 记下发码用的号码：验码时必须与发码一致，改号后要求重新获取
    challenge.value = { ...sent, phone: value }
    startCountdown()
  } catch {
    // 错误信息已写进 cloudState.loginError，模板直接显示
  } finally {
    sending.value = false
  }
}

async function submit() {
  if (submitting.value) return
  const value = phone.value.trim()
  if (!PHONE_RE.test(value)) {
    phoneError.value = '请输入正确的 11 位手机号'
    return
  }
  if (!challenge.value || challenge.value.phone !== value) {
    cloudState.loginError = '请先获取当前手机号的验证码'
    return
  }
  const token = code.value.trim()
  if (!token) {
    cloudState.loginError = '请填写短信验证码'
    return
  }

  submitting.value = true
  cloudState.loginError = ''
  try {
    await submitPhoneCode(value, challenge.value, token)
    done.value = '登录成功，正在载入云端记录…'
    setTimeout(() => window.location.reload(), 700)
  } catch {
    /* 错误信息在 cloudState.loginError */
  } finally {
    submitting.value = false
  }
}

async function workbuddyLogin() {
  if (oauthLoading.value) return
  oauthLoading.value = true
  cloudState.loginError = ''
  try {
    await signInWithWorkBuddy()
    // 成功后浏览器会跳走，无需收尾
  } catch {
    oauthLoading.value = false
  }
}

async function logout() {
  await signOutCloud()
  done.value = '已退出登录，本机记录已清空，云端记录保留。'
  setTimeout(() => window.location.reload(), 700)
}

function retry() {
  retrySync()
}

onBeforeUnmount(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})
</script>

<template>
  <section class="card stack-sm">
    <div class="row-between">
      <h2 class="section-title section-flush">云同步</h2>
      <span class="chip" :class="phaseClass">{{ phaseText }}</span>
    </div>

    <!-- 已登录 -->
    <template v-if="signedIn">
      <div class="account-row">
        <span class="avatar" aria-hidden="true">{{ displayName.slice(0, 1) }}</span>
        <div class="account-main">
          <strong class="account-name">{{ displayName }}</strong>
          <span v-if="lastSyncedText" class="faint tiny">最近同步：{{ lastSyncedText }}</span>
        </div>
      </div>

      <p v-if="cloudState.phase === 'error'" class="notice notice-error">
        {{ cloudState.message }}
      </p>
      <p v-else-if="cloudState.pendingCount > 0" class="faint tiny">
        还有 {{ cloudState.pendingCount }} 项改动等待上传。
      </p>
      <p v-else class="faint tiny">
        城市与体感设置、工资测算入参、每日清单勾选、体感反馈都会自动存到云端；
        换设备或清理缓存后，登录同一账号即可恢复。
      </p>

      <div class="row">
        <button type="button" class="btn btn-sm" :disabled="cloudState.phase === 'syncing'" @click="retry">
          立即同步
        </button>
        <button type="button" class="btn btn-sm btn-ghost" @click="logout">退出登录</button>
      </div>
      <p class="faint tiny">退出登录会清空本机记录（云端保留），避免下一位使用者看到你的数据。</p>
    </template>

    <!-- 未登录 -->
    <template v-else>
      <p class="small muted">
        登录后数据会存在云端，换手机或清缓存可恢复。不登录也能用，但只保存在这台设备的浏览器里。
      </p>

      <div class="field">
        <label class="field-label" for="cloud-phone">手机号</label>
        <input
          id="cloud-phone"
          v-model="phone"
          type="tel"
          inputmode="numeric"
          autocomplete="tel"
          maxlength="11"
          placeholder="11 位手机号"
          :aria-invalid="!!phoneError"
          @input="onPhoneInput"
        />
        <p v-if="phoneError" class="field-error">{{ phoneError }}</p>
      </div>

      <div class="field">
        <label class="field-label" for="cloud-code">短信验证码</label>
        <div class="code-row">
          <input
            id="cloud-code"
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="6 位验证码"
          />
          <button
            type="button"
            class="btn btn-sm"
            :disabled="sending || countdown > 0 || submitting"
            @click="sendCode"
          >
            {{ countdown > 0 ? `${countdown}s 后重发` : sending ? '发送中…' : '获取验证码' }}
          </button>
        </div>
      </div>

      <div class="row">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="submitting || !code.trim()"
          @click="submit"
        >
          {{ submitting ? '登录中…' : '登录 / 注册' }}
        </button>
        <span class="faint tiny">未注册的手机号验证后自动创建账号</span>
      </div>

      <div class="or"><span>或</span></div>

      <button type="button" class="btn btn-sm btn-block" :disabled="oauthLoading" @click="workbuddyLogin">
        {{ oauthLoading ? '正在跳转…' : '使用 WorkBuddy 登录' }}
      </button>

      <p v-if="cloudState.loginError" class="notice notice-error">{{ cloudState.loginError }}</p>
      <p v-if="done" class="faint tiny" role="status">{{ done }}</p>
    </template>
  </section>
</template>

<style scoped>
.section-flush {
  margin: 0;
}

.account-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: var(--surface-2);
}

.avatar {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--accent-weak);
  color: var(--accent-dark);
  font-weight: 650;
  font-size: 15px;
}

.account-main {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
  min-width: 0;
}

.account-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.code-row input {
  flex: 1;
  min-width: 0;
}

.code-row .btn {
  flex: none;
  white-space: nowrap;
}

.or {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-3);
  font-size: 12px;
}

.or::before,
.or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}

.btn-block {
  width: 100%;
  justify-content: center;
}
</style>
