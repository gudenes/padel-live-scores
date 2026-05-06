// iOS PWA install nudge helpers.
//
// On iOS, Web Push only works inside an installed PWA (added to home
// screen + opened via the icon → display-mode: standalone). All iOS
// browsers (Safari, Chrome iOS / CriOS, Firefox iOS / FxiOS, Edge iOS /
// EdgiOS) are forced to use WebKit, so they all hit the same restriction.
//
// `isIOSSafariTab()` returns true for the platforms that need our
// install nudge: iPhone/iPad in a regular browser tab. It returns
// false everywhere else, including iOS PWA standalone (push works
// natively there) and all non-iOS platforms.

export function isIOSSafariTab(): boolean {
  if (typeof window === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = (typeof navigator !== 'undefined' ? navigator : w.navigator) as any
  if (!nav) return false
  const ua = typeof nav.userAgent === 'string' ? nav.userAgent : ''
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  if (!isIOS) return false
  // Webkit-forced iOS browsers all need the same install nudge.
  const isWebKitBrowser = /Safari/.test(ua) || /CriOS|FxiOS|EdgiOS/.test(ua)
  if (!isWebKitBrowser) return false
  // Already installed as PWA → push works; no nudge needed.
  // Two ways iOS surfaces standalone mode (legacy + standard).
  const standaloneLegacy = nav.standalone === true
  const standaloneCss =
    typeof w.matchMedia === 'function' &&
    w.matchMedia('(display-mode: standalone)').matches
  if (standaloneLegacy || standaloneCss) return false
  return true
}

// ── Entry point + event dispatch ──────────────────────────────────
//
// Call sites use tryEnablePushOrShowInstallNudge() instead of calling
// anonPush.ensureSubscription() directly. On iOS Safari (regular tab)
// it dispatches an event to mount <PWAInstallNudge />; everywhere else
// it falls through to the existing push registration path.

import {
  ensureSubscription as libEnsureSubscription,
  type AnonBookmark,
} from './anon-push'

export const PWA_NUDGE_EVENT = 'pn-pwa-nudge-show'
const NUDGE_SHOWN_KEY = 'pn_pwa_nudge_shown'

export type PWANudgeTrigger =
  | 'first_follow'
  | 'picker'
  | 'bookmark_toast'

export interface TryEnablePushResult {
  enabled: boolean       // true if the native push subscription is now active
  nudgeShown: boolean    // true if we showed the install modal instead
}

/**
 * Has the user already dismissed the install nudge once on this device?
 * Once true, the nudge never re-shows — same one-and-done pattern as
 * the LoginCtaSheet and WelcomeStrip dismissals.
 */
function isNudgeAlreadyShown(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(NUDGE_SHOWN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Mark the nudge as shown so future calls don't re-prompt.
 * Called by the modal component on either button tap.
 */
export function markNudgeShown(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(NUDGE_SHOWN_KEY, '1')
  } catch { /* private mode — accept that we'll re-show on this session */ }
}

interface NudgeShowDetail {
  trigger: PWANudgeTrigger
}

/**
 * Dispatch the show event. The mounted <PWAInstallNudge /> listens and
 * sets its visible state.
 */
export function showPWAInstallNudge(trigger: PWANudgeTrigger): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<NudgeShowDetail>(PWA_NUDGE_EVENT, { detail: { trigger } }),
  )
}

/**
 * Single entry point used by every call site that wants to enable push.
 *
 * - On iOS Safari (regular tab): if the install nudge hasn't been
 *   dismissed yet, dispatch the show event. Returns
 *   { enabled: false, nudgeShown: true|false }.
 * - Everywhere else: falls through to anonPush.ensureSubscription.
 *   Returns { enabled: <result>, nudgeShown: false }.
 */
export async function tryEnablePushOrShowInstallNudge(
  initialBookmarks: AnonBookmark[],
  trigger: PWANudgeTrigger,
): Promise<TryEnablePushResult> {
  if (isIOSSafariTab()) {
    if (isNudgeAlreadyShown()) {
      return { enabled: false, nudgeShown: false }
    }
    showPWAInstallNudge(trigger)
    return { enabled: false, nudgeShown: true }
  }
  const enabled = await libEnsureSubscription(initialBookmarks)
  return { enabled, nudgeShown: false }
}
