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
