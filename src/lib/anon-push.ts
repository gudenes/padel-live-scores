// Anonymous Web Push helpers — client-side only.
//
// This module has two layers:
//   1. PURE helpers (this commit): support detection + payload builders.
//      Unit-tested against vitest in node env.
//   2. SIDE-EFFECTFUL helpers (next commit): ensureSubscription,
//      addBookmark, removeBookmark, unsubscribe, migrateToUser. These
//      touch localStorage, the Notification API, the service worker,
//      and `/api/anon/*`. They're async, mostly fire-and-forget, and
//      gated on `pn_consent.push === true` AND `Notification.permission`.

export type AnonBookmarkType = 'player' | 'match'

export interface AnonBookmark {
  type: AnonBookmarkType
  target_id: string
}

export interface MigrationPayload {
  device_id: string
}

/**
 * Builds the request body for POST /api/anon/push-subscriptions/migrate.
 * Returns null if there's no device_id to migrate (nothing to do).
 */
export function buildMigrationPayload(deviceId: string | null): MigrationPayload | null {
  if (!deviceId) return null
  return { device_id: deviceId }
}

/**
 * Returns true when the browser supports the Web Push pipeline:
 *   - Service Worker
 *   - Push Manager
 *   - Notification API
 *
 * iOS Safari typically returns false unless the page is installed as a
 * PWA — that's the documented v1 gap (see spec §non-goals). Anything
 * non-browser (node, tests) returns false too.
 */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  if (typeof w.Notification === 'undefined') return false
  if (typeof w.PushManager === 'undefined') return false
  if (typeof navigator === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (navigator as any).serviceWorker === 'undefined') return false
  return true
}

// ── Side-effectful helpers ────────────────────────────────────────
//
// All of the below are no-ops when:
//   - typeof window === 'undefined' (SSR)
//   - isPushSupported() returns false (browser missing APIs)
// In addition, ensureSubscription is a no-op when the user hasn't
// granted push consent (caller checks via useConsent before calling).

const DEVICE_ID_KEY = 'pn_device_id'
const ENDPOINT_KEY = 'pn_anon_push_endpoint'

function getOrCreateDeviceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(DEVICE_ID_KEY)
  } catch {
    return null
  }
}

// urlBase64 → Uint8Array, used by pushManager.subscribe(applicationServerKey).
// Same util the existing usePushNotifications hook ships.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * Register a Web Push subscription for the anonymous device and POST it
 * to the server with the user's current bookmark set. Triggers the
 * native browser permission prompt if Notification.permission is
 * 'default'.
 *
 * Returns true if subscription is now active. Caller is responsible for
 * checking pn_consent.push BEFORE calling this — we don't double-check
 * here because callers (NotificationPromptSheet, BookmarkToast) often
 * have additional context for the UX flow.
 */
export async function ensureSubscription(initialBookmarks: AnonBookmark[]): Promise<boolean> {
  if (!isPushSupported()) return false

  // Permission prompt — only fire if not already decided.
  let permission = Notification.permission
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission()
    } catch {
      return false // iOS PWA edge case
    }
  }
  if (permission !== 'granted') return false

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidKey) {
    console.error('[anon-push] VAPID public key not configured')
    return false
  }

  const deviceId = getOrCreateDeviceId()
  if (!deviceId) return false

  let registration: ServiceWorkerRegistration
  try {
    registration = await navigator.serviceWorker.ready
  } catch {
    return false
  }

  let subscription: PushSubscription
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    })
  } catch (err) {
    console.error('[anon-push] pushManager.subscribe failed', err)
    return false
  }

  const subJson = subscription.toJSON()
  const keys = subJson.keys as { p256dh?: string; auth?: string } | undefined
  if (!keys?.p256dh || !keys?.auth) return false

  const res = await fetch('/api/anon/push-subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: deviceId,
      endpoint: subscription.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      user_agent: navigator.userAgent,
      bookmarks: initialBookmarks,
    }),
  }).catch(() => null)

  if (!res || !res.ok) {
    console.error('[anon-push] register POST failed')
    return false
  }

  // Cache the endpoint so unsubscribe knows what to send.
  try {
    localStorage.setItem(ENDPOINT_KEY, subscription.endpoint)
  } catch {}
  return true
}

/** Add a single bookmark. No-op if no device_id is registered. */
export async function addBookmark(b: AnonBookmark): Promise<void> {
  const deviceId = getDeviceId()
  if (!deviceId) return
  await fetch('/api/anon/push-subscriptions/bookmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, type: b.type, target_id: b.target_id }),
  }).catch(() => null)
}

/** Remove a single bookmark. No-op if no device_id is registered. */
export async function removeBookmark(b: AnonBookmark): Promise<void> {
  const deviceId = getDeviceId()
  if (!deviceId) return
  await fetch('/api/anon/push-subscriptions/bookmarks', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, type: b.type, target_id: b.target_id }),
  }).catch(() => null)
}

/**
 * Unsubscribe from Web Push and remove the server-side subscription
 * for this device. Used when the user revokes push consent.
 */
export async function unsubscribe(): Promise<void> {
  if (typeof window === 'undefined') return
  let endpoint: string | null = null
  try {
    endpoint = localStorage.getItem(ENDPOINT_KEY)
  } catch {}
  if (endpoint) {
    await fetch('/api/anon/push-subscriptions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => null)
    try { localStorage.removeItem(ENDPOINT_KEY) } catch {}
  }
  // Best-effort browser-side unsubscribe — keeps the OS notification
  // permission unchanged but voids the push subscription.
  if (isPushSupported()) {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) await sub.unsubscribe()
    } catch {}
  }
}

/**
 * Migrate this device's anon subscriptions to the now-signed-in user.
 * Called from the existing useFollowing sign-in migration block.
 *
 * Failures are logged but not thrown — the surrounding sign-in flow
 * shouldn't break if migration hits a network blip. Anon rows that
 * fail to migrate stay in place; the 90-day cleanup cron eventually
 * drops them, or the user can re-subscribe under their user_id which
 * silently absorbs them on the next migrate retry.
 */
export async function migrateToUser(): Promise<void> {
  const deviceId = getDeviceId()
  const payload = buildMigrationPayload(deviceId)
  if (!payload) return
  try {
    const res = await fetch('/api/anon/push-subscriptions/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      console.error('[anon-push] migrateToUser non-ok response', res.status)
    }
  } catch (err) {
    console.error('[anon-push] migrateToUser network error', err)
  }
}
