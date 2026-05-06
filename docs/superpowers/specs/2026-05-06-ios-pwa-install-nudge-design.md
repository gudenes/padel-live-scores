# iOS PWA Install Nudge — design

**Date:** 2026-05-06
**Status:** Approved (brainstorming)

## Background

Web Push notifications work on Android Chrome and desktop browsers in any tab, but iOS forbids push outside an installed PWA — Apple deliberately blocks `Notification.requestPermission()` in regular Safari tabs (and in any iOS browser, since they're all forced to use WebKit under the hood: Chrome iOS, Firefox iOS, Edge iOS). Once a user adds the site to their home screen via Safari's Share → "Add to Home Screen" and opens it from the icon, push starts working.

Today, when an iOS Safari user tries to enable push (cookie banner accept-all, picker notification sheet, or bookmark toast "Enable alerts"), our code silently no-ops because `isPushSupported()` returns false. The user sees the modal close with nothing happening — broken-promise UX.

For a sports app where 30–50% of an EU/LATAM padel audience is on iOS, this is a meaningful gap: half the audience has no path to enable notifications without explicit help. The PWA install is the only fix Apple permits.

## Goals

1. iOS Safari users who try to enable push get a focused install nudge modal explaining how to add the app to their home screen, with an animated visual showing the steps.
2. Modal fires from all three places where push enablement is currently attempted (cookie banner accept-all, picker notification sheet, bookmark toast).
3. Single shared component + helper — no duplicated detection logic across call sites.
4. Modal dismissal respected: shown once per device unless localStorage cleared.
5. Localised across all 5 locales (en/es/pt/it/fr).
6. Telemetry on shown/dismissed events to measure install conversion.

## Non-goals

- macOS Safari install nudge. Different mechanic (menu-driven), separate audience priority. Defer.
- Persistent "Install app" banner outside of the consent flow. Lower-conversion approach; layer on later if A's conversion underperforms.
- Auto-detection of "user installed and returned" → fire a thank-you toast. Possible but not worth the complexity for v1.
- Re-prompting after N days. Once dismissed, never re-shown — respects user choice; mirrors the pattern of other dismissals (`pn_login_cta_shown`, `pn_welcome_strip_dismissed`).
- Native iOS app (separate scope; this spec is purely the install nudge for the existing PWA).

## User flow

```
iOS Safari user (regular tab, not yet installed)
  → taps "Accept all" on cookie banner with push category on
  OR taps "Enable" on picker notification sheet
  OR taps "Enable alerts" on bookmark toast
  → tryEnablePushOrShowInstallNudge() runs
    → isIOSSafariTab() === true → opens <PWAInstallNudge />
  → User sees modal:
       Title: "Get notifications on iPhone"
       Body: "Add PadelNachos to your home screen — takes 5 seconds."
       Animated mini-iPhone showing tap-Share → sheet-up → highlight Add-to-Home-Screen
       Buttons: [Maybe later] [Got it]
  → User taps either → pn_pwa_nudge_shown='1' → modal closes → never re-shown

User who follows the instructions
  → exits app
  → taps Share → Add to Home Screen → Add
  → returns later via the home-screen icon (display-mode: standalone)
  → isIOSSafariTab() now returns false (standalone detected)
  → push enablement works as on Android: native permission prompt fires, anon push registers

Non-iOS-Safari user (Android Chrome, desktop, iOS PWA standalone)
  → tryEnablePushOrShowInstallNudge() falls through to existing push flow
  → no install nudge ever shown
```

## Architecture

### Single entry point

```ts
// src/lib/pwa-install.ts

export function isIOSSafariTab(): boolean
export function showPWAInstallNudge(): void          // dispatches custom event
export async function tryEnablePushOrShowInstallNudge(
  initialBookmarks: AnonBookmark[],
): Promise<{ enabled: boolean; nudgeShown: boolean }>
```

`tryEnablePushOrShowInstallNudge`:
1. If `isIOSSafariTab()` → check `pn_pwa_nudge_shown`; if not yet shown, dispatch event to mount the modal; return `{ enabled: false, nudgeShown: true }` (or false if already dismissed).
2. Else → call existing `anonPush.ensureSubscription(initialBookmarks)`; return `{ enabled: <result>, nudgeShown: false }`.

This is the ONE function each of the three call sites (cookie banner, picker, bookmark toast) calls. The branching logic lives once.

### Component

```tsx
// src/components/PWAInstallNudge.tsx

export function PWAInstallNudge()
// Listens for the 'pn-pwa-nudge-show' custom event, mounts modal.
// Renders nothing when not active.
// Mounts globally in the locale layout (alongside ConsentBanner).
```

The component owns its visibility state. The lib helper dispatches a custom event to show; the modal's two buttons dismiss locally and write `pn_pwa_nudge_shown='1'`.

### Files

**New:**
- `src/lib/pwa-install.ts` — pure detection + entry-point helper
- `src/lib/__tests__/pwa-install.test.ts` — unit tests for `isIOSSafariTab()` (UA matrix)
- `src/components/PWAInstallNudge.tsx` — the modal + animated mini-iPhone

**Modified:**
- `src/app/[locale]/layout.tsx` — mount `<PWAInstallNudge />`
- `src/components/consent/ConsentBanner.tsx` — call `tryEnablePushOrShowInstallNudge` when push is being granted
- `src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx` — replace direct `ensureSubscription` call with `tryEnablePushOrShowInstallNudge`
- `src/components/BookmarkToast.tsx` — anon `handleCta` calls `tryEnablePushOrShowInstallNudge`
- `src/messages/{en,es,pt,it,fr}.json` — `consent.pwaInstall.*` namespace

## Detection logic

```ts
export function isIOSSafariTab(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  // All iOS browsers use WebKit and have the same restriction.
  // CriOS = Chrome iOS, FxiOS = Firefox iOS, EdgiOS = Edge iOS.
  const isWebKitBrowser = /Safari/.test(ua) || /CriOS|FxiOS|EdgiOS/.test(ua)
  const isStandalone =
    (window.navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  return isIOS && isWebKitBrowser && !isStandalone
}
```

iPad on iPadOS 13+ identifies as Mac Safari by default; we accept the small false-negative rate (very few iPads run install-eligible iOS at this point and Apple makes them request the desktop site by default). Could be tightened later via `navigator.maxTouchPoints` if data shows it matters.

## Component structure

`PWAInstallNudge` (~200 lines):

- Bottom sheet, modal backdrop, brand-matched chunky clip-paths
- Mounts when `pn-pwa-nudge-show` custom event fires; reads `pn_pwa_nudge_shown` to gate future shows
- Header: green chunky badge with download-arrow icon
- Title + body from i18n
- **Animated mini-iPhone** (CSS keyframe animation, 3-second loop):
  - Static iPhone frame (220×260, dark inner screen, fake Safari toolbar at bottom)
  - Page content visible at top (PadelNachos logo + 2 fake match rows for context)
  - Animation phase 1 (0–25%): green pulsing finger hovers over Share button
  - Animation phase 2 (25–50%): finger contracts to tap; share sheet slides up from bottom
  - Animation phase 3 (50–80%): share sheet fully visible; "Add to Home Screen" row highlights with green pulse
  - Animation phase 4 (80–100%): share sheet slides back down, finger fades; loop restarts
  - All elements localised via real DOM text — no baked-in images
- Two buttons: **Maybe later** (ghost grey) / **Got it** (green primary)

Both buttons:
1. Set `pn_pwa_nudge_shown='1'` in localStorage (try/catch for private mode)
2. Fire `pwa_install_nudge_dismissed` PostHog event with `{ button }` property
3. Close the modal

On show, fires `pwa_install_nudge_shown` PostHog event once per session.

## i18n

New `consent.pwaInstall` namespace (under existing `consent.*` parent):

```json
"pwaInstall": {
  "title": "Get notifications on iPhone",
  "body": "Add PadelNachos to your home screen — takes 5 seconds.",
  "shareLabel": "Tap Share at the bottom",
  "addLabel": "Tap Add to Home Screen",
  "openLabel": "Open the app from your home screen",
  "maybeLater": "Maybe later",
  "gotIt": "Got it"
}
```

7 keys × 5 locales = 35 string entries. Translated using the same convention as the cookie banner namespace (descriptive paths, no plurals).

## Telemetry

Two events fired through PostHog (gated on `pn_consent.analytics === true`):

- `pwa_install_nudge_shown` — once per session when the modal mounts; properties: `{ trigger: 'consent_banner' | 'picker' | 'bookmark_toast' }`
- `pwa_install_nudge_dismissed` — fires on either button; properties: `{ button: 'maybe_later' | 'got_it', trigger: ... }`

The trigger property lets us measure which call site converts best — useful for tuning the picker or banner copy if one underperforms.

A separate observable signal: a user appearing in standalone mode for the first time after seeing the nudge. Track via a PostHog person property `first_seen_standalone_at` set by a tiny effect in the locale layout when `display-mode: standalone` is detected. Not strictly required for v1; useful for measuring install conversion 30 days later.

## Acceptance criteria

- [ ] iOS Safari user (regular tab) tapping "Accept all" with push consent on sees the install nudge modal instead of silent failure.
- [ ] Same user tapping "Enable" on the picker notification sheet sees the modal.
- [ ] Same user tapping "Enable alerts" on a bookmark toast sees the modal.
- [ ] Modal shows animated mini-iPhone with the 3-step flow (tap Share → sheet up → highlight Add-to-Home-Screen).
- [ ] Tapping either button dismisses the modal AND writes `pn_pwa_nudge_shown='1'`.
- [ ] After dismissal, attempting to enable push again does NOT re-show the modal until localStorage is cleared.
- [ ] Once the user installs and opens via the home-screen icon, `isIOSSafariTab()` returns false, push registration runs as on Android.
- [ ] Android Chrome, desktop browsers, and iOS PWA standalone never see the modal.
- [ ] All copy localised across 5 locales.
- [ ] Modal dispatches `pwa_install_nudge_shown` and `pwa_install_nudge_dismissed` PostHog events with the `trigger` property identifying which call site fired it.
- [ ] No regression: existing push flow on Android / desktop / iOS-PWA-standalone is unchanged.

## Out of scope (deferred)

- macOS Safari nudge (different install mechanic; separate spec if data supports the effort).
- Persistent install banner (Pattern B from the brainstorm; consider as Spec 4 if Pattern A's conversion is insufficient).
- "User installed!" thank-you toast.
- Time-based re-prompting after N days. v1 is one-and-done.
- Native iOS app via Capacitor.
