// src/lib/app-review.ts
// In-app "rate the app" logic. The native review overlay is rate-limited
// by the OS (Apple ~3/user/year, Google has its own quota) and silently
// no-ops when over quota or in non-store builds, so we gate ourselves to
// spend that quota on genuine high-intent moments. The manual Settings
// button bypasses the gate and opens the store listing directly.

export type ReviewReason = 'app_opens' | 'favorite'

export type ReviewGateState = {
  appOpens: number
  askCount: number
  lastAskedAt: string | null
}

// Tunable policy constants.
export const MIN_OPENS = 3            // floor: never auto-ask before this many opens
export const APP_OPENS_THRESHOLD = 5  // the app-opens trigger fires exactly here
export const COOLDOWN_DAYS = 60       // min gap between auto-asks
export const MAX_ASKS = 3             // lifetime cap on auto-asks

/**
 * Pure decision: may we fire an auto review prompt right now?
 * No I/O — caller supplies state, clock, reason, and platform flag.
 */
export function shouldAutoAsk(
  state: ReviewGateState,
  now: Date,
  reason: ReviewReason,
  isNative: boolean,
): boolean {
  if (!isNative) return false
  if (state.askCount >= MAX_ASKS) return false
  if (state.appOpens < MIN_OPENS) return false
  if (reason === 'app_opens' && state.appOpens !== APP_OPENS_THRESHOLD) return false
  if (state.lastAskedAt) {
    const last = new Date(state.lastAskedAt).getTime()
    const cooldownMs = COOLDOWN_DAYS * 24 * 60 * 60 * 1000
    if (!Number.isNaN(last) && now.getTime() - last < cooldownMs) return false
  }
  return true
}
