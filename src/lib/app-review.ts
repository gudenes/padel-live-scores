import { Capacitor } from '@capacitor/core'

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

const GATE_KEY = 'pn_review_gate'
const DEFAULT_STATE: ReviewGateState = { appOpens: 0, askCount: 0, lastAskedAt: null }

// Store identifiers.
const APP_STORE_ID = '6770290540'
const ANDROID_PACKAGE = 'com.padelnachos.app'

function readGate(): ReviewGateState {
  if (typeof window === 'undefined') return { ...DEFAULT_STATE }
  try {
    const raw = window.localStorage.getItem(GATE_KEY)
    if (!raw) return { ...DEFAULT_STATE }
    const parsed = JSON.parse(raw) as Partial<ReviewGateState>
    return {
      appOpens: typeof parsed.appOpens === 'number' ? parsed.appOpens : 0,
      askCount: typeof parsed.askCount === 'number' ? parsed.askCount : 0,
      lastAskedAt: typeof parsed.lastAskedAt === 'string' ? parsed.lastAskedAt : null,
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

function writeGate(state: ReviewGateState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(GATE_KEY, JSON.stringify(state))
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/** Count one native app open. Call once per boot. */
export function recordAppOpen(): void {
  const state = readGate()
  writeGate({ ...state, appOpens: state.appOpens + 1 })
}

// Dynamic import keeps the native-only plugin out of the web bundle and
// out of Vitest's resolution graph — mirrors native-init.ts's Firebase
// lazy-import pattern.
async function fireNativeReview(): Promise<void> {
  const { InAppReview } = await import('@capacitor-community/in-app-review')
  await InAppReview.requestReview()
}

/** Gated automatic path. No-ops unless shouldAutoAsk allows it. */
export async function requestReviewForReason(reason: ReviewReason): Promise<void> {
  const isNative = Capacitor.isNativePlatform()
  const state = readGate()
  if (!shouldAutoAsk(state, new Date(), reason, isNative)) return
  try {
    await fireNativeReview()
    writeGate({
      ...state,
      askCount: state.askCount + 1,
      lastAskedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[app-review] requestReview failed', err)
  }
}

function storeUrl(): string {
  const platform = Capacitor.getPlatform()
  const ios = `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`
  // Play Store has no stable deep-link to force the review dialog from a URL,
  // so Android lands on the listing page (where the rating stars live) rather
  // than a write-review prompt like iOS's ?action=write-review.
  const android = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`
  if (platform === 'ios') return ios
  if (platform === 'android') return android
  // Web: best-effort UA sniff so desktop/mobile web land on a sane store.
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)) return android
  return ios
}

/** Manual path (Settings button). Always opens the store listing. */
export function openRateFlow(): void {
  if (typeof window === 'undefined') return
  window.open(storeUrl(), '_blank', 'noopener,noreferrer')
}
