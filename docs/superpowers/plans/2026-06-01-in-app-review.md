# In-App Review (Rate the App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prompt PadelNachos users to rate the app via the native OS in-app review overlay, gated to spend the OS's limited quota wisely, plus a manual "Rate us" button in Settings.

**Architecture:** A single side-effect-light module `src/lib/app-review.ts` owns all logic: a pure, unit-tested gate decision (`shouldAutoAsk`), localStorage gate state, and three entry points — `recordAppOpen()`, `requestReviewForReason()` (gated native overlay), and `openRateFlow()` (manual store link). Three call sites wire it in: app boot (`native-init.ts`), favoriting (`useFollowing.toggle`), and a Settings → Support row.

**Tech Stack:** Capacitor 8, `@capacitor-community/in-app-review` v8, Next.js 16 / React 19, TypeScript, Vitest (node env), next-intl (5 locales).

**Refinement vs spec:** The manual Settings button opens the store write-review page directly (`window.open` to `apps.apple.com/...?action=write-review` / `play.google.com/...`) instead of attempting the native overlay first. An explicit tap must reliably go somewhere; the native overlay (which can silently no-op) is reserved for the two automatic triggers. This mirrors the existing affiliate-link pattern at `src/app/[locale]/player/[id]/page.tsx:1199`.

**Identifiers:** iOS App Store ID `6770290540`; Android package `com.padelnachos.app`.

---

### Task 1: Install the in-app-review plugin

**Files:**
- Modify: `package.json`, `package-lock.json`
- Native: `ios/`, `android/` (synced by Capacitor, not hand-edited)

- [ ] **Step 1: Install the plugin**

Run: `npm install @capacitor-community/in-app-review@^8.0.0`
Expected: adds the dependency; `npm ls @capacitor-community/in-app-review` prints `8.x`.

- [ ] **Step 2: Sync native projects**

Run: `npx cap sync android && npx cap sync ios`
Expected: "Sync finished". The plugin is copied into both native projects. If iOS `pod install` fails locally (no CocoaPods toolchain), that's fine — the JS install is enough for typecheck/build; native pods are resolved on the build machine. Note it and continue.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @capacitor-community/in-app-review plugin"
```

---

### Task 2: Pure gate decision — `shouldAutoAsk` (TDD)

**Files:**
- Create: `src/lib/app-review.ts`
- Test: `src/lib/__tests__/app-review.test.ts`

The pure function and the tunable constants live here. No `window`, no Capacitor, no I/O — fully deterministic so it runs in Vitest's node env.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/app-review.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  shouldAutoAsk,
  MIN_OPENS,
  APP_OPENS_THRESHOLD,
  MAX_ASKS,
  type ReviewGateState,
} from '@/lib/app-review'

const base: ReviewGateState = { appOpens: 0, askCount: 0, lastAskedAt: null }
const NOW = new Date('2026-06-01T12:00:00Z')

describe('shouldAutoAsk', () => {
  it('never asks on web (non-native)', () => {
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD }
    expect(shouldAutoAsk(state, NOW, 'app_opens', false)).toBe(false)
  })

  it('never asks below the MIN_OPENS floor', () => {
    const state = { ...base, appOpens: MIN_OPENS - 1 }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(false)
  })

  it('asks on a favorite once the floor is met', () => {
    const state = { ...base, appOpens: MIN_OPENS }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(true)
  })

  it('asks on app_opens exactly at the threshold', () => {
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD }
    expect(shouldAutoAsk(state, NOW, 'app_opens', true)).toBe(true)
  })

  it('does not ask on app_opens below the threshold', () => {
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD - 1 }
    expect(shouldAutoAsk(state, NOW, 'app_opens', true)).toBe(false)
  })

  it('does not ask on app_opens above the threshold', () => {
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD + 1 }
    expect(shouldAutoAsk(state, NOW, 'app_opens', true)).toBe(false)
  })

  it('does not ask once the lifetime cap is reached', () => {
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD, askCount: MAX_ASKS }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(false)
  })

  it('does not ask within the cooldown window', () => {
    const tenDaysAgo = new Date('2026-05-22T12:00:00Z').toISOString()
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD, lastAskedAt: tenDaysAgo }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(false)
  })

  it('asks again after the cooldown window elapses', () => {
    const seventyDaysAgo = new Date('2026-03-23T12:00:00Z').toISOString()
    const state = { ...base, appOpens: APP_OPENS_THRESHOLD, lastAskedAt: seventyDaysAgo }
    expect(shouldAutoAsk(state, NOW, 'favorite', true)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/app-review.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/app-review"` (module doesn't exist yet).

- [ ] **Step 3: Write the minimal module to pass**

Create `src/lib/app-review.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/app-review.test.ts`
Expected: PASS — 9 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/app-review.ts src/lib/__tests__/app-review.test.ts
git commit -m "feat: add shouldAutoAsk review gate decision"
```

---

### Task 3: Gate storage + entry points

**Files:**
- Modify: `src/lib/app-review.ts`

Add localStorage-backed gate state and the three side-effecting entry points. These wrap the pure function; they're verified manually (localStorage + native plugin), not unit-tested.

- [ ] **Step 1: Append storage + entry points to the module**

Add to `src/lib/app-review.ts` (below `shouldAutoAsk`):

```ts
import { Capacitor } from '@capacitor/core'

const GATE_KEY = 'pn_review_gate'
const DEFAULT_STATE: ReviewGateState = { appOpens: 0, askCount: 0, lastAskedAt: null }

// Store identifiers (see plan header).
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
```

- [ ] **Step 2: Verify the existing test still passes (no regression)**

Run: `npx vitest run src/lib/__tests__/app-review.test.ts`
Expected: PASS — still 9 passing (the new exports don't touch `shouldAutoAsk`).

- [ ] **Step 3: Typecheck the module**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/lib/app-review.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/app-review.ts
git commit -m "feat: add review gate storage and entry points"
```

---

### Task 4: Wire the app-opens trigger into boot

**Files:**
- Modify: `src/lib/native-init.ts` (imports near top; body just after `initialized = true`, line ~26)

- [ ] **Step 1: Add the import**

In `src/lib/native-init.ts`, add to the import block (after the existing `@/lib/persist-fcm-token` import, line 11):

```ts
import { recordAppOpen, requestReviewForReason } from '@/lib/app-review'
```

- [ ] **Step 2: Record the open and maybe prompt**

In `src/lib/native-init.ts`, immediately after `initialized = true` (line 26), insert:

```ts

  // In-app review: count this native boot, then (gated) maybe ask for a
  // rating. requestReviewForReason no-ops unless the gate allows it, so
  // this is safe to call on every launch. Fire-and-forget.
  recordAppOpen()
  void requestReviewForReason('app_opens')
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/native-init.ts
git commit -m "feat: prompt for review at the app-opens threshold"
```

---

### Task 5: Wire the favoriting trigger

**Files:**
- Modify: `src/hooks/useFollowing.ts` (import near top; body inside `toggle`, just after the `BOOKMARK_EVENT` dispatch block that ends at line ~317)

- [ ] **Step 1: Add the import**

In `src/hooks/useFollowing.ts`, add near the other imports at the top of the file:

```ts
import { requestReviewForReason } from '@/lib/app-review'
```

- [ ] **Step 2: Fire the gated prompt on a net-new player/tournament follow**

In `src/hooks/useFollowing.ts`, inside `toggle`, immediately AFTER the closing `}` of the `if (!silent && type !== 'news_source' && ...)` block that dispatches `BOOKMARK_EVENT` (the `window.dispatchEvent(new CustomEvent(BOOKMARK_EVENT, ...))` call, around line 317), insert:

```ts

      // In-app review nudge: a net-new player/tournament follow is a
      // high-intent "I care about this app" moment. Gated in app-review.ts,
      // so most follows won't actually surface the prompt. Fire-and-forget;
      // never blocks the toggle. Excludes match + news_source by design.
      if (!isCurrently && (type === 'player' || type === 'tournament')) {
        void requestReviewForReason('favorite')
      }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useFollowing.ts
git commit -m "feat: prompt for review on player/tournament follow"
```

---

### Task 6: Settings "Rate us" button + i18n

**Files:**
- Modify: `src/app/[locale]/(app)/profile/settings/page.tsx` (import + Support section row ~line 444)
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json` (`settings.support.rate`)

- [ ] **Step 1: Add the translation key to all 5 locales**

In each file, inside `settings.support`, add a `rate` key alongside the existing `contact` / `about`:

`src/messages/en.json`:
```json
      "rate": "Rate PadelNachos"
```
`src/messages/es.json`:
```json
      "rate": "Valora PadelNachos"
```
`src/messages/pt.json`:
```json
      "rate": "Avalie o PadelNachos"
```
`src/messages/it.json`:
```json
      "rate": "Valuta PadelNachos"
```
`src/messages/fr.json`:
```json
      "rate": "Notez PadelNachos"
```

(Add a trailing comma to the preceding `"about": ...` line as needed so each JSON file stays valid.)

- [ ] **Step 2: Add the import**

In `src/app/[locale]/(app)/profile/settings/page.tsx`, add near the top imports:

```ts
import { openRateFlow } from '@/lib/app-review'
```

- [ ] **Step 3: Add the row to the Support section**

In `src/app/[locale]/(app)/profile/settings/page.tsx`, in the `{/* SUPPORT */}` section, after the `/about` `<Link>` block (ends line ~444), insert:

```tsx
      <Row label={t('support.rate')} control={<Chevron />} onClick={() => openRateFlow()} />
```

- [ ] **Step 4: Verify JSON is valid and typecheck**

Run: `node -e "['en','es','pt','it','fr'].forEach(l=>{const m=require('./src/messages/'+l+'.json'); if(!m.settings.support.rate) throw new Error('missing rate in '+l); }); console.log('ok')" && npx tsc --noEmit`
Expected: prints `ok`, no type errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/profile/settings/page.tsx" src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat: add Rate PadelNachos button to Settings"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run: `npx vitest run src/lib/__tests__/app-review.test.ts`
Expected: PASS — 9 passing.

- [ ] **Step 2: Lint the changed files**

Run: `npm run lint`
Expected: no new errors in `app-review.ts`, `native-init.ts`, `useFollowing.ts`, `settings/page.tsx`.

- [ ] **Step 3: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Production build smoke test**

Run: `npm run build`
Expected: build succeeds (the web bundle must not pull the native-only plugin — `fireNativeReview`'s dynamic import is only reached on native).

- [ ] **Step 5: Manual web check of the Settings button**

Run: `npm run dev` then open `http://localhost:3002/profile/settings`. Tap "Rate PadelNachos".
Expected: a new tab opens to `https://apps.apple.com/app/id6770290540?action=write-review` (or the Play listing on an Android UA). This is the only branch observable without a store build.

- [ ] **Step 6: Document the native limitation**

The native overlay (`InAppReview.requestReview()`) renders ONLY in store-installed / internal-test-track builds — not in dev, TestFlight sideload, or `cap run`. The gate logic is covered by unit tests; the overlay itself is verified post-submission on a TestFlight/internal-track build. No code change in this step — this is the documented acceptance boundary.

---

## Self-Review

**Spec coverage:**
- Plugin `@capacitor-community/in-app-review` v8 → Task 1 ✓
- `src/lib/app-review.ts` with `recordAppOpen` / `requestReviewForReason` / `openRateFlow` / `shouldAutoAsk` → Tasks 2–3 ✓
- Gate state `pn_review_gate` `{appOpens, askCount, lastAskedAt}` → Task 3 ✓
- Gate policy (native-only, MIN_OPENS=3, APP_OPENS_THRESHOLD=5, COOLDOWN_DAYS=60, MAX_ASKS=3) → Task 2 constants + `shouldAutoAsk` ✓
- Trigger 1 app-opens in `native-init.ts` → Task 4 ✓
- Trigger 2 favoriting in `useFollowing.toggle` (player/tournament, on-toggle only) → Task 5 ✓
- Trigger 3 Settings → Support button → Task 6 ✓
- Web behaviour (auto no-op via `shouldAutoAsk` isNative=false; button opens web listing) → Tasks 3 + 6 ✓
- Unit tests for `shouldAutoAsk` across the documented cases → Task 2 ✓
- Manual store-URL fallback verification → Task 7 ✓
- Store identifiers (App Store `6770290540`, package `com.padelnachos.app`) → Task 3 ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**Type consistency:** `ReviewGateState` / `ReviewReason` defined in Task 2 and reused unchanged in Task 3. `shouldAutoAsk` signature `(state, now, reason, isNative)` consistent between test (Task 2) and caller (Task 3). `requestReviewForReason` / `recordAppOpen` / `openRateFlow` names match across Tasks 3–6. ✓
