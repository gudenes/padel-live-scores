// src/lib/persist-fcm-token.ts
//
// POST the device's FCM token to /api/user/native-push-subscriptions.
//
// Called from two places:
//   1. native-init.ts — when @capacitor-firebase/messaging first hands
//      us the token at app boot.
//   2. AuthProvider — when the user signs in (or re-signs in). The
//      boot-time POST in (1) fails with 401 if the user wasn't yet
//      authenticated; re-firing the POST from AuthProvider once we
//      know they're signed in catches that race.
//
// The endpoint upserts on `(user_id, device_token)`, so re-POSTing a
// token that's already stored is a no-op. Safe to call repeatedly.
//
// `padelnachos:fcm-token` localStorage cache is the contract between
// the producer (native-init) and the consumer (AuthProvider). If the
// cached token is missing, the call is a no-op — nothing to persist.

import { Capacitor } from '@capacitor/core'

const TOKEN_CACHE_KEY = 'padelnachos:fcm-token'

export function getCachedFcmToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_CACHE_KEY)
  } catch {
    return null
  }
}

export function cacheFcmToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_CACHE_KEY, token)
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}

/**
 * POST the token to the backend. Returns true on success, false on any
 * failure (including 401 if the user isn't authenticated yet — that's
 * expected during app boot before the auth session loads).
 */
export async function postFcmToken(token: string): Promise<boolean> {
  try {
    const res = await fetch('/api/user/native-push-subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: Capacitor.getPlatform(), // 'android' | 'ios' | 'web'
        deviceToken: token,
        locale: navigator.language?.split('-')[0] || 'en',
      }),
    })
    return res.ok
  } catch (err) {
    console.warn('[persist-fcm-token] POST failed', err)
    return false
  }
}

/**
 * Convenience: read cached token + POST it. Used by AuthProvider after
 * a sign-in transition to catch the boot-time race.
 */
export async function persistCachedFcmToken(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const cached = getCachedFcmToken()
  if (!cached) return
  await postFcmToken(cached)
}
