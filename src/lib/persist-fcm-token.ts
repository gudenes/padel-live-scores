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
 * Result of posting the FCM token to the backend.
 *
 * `status` discriminates 401 (auth missing — expected during boot before
 * AuthProvider has hydrated the session) from 5xx / network failures, so
 * the UI can surface a specific message instead of swallowing every miss
 * as the same opaque failure.
 *
 *   { ok: true, status: 200 }                — stored
 *   { ok: false, status: 401 }               — auth missing
 *   { ok: false, status: 5xx }               — server error
 *   { ok: false, status: null, error: '…' }  — network / fetch threw
 */
export type PostFcmTokenResult =
  | { ok: true; status: number }
  | { ok: false; status: number; error?: undefined }
  | { ok: false; status: null; error: string }

export async function postFcmToken(token: string): Promise<PostFcmTokenResult> {
  try {
    const res = await fetch('/api/user/native-push-subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: Capacitor.getPlatform(), // 'android' | 'ios' | 'web'
        deviceToken: token,
        locale: navigator.language?.split('-')[0] || 'en',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    })
    if (res.ok) return { ok: true, status: res.status }
    console.warn('[persist-fcm-token] POST returned', res.status)
    return { ok: false, status: res.status }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[persist-fcm-token] POST threw', err)
    return { ok: false, status: null, error: message }
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
