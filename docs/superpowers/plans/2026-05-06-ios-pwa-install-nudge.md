# iOS PWA Install Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the silent push-registration failure on iOS Safari (regular tab) with a focused install-instructions modal so iOS users can add the app to their home screen and start receiving notifications.

**Architecture:** A single shared entry point (`tryEnablePushOrShowInstallNudge`) wraps the existing `anonPush.ensureSubscription` calls in three places (`useFollowing.toggle` first-follow path, `NotificationPromptSheet.handleEnable`, `BookmarkToast.handleCta`). On iOS Safari + non-standalone, the wrapper dispatches a custom DOM event that mounts a bottom-sheet modal showing an animated mini-iPhone with the Share → Add to Home Screen flow. Once dismissed (either button), `pn_pwa_nudge_shown='1'` prevents re-prompts.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl (5 locales), Vitest (node env), PostHog (telemetry, no-ops when consent denied).

**Spec:** [docs/superpowers/specs/2026-05-06-ios-pwa-install-nudge-design.md](../specs/2026-05-06-ios-pwa-install-nudge-design.md)

---

## Note on trigger sites

The spec listed "cookie banner" as one of three trigger sites. After tracing the actual code paths in the merged anonymous-push-notifications work: accepting the cookie banner does NOT directly attempt push registration — it just records consent. Push registration is attempted later in three places:

1. **`useFollowing.toggle`** (the first follow with consent) — currently calls `anonPush.ensureSubscription(...)` directly
2. **`NotificationPromptSheet.handleEnable`** (picker post-Continue) — currently calls `anonPush.ensureSubscription(...)` directly
3. **`BookmarkToast.handleCta`** (anon "Enable alerts" CTA) — currently calls `anonPush.ensureSubscription(...)` directly

This plan wires the install nudge into those three real call sites — same intent as the spec, accurate to the actual code shape.

---

## File Structure

### New files
- `src/lib/pwa-install.ts` — pure detection (`isIOSSafariTab`) + entry point (`tryEnablePushOrShowInstallNudge`) + event constant
- `src/lib/__tests__/pwa-install.test.ts` — UA-matrix tests for the detection helper
- `src/components/PWAInstallNudge.tsx` — the modal + CSS-animated mini iPhone

### Modified files
- `src/app/[locale]/layout.tsx` — mount `<PWAInstallNudge />` globally
- `src/hooks/useFollowing.ts` — replace `anonPush.ensureSubscription` call with the wrapper
- `src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx` — same replacement
- `src/components/BookmarkToast.tsx` — same replacement in the anon branch
- `src/messages/{en,es,pt,it,fr}.json` — `consent.pwaInstall.*` namespace

### LocalStorage flags

| Flag | Set when | Read by |
|---|---|---|
| `pn_pwa_nudge_shown` | User taps either button on the modal | `pwa-install.ts` (gate re-shows) |

### DOM events

| Event | Dispatched by | Listened to by |
|---|---|---|
| `pn-pwa-nudge-show` | `pwa-install.ts::showPWAInstallNudge()` | `<PWAInstallNudge />` (sets visible=true) |

---

## Task 1: i18n keys

**Why:** All modal copy localised across 5 locales. Adding the keys first lets later UI tasks reference them without context-switching.

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Open `src/messages/en.json` and find the existing `consent` namespace**

Run: `grep -n '"consent":' src/messages/en.json`

This namespace was created in the cookie-consent-banner work and currently looks like `"consent": { "title": ..., "categories": {...}, ... }`. We're adding a new `pwaInstall` sub-namespace alongside the existing keys.

- [ ] **Step 2: Add the namespace via Node script (safest)**

Use the same script approach that worked in previous i18n batches — guarantees no other content is touched. Run this exactly:

```bash
node -e '
const fs = require("fs");
const langs = {
  en: {
    title: "Get notifications on iPhone",
    body: "Add PadelNachos to your home screen — takes 5 seconds.",
    shareLabel: "Tap Share at the bottom",
    addLabel: "Tap Add to Home Screen",
    openLabel: "Open the app from your home screen",
    maybeLater: "Maybe later",
    gotIt: "Got it",
  },
  es: {
    title: "Recibe notificaciones en iPhone",
    body: "Añade PadelNachos a tu pantalla de inicio — tarda 5 segundos.",
    shareLabel: "Toca Compartir abajo",
    addLabel: "Toca Añadir a pantalla de inicio",
    openLabel: "Abre la app desde tu pantalla de inicio",
    maybeLater: "Quizá más tarde",
    gotIt: "Entendido",
  },
  pt: {
    title: "Receba notificações no iPhone",
    body: "Adicione o PadelNachos à tela inicial — leva 5 segundos.",
    shareLabel: "Toque em Compartilhar embaixo",
    addLabel: "Toque em Adicionar à Tela de Início",
    openLabel: "Abra o app pela tela inicial",
    maybeLater: "Talvez depois",
    gotIt: "Entendi",
  },
  it: {
    title: "Ricevi notifiche su iPhone",
    body: "Aggiungi PadelNachos alla schermata Home — ci vogliono 5 secondi.",
    shareLabel: "Tocca Condividi in basso",
    addLabel: "Tocca Aggiungi alla schermata Home",
    openLabel: "Apri l app dalla schermata Home",
    maybeLater: "Forse più tardi",
    gotIt: "Ho capito",
  },
  fr: {
    title: "Recevoir des notifications sur iPhone",
    body: "Ajoutez PadelNachos à votre écran d accueil — 5 secondes.",
    shareLabel: "Appuyez sur Partager en bas",
    addLabel: "Appuyez sur Sur l écran d accueil",
    openLabel: "Ouvrez l app depuis votre écran d accueil",
    maybeLater: "Plus tard",
    gotIt: "Compris",
  },
};
for (const [l, keys] of Object.entries(langs)) {
  const path = `src/messages/${l}.json`;
  const m = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!m.consent) throw new Error(`${path} missing consent namespace — abort`);
  m.consent.pwaInstall = keys;
  fs.writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
}
console.log("ok");
'
```

Expected output: `ok`

- [ ] **Step 3: Validate JSON parses**

Run:
```bash
for f in src/messages/{en,es,pt,it,fr}.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('$f ok')"
done
```
Expected: 5 lines of `ok`.

- [ ] **Step 4: Verify no other namespaces dropped**

Run:
```bash
for f in src/messages/{en,es,pt,it,fr}.json; do
  node -e "const m=JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('$f:', Object.keys(m).length, 'top-level namespaces; consent.pwaInstall keys:', Object.keys(m.consent.pwaInstall||{}).length)"
done
```
Expected: identical top-level namespace count across all 5 files; `consent.pwaInstall keys: 7` for each.

- [ ] **Step 5: Commit**

```bash
git add src/messages/
git commit -m "$(cat <<'EOF'
i18n(consent): add pwaInstall sub-namespace across 5 locales

7 keys for the upcoming iOS PWA install nudge modal: title, body,
3 step labels, 2 button labels. Nested under the existing consent
namespace since the install nudge is part of the consent/push UX.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure detection helper + tests

**Why:** `isIOSSafariTab()` is the gate that decides whether to show the install nudge or fall through to native push registration. It needs to be reliable across the iOS browser matrix (Safari, Chrome iOS, Firefox iOS, Edge iOS — all WebKit) and correctly distinguish "tab" from "installed PWA standalone." Pure function, unit-testable.

**Files:**
- Create: `src/lib/pwa-install.ts` (only the pure parts in this task)
- Create: `src/lib/__tests__/pwa-install.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/pwa-install.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isIOSSafariTab } from '../pwa-install'

// Restore globals after each test — the function reads `window` and
// `navigator` directly.
const ORIGINAL_WINDOW = (globalThis as any).window
const ORIGINAL_NAVIGATOR = (globalThis as any).navigator

function mockEnv(opts: {
  ua: string
  standalone?: boolean
  matchesStandalone?: boolean
}) {
  ;(globalThis as any).window = {
    navigator: { standalone: opts.standalone ?? false },
    matchMedia: (query: string) => ({
      matches: query.includes('standalone') ? !!opts.matchesStandalone : false,
      addListener: () => {},
      removeListener: () => {},
    }),
  }
  ;(globalThis as any).navigator = { userAgent: opts.ua }
}

afterEach(() => {
  ;(globalThis as any).window = ORIGINAL_WINDOW
  ;(globalThis as any).navigator = ORIGINAL_NAVIGATOR
})

describe('isIOSSafariTab', () => {
  it('returns false in node / non-browser env', () => {
    ;(globalThis as any).window = undefined
    expect(isIOSSafariTab()).toBe(false)
  })

  it('returns true for iPhone Safari in a regular tab', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
    expect(isIOSSafariTab()).toBe(true)
  })

  it('returns true for Chrome iOS (CriOS — also forced WebKit)', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
    })
    expect(isIOSSafariTab()).toBe(true)
  })

  it('returns true for Firefox iOS (FxiOS)', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/604.1',
    })
    expect(isIOSSafariTab()).toBe(true)
  })

  it('returns true for Edge iOS (EdgiOS)', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0 Mobile/15E148 Safari/604.1',
    })
    expect(isIOSSafariTab()).toBe(true)
  })

  it('returns true for iPad Safari in a regular tab', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
    expect(isIOSSafariTab()).toBe(true)
  })

  it('returns false when navigator.standalone === true (legacy iOS PWA mode)', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      standalone: true,
    })
    expect(isIOSSafariTab()).toBe(false)
  })

  it('returns false when display-mode: standalone matches', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      matchesStandalone: true,
    })
    expect(isIOSSafariTab()).toBe(false)
  })

  it('returns false for Android Chrome', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    })
    expect(isIOSSafariTab()).toBe(false)
  })

  it('returns false for desktop Chrome on macOS', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    expect(isIOSSafariTab()).toBe(false)
  })

  it('returns false for desktop Safari on macOS', () => {
    mockEnv({
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    })
    expect(isIOSSafariTab()).toBe(false)
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/lib/__tests__/pwa-install.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure helper**

Create `src/lib/pwa-install.ts`:

```ts
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
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/lib/__tests__/pwa-install.test.ts`
Expected: 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pwa-install.ts src/lib/__tests__/pwa-install.test.ts
git commit -m "$(cat <<'EOF'
feat(pwa-install): add isIOSSafariTab detection helper

Pure function that returns true for iPhone/iPad in any non-standalone
browser (Safari, Chrome iOS, Firefox iOS, Edge iOS — all WebKit-forced
share the same Web Push restriction). Returns false for installed PWAs
(navigator.standalone === true OR display-mode: standalone CSS match)
and non-iOS platforms.

11 unit tests cover the iOS browser matrix + macOS/Android negatives.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Lib entry point — `tryEnablePushOrShowInstallNudge`

**Why:** Each call site (useFollowing, NotificationPromptSheet, BookmarkToast) currently calls `anonPush.ensureSubscription(initialBookmarks)` directly. We're replacing that with a single shared wrapper that branches on iOS-Safari-tab vs everywhere else. The wrapper lives next to `isIOSSafariTab` in `src/lib/pwa-install.ts`.

**Files:**
- Modify: `src/lib/pwa-install.ts` (extends Task 2)

- [ ] **Step 1: Append the entry point**

Append to `src/lib/pwa-install.ts` (keep `isIOSSafariTab` from Task 2):

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify existing tests still pass**

Run: `npx vitest run src/lib/__tests__/pwa-install.test.ts`
Expected: 11 tests still passing (no new tests for the side-effectful entry point — covered by manual smoke).

- [ ] **Step 4: Commit**

```bash
git add src/lib/pwa-install.ts
git commit -m "$(cat <<'EOF'
feat(pwa-install): tryEnablePushOrShowInstallNudge entry point

Single wrapper that call sites use instead of calling
anonPush.ensureSubscription directly. Branches on iOS-Safari-tab:
on iOS, dispatches a custom DOM event so the mounted modal can show
itself; everywhere else, falls through to the existing push flow.

Adds PWA_NUDGE_EVENT constant, markNudgeShown helper, and the
PWANudgeTrigger type ('first_follow' | 'picker' | 'bookmark_toast')
used for telemetry.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: PWAInstallNudge component

**Why:** The visible UI — bottom-sheet modal with the CSS-animated mini iPhone showing the Share → Add to Home Screen flow. Listens for the show event from Task 3.

**Files:**
- Create: `src/components/PWAInstallNudge.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/PWAInstallNudge.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import posthog from 'posthog-js'
import {
  PWA_NUDGE_EVENT,
  markNudgeShown,
  type PWANudgeTrigger,
} from '@/lib/pwa-install'

const GREEN = '#7ED321'
const BLUE = '#4A9EFF'
const CHUNKY = {
  card: 'polygon(0% 4%, 100% 0%, 100% 100%, 0% 100%)',
  button: 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)',
  badge: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)',
}

export function PWAInstallNudge() {
  const t = useTranslations('consent.pwaInstall')
  const [visible, setVisible] = useState(false)
  const [trigger, setTrigger] = useState<PWANudgeTrigger>('picker')

  useEffect(() => {
    function onShow(e: Event) {
      const detail = (e as CustomEvent<{ trigger: PWANudgeTrigger }>).detail
      setTrigger(detail?.trigger ?? 'picker')
      setVisible(true)
      // Telemetry — PostHog no-ops gracefully when consent denied.
      try {
        posthog.capture('pwa_install_nudge_shown', {
          trigger: detail?.trigger ?? 'picker',
        })
      } catch {}
    }
    window.addEventListener(PWA_NUDGE_EVENT, onShow)
    return () => window.removeEventListener(PWA_NUDGE_EVENT, onShow)
  }, [])

  if (!visible) return null

  const dismiss = (button: 'maybe_later' | 'got_it') => {
    markNudgeShown()
    try {
      posthog.capture('pwa_install_nudge_dismissed', { button, trigger })
    } catch {}
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={() => dismiss('maybe_later')}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: 'linear-gradient(180deg, #1E1E1E, #161616)',
          borderTop: `2px solid ${GREEN}`,
          padding: '22px 18px 26px',
          clipPath: CHUNKY.card,
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Icon */}
        <div style={{
          width: 44, height: 44, margin: '0 auto 12px',
          background: 'rgba(126,211,33,0.15)',
          border: `1.5px solid ${GREEN}`,
          clipPath: CHUNKY.badge,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14"/>
            <path d="M5 12l7-7 7 7"/>
          </svg>
        </div>

        <h3 style={{ fontSize: 16, fontWeight: 900, textAlign: 'center', marginBottom: 6 }}>
          {t('title')}
        </h3>
        <p style={{ fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 1.5, marginBottom: 14 }}>
          {t('body')}
        </p>

        {/* Animated mini iPhone */}
        <div style={{
          width: 220, height: 260,
          margin: '0 auto 14px',
          background: '#0d0d0d',
          border: '6px solid #2a2a2a',
          borderRadius: 24,
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(180deg, #1a1a1a, #0a0a0a)',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Fake page */}
            <div style={{ padding: 8, color: '#555', fontSize: 7 }}>
              <div style={{
                background: GREEN, color: '#000',
                fontSize: 8, padding: 3, textAlign: 'center', fontWeight: 900,
              }}>
                PADELNACHOS
              </div>
              <div style={{ padding: '10px 0', color: '#aaa' }}>Live scores</div>
              <div style={{ background: 'rgba(255,255,255,0.04)', padding: 6, borderRadius: 4, marginBottom: 4 }}>
                Galán · LIVE
              </div>
              <div style={{ background: 'rgba(255,255,255,0.04)', padding: 6, borderRadius: 4 }}>
                Tapia · 6-3
              </div>
            </div>

            {/* Fake Safari toolbar */}
            <div style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              height: 28,
              background: 'rgba(40,40,40,0.95)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-around',
            }}>
              <div style={{ width: 18, height: 18, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
              </div>
              <div style={{ width: 18, height: 18, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </div>
              {/* Share button — the highlight target */}
              <div style={{ width: 18, height: 18, color: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v14"/>
                  <path d="M5 9l7-7 7 7"/>
                  <rect x="3" y="14" width="18" height="8" rx="2"/>
                </svg>
              </div>
              <div style={{ width: 18, height: 18, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                </svg>
              </div>
              <div style={{ width: 18, height: 18, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </div>
            </div>

            {/* Animated finger pointing to Share */}
            <div className="pn-pwa-finger" />

            {/* Animated Share sheet */}
            <div className="pn-pwa-sheet">
              <div className="pn-pwa-sheet-row">📋 {t('shareLabel')}</div>
              <div className="pn-pwa-sheet-row pn-pwa-sheet-highlight">
                📲 {t('addLabel')}
              </div>
              <div className="pn-pwa-sheet-row">📰 {t('openLabel')}</div>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => dismiss('maybe_later')}
            style={{
              flex: 1, padding: '11px 0',
              fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: 'rgba(255,255,255,0.05)', color: '#aaa',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('maybeLater')}
          </button>
          <button
            type="button"
            onClick={() => dismiss('got_it')}
            style={{
              flex: 1, padding: '11px 0',
              fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: GREEN, color: '#000',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('gotIt')}
          </button>
        </div>
      </div>

      {/* Animation styles. Uses a class so `style={...}` doesn't have to
          carry keyframes (React inline styles can't define them). */}
      <style dangerouslySetInnerHTML={{ __html: `
        .pn-pwa-finger {
          position: absolute;
          bottom: 24px;
          width: 18px; height: 18px;
          left: 130px;
          border-radius: 50%;
          background: rgba(126,211,33,0.4);
          border: 2px solid #7ED321;
          animation: pn-pwa-finger-tap 3s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes pn-pwa-finger-tap {
          0%, 25% { transform: scale(1); opacity: 1; }
          35% { transform: scale(0.7); opacity: 0.7; }
          45%, 100% { transform: scale(1); opacity: 0; }
        }

        .pn-pwa-sheet {
          position: absolute;
          bottom: -200px;
          left: 8px; right: 8px;
          background: linear-gradient(180deg, #2a2a2a, #1c1c1c);
          border-radius: 8px 8px 0 0;
          padding: 8px;
          animation: pn-pwa-sheet-up 3s ease-in-out infinite;
        }
        @keyframes pn-pwa-sheet-up {
          0%, 30% { bottom: -200px; }
          50%, 80% { bottom: 28px; }
          90%, 100% { bottom: -200px; }
        }

        .pn-pwa-sheet-row {
          padding: 4px 6px;
          font-size: 7px;
          color: #aaa;
          display: flex;
          align-items: center;
          gap: 4px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .pn-pwa-sheet-highlight {
          color: #7ED321;
          background: rgba(126,211,33,0.1);
          animation: pn-pwa-sheet-pulse 3s ease-in-out infinite;
        }
        @keyframes pn-pwa-sheet-pulse {
          0%, 60% { background: rgba(126,211,33,0); }
          70%, 80% { background: rgba(126,211,33,0.2); }
          100% { background: rgba(126,211,33,0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .pn-pwa-finger,
          .pn-pwa-sheet,
          .pn-pwa-sheet-highlight {
            animation: none !important;
          }
          .pn-pwa-sheet { bottom: 28px !important; }
          .pn-pwa-sheet-highlight { background: rgba(126,211,33,0.2) !important; }
        }
      `}} />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/PWAInstallNudge.tsx
git commit -m "$(cat <<'EOF'
feat(pwa-install): add PWAInstallNudge component

Bottom-sheet modal with a CSS-animated mini iPhone showing the
Share → Add to Home Screen flow (3-second loop). Listens for the
pn-pwa-nudge-show custom event. Either button dismisses + writes
pn_pwa_nudge_shown so it never re-shows. Honors prefers-reduced-motion.

Telemetry: pwa_install_nudge_shown on mount, pwa_install_nudge_dismissed
on either button (with trigger + button properties). PostHog calls
no-op gracefully when analytics consent is denied.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Mount the modal in the locale layout

**Why:** The component listens for a custom event globally. It needs to be mounted somewhere that's always rendered for any locale page so the event has a listener. Same approach as `<ConsentBanner />` and `<LoginCtaSheet />`.

**Files:**
- Modify: `src/app/[locale]/layout.tsx`

- [ ] **Step 1: Read the current layout**

Run: `cat 'src/app/[locale]/layout.tsx'`

Find the imports near the top and the return JSX. Note where `<ConsentBanner />` is mounted (it was added in the cookie-consent work). The new component should sit alongside it.

- [ ] **Step 2: Add the import + mount**

In the imports section (alongside `import { ConsentBanner } from '@/components/consent/ConsentBanner'`):

```ts
import { PWAInstallNudge } from '@/components/PWAInstallNudge'
```

In the rendered JSX, immediately after `<ConsentBanner />` (or in the same place — both are global modals), add:

```tsx
<PWAInstallNudge />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/[locale]/layout.tsx'
git commit -m "$(cat <<'EOF'
feat(pwa-install): mount PWAInstallNudge in locale layout

Modal now globally available for any call site to dispatch via the
pn-pwa-nudge-show custom event. Sits alongside ConsentBanner since
both are conditional global modals.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire `useFollowing.toggle` (first-follow path)

**Why:** When an anonymous iOS Safari user follows their first player, the existing code calls `anonPush.ensureSubscription(initial)` which silently no-ops. Replace that with the new wrapper so iOS users see the install nudge instead.

**Files:**
- Modify: `src/hooks/useFollowing.ts`

- [ ] **Step 1: Locate the existing call site**

Run: `grep -n 'ensureSubscription' src/hooks/useFollowing.ts`

There's an `await anonPush.ensureSubscription(initial)` inside the anonymous toggle block (added in the anon-push work). It runs only on a follow when `pushAllowed && supported`.

- [ ] **Step 2: Add the import**

Add this import alongside the existing hook imports near the top of the file:

```ts
import { tryEnablePushOrShowInstallNudge } from '@/lib/pwa-install'
```

- [ ] **Step 3: Replace the `ensureSubscription` call**

Find the block:

```ts
void (async () => {
  await anonPush.ensureSubscription(initial)
  await anonPush.addBookmark(bookmark)
})()
```

Replace it with:

```ts
void (async () => {
  await tryEnablePushOrShowInstallNudge(initial, 'first_follow')
  await anonPush.addBookmark(bookmark)
})()
```

The `addBookmark` call still runs after the wrapper because:
- On Android/desktop, the wrapper returns after registering the subscription → addBookmark adds the new bookmark to the now-registered server-side list.
- On iOS Safari, the wrapper just dispatches the show event and returns → addBookmark is a no-op (no device_id registered yet) — which is fine; bookmarks resync the next time the user actually subscribes (after PWA install).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFollowing.ts
git commit -m "$(cat <<'EOF'
feat(pwa-install): wire useFollowing first-follow to install nudge

Replaces direct anonPush.ensureSubscription call with the unified
wrapper. On Android/desktop the path is unchanged. On iOS Safari
(regular tab) the wrapper dispatches the install-nudge event so
the user sees actionable instructions instead of silent failure.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire `NotificationPromptSheet` (picker)

**Why:** The picker's `handleEnable` currently calls `anonPush.ensureSubscription(initial)`. Same swap as Task 6.

**Files:**
- Modify: `src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx`

- [ ] **Step 1: Read the current handleEnable**

Run: `grep -n 'ensureSubscription\|handleEnable' 'src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx'`

Find the `handleEnable` function. It currently calls `await anonPush.ensureSubscription(initial)`.

- [ ] **Step 2: Add the import**

Add to the imports at the top of the file:

```ts
import { tryEnablePushOrShowInstallNudge } from '@/lib/pwa-install'
```

- [ ] **Step 3: Replace the call**

Find the line:

```ts
const granted = await anonPush.ensureSubscription(initial)
```

Replace with:

```ts
const result = await tryEnablePushOrShowInstallNudge(initial, 'picker')
const granted = result.enabled
```

The rest of `handleEnable` (which calls `onResolve(granted)`) stays unchanged. On iOS, `granted` will be false (the wrapper returns early after dispatching the event); the component closes and the user sees the install nudge that just popped up underneath.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx'
git commit -m "$(cat <<'EOF'
feat(pwa-install): wire picker NotificationPromptSheet to install nudge

Replaces direct anonPush.ensureSubscription call with the unified
wrapper. iOS Safari users tapping Enable on the picker now see the
install instructions modal instead of a silent close.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire `BookmarkToast` (anon "Enable alerts" CTA)

**Why:** The bookmark toast's `handleCta` anon branch currently calls `anonPush.ensureSubscription(initial)`. Same swap.

**Files:**
- Modify: `src/components/BookmarkToast.tsx`

- [ ] **Step 1: Read the current anon branch**

Run: `grep -n 'ensureSubscription\|handleCta\|enable-push' src/components/BookmarkToast.tsx`

Find the `handleCta` function and locate the `if (!user) { ... }` block — there's a call to `await anonPush.ensureSubscription(initial)` inside it.

- [ ] **Step 2: Add the import**

Add to the imports:

```ts
import { tryEnablePushOrShowInstallNudge } from '@/lib/pwa-install'
```

- [ ] **Step 3: Replace the call**

Find:

```ts
await anonPush.ensureSubscription(initial)
```

Replace with:

```ts
await tryEnablePushOrShowInstallNudge(initial, 'bookmark_toast')
```

The result isn't used here (the toast just dismisses after the call), so we don't need to capture the return value.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/BookmarkToast.tsx
git commit -m "$(cat <<'EOF'
feat(pwa-install): wire BookmarkToast anon CTA to install nudge

Replaces direct anonPush.ensureSubscription call with the unified
wrapper. iOS Safari users tapping Enable alerts on a bookmark toast
now see the install instructions modal instead of a silent close.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final smoke + acceptance verification

**Why:** Walk through every spec acceptance criterion end-to-end before opening the PR. Verification only — no commits.

**Files:** none modified.

- [ ] **Step 1: Tests + typecheck + build**

```bash
npx vitest run src/lib/__tests__/pwa-install.test.ts src/lib/__tests__/anon-push.test.ts src/lib/__tests__/consent.test.ts
npx tsc --noEmit
npm run build
```
Expected: all green.

- [ ] **Step 2: Manual flow — desktop Chrome (Android-equivalent)**

Open in regular (not incognito) Chrome:
1. Clear localStorage, accept cookie banner with push ON, follow a player → native push prompt fires (existing Android-class behavior). Install nudge MUST NOT appear.
2. Same in the picker — Enable button triggers native prompt. Install nudge MUST NOT appear.

- [ ] **Step 3: Manual flow — iOS Safari (regular tab)**

On an iPhone, open Safari (NOT installed-PWA):
1. Clear all site data (Settings → Safari → Advanced → Website Data → padelnachos.com → Remove)
2. Visit `padelnachos.com`
3. Accept cookie banner with push ON
4. Follow a player → install nudge modal SHOULD appear with the animated mini iPhone
5. Tap Maybe later → modal closes, `pn_pwa_nudge_shown='1'` is now in localStorage
6. Try to follow another player → modal MUST NOT re-appear

To verify localStorage on iOS Safari without DevTools, you can chain: open Safari, go to `padelnachos.com`, in the URL bar type:
```
javascript:alert(localStorage.getItem('pn_pwa_nudge_shown'))
```
(May be stripped on paste — paste twice if needed.) Should show `1` after dismissal.

- [ ] **Step 4: Manual flow — iOS PWA standalone**

Same iPhone, install the PWA via Share → Add to Home Screen, open from icon:
1. Follow a player → native push prompt fires (push works in standalone mode)
2. Install nudge MUST NOT appear (isIOSSafariTab returns false)

- [ ] **Step 5: PostHog telemetry**

In a desktop session that has analytics consent on, trigger the install nudge by spoofing the iOS UA:
1. DevTools → Network conditions → set User agent to an iPhone Safari UA
2. Reload, accept cookie banner, follow a player
3. Modal should appear (same code path as a real iPhone)
4. In PostHog, look for `pwa_install_nudge_shown` event with `trigger: 'first_follow'`
5. Tap a button → `pwa_install_nudge_dismissed` event with `{ button, trigger }`

- [ ] **Step 6: Acceptance criteria checklist**

Walk through the spec's 11 acceptance criteria one by one. Tick them off only when verified end-to-end.

---

## Self-review (run before opening PR)

1. **Spec coverage:** All 11 acceptance criteria from the spec map to a task above. (Trigger sites updated to reflect the actual code paths — see "Note on trigger sites" at the top.)

2. **Final test pass:**
   ```bash
   npx vitest run src/lib/__tests__/pwa-install.test.ts
   npx tsc --noEmit
   npm run build
   ```
   All green = ready for PR.

3. **PR title suggestion:** `feat: iOS PWA install nudge for Web Push gap`
