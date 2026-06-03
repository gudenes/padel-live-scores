# Native AdMob Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render AdMob banner ads inside the native iOS/Android apps as the programmatic fill for the sticky-bottom slot — shown only when no direct-sold banner matches the visitor's country — with Google UMP consent + iOS ATT.

**Architecture:** `@capacitor-community/admob` (native-only, lazy-imported). AdMob banners are **native overlays** (not DOM) — a `useAdMobBanner` controller shows/hides an adaptive banner `BOTTOM_CENTER` with a margin above the bottom nav, driven by the same resolution the web `StickyAdBanner` uses (country → `pickBanner`; if no direct banner + `native_enabled` + on an ad route → show AdMob). UMP + ATT run once at app boot in `native-init.ts`. Serving is remotely toggled by `ad_network_config.native_enabled`.

**Tech Stack:** Capacitor 8 (`@capacitor/core` ^8.3.1), `@capacitor-community/admob`, Next.js 16 (remote-loaded in the WebView), Supabase, Vitest. Worktree: `/Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/admob-native` (branch `feat/admob-native`, off `origin/main`). Tests: `npx vitest run <file>`. **Controller/native code can't be unit-tested here** — those tasks end in a build check + a manual on-device checklist. All commits from the controller in the worktree.

> **Plugin API note:** method/enum names below (`AdMob.initialize`, `requestConsentInfo`, `showConsentForm`, `requestTrackingAuthorization`, `showBanner`, `hideBanner`, `removeBanner`, `BannerAdSize.ADAPTIVE_BANNER`, `BannerAdPosition.BOTTOM_CENTER`, `AdmobConsentStatus`) are from `@capacitor-community/admob` v7/v8. After install (Task 4), confirm exact exported names against `node_modules/@capacitor-community/admob/dist/esm/*.d.ts` and adjust if the installed version differs.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260603020000_admob_ios_banner_unit.sql` (create) | add `admob_ios_banner_unit_id` to `ad_network_config` |
| `src/lib/ad-banner-resolver.ts` (modify) | add field to `AdNetworkConfig` |
| `src/app/api/ads/active/route.ts` (modify) | select the new field |
| `apps/ops/src/app/api/internal/ad-network-config/route.ts` (modify) | `COLS` + `ALLOWED` |
| `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx` (modify) | iOS banner-unit input |
| `src/lib/admob-eligibility.ts` (create) | pure `shouldShowAdMob()` + `pickBannerUnit()` |
| `src/lib/__tests__/admob-eligibility.test.ts` (create) | unit tests |
| `package.json` / lockfile (modify) | add `@capacitor-community/admob` |
| `capacitor.config.ts` (modify) | AdMob plugin block |
| `android/app/src/main/AndroidManifest.xml` (modify) | AdMob `APPLICATION_ID` meta-data |
| `ios/App/App/Info.plist` (modify) | `GADApplicationIdentifier`, ATT string, `SKAdNetworkItems` |
| `src/lib/native-init.ts` (modify) | AdMob init + UMP + ATT (lazy) |
| `src/components/ads/useAdMobBanner.ts` (create) | native banner controller hook |
| `src/components/ads/StickyAdBanner.tsx` (modify) | delegate to controller on native |

---

## Task 1: Migration — add `admob_ios_banner_unit_id`

**Files:**
- Create: `supabase/migrations/20260603020000_admob_ios_banner_unit.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260603020000_admob_ios_banner_unit.sql
-- Per-platform AdMob banner units: iOS and Android have different ad-unit IDs.
-- ad_network_config.admob_banner_unit_id holds the ANDROID unit; add iOS.
ALTER TABLE ad_network_config ADD COLUMN IF NOT EXISTS admob_ios_banner_unit_id TEXT;
```

- [ ] **Step 2: Apply to Supabase** (this repo applies via a one-off `pg` script with `DATABASE_URL` from `.env.local`). Create `_tmp-apply.mjs` in the worktree root:

```js
import { readFileSync } from 'node:fs'
import pg from 'pg'
const sql = readFileSync('./supabase/migrations/20260603020000_admob_ios_banner_unit.sql', 'utf8')
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect(); await c.query(sql)
const r = await c.query(`select column_name from information_schema.columns where table_name='ad_network_config' and column_name='admob_ios_banner_unit_id'`)
console.log('column present:', r.rows.length === 1); await c.end()
```

Run: `node --env-file=.env.local _tmp-apply.mjs && rm -f _tmp-apply.mjs`
Expected: `column present: true`
(`.env.local` must exist in the worktree — copy from the repo root if missing: `cp /Volumes/Crucial/dev/padel-live-scores/.env.local .env.local`.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260603020000_admob_ios_banner_unit.sql
git commit -m "feat: add admob_ios_banner_unit_id to ad_network_config"
```

---

## Task 2: Thread the new config field through type + routes + ops form

**Files:**
- Modify: `src/lib/ad-banner-resolver.ts`
- Modify: `src/app/api/ads/active/route.ts`
- Modify: `apps/ops/src/app/api/internal/ad-network-config/route.ts`
- Modify: `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx`

- [ ] **Step 1: Add the field to `AdNetworkConfig`** in `src/lib/ad-banner-resolver.ts`

Old:
```ts
  admob_android_app_id: string | null
  admob_banner_unit_id: string | null
}
```
New:
```ts
  admob_android_app_id: string | null
  admob_banner_unit_id: string | null      // Android banner unit
  admob_ios_banner_unit_id: string | null  // iOS banner unit
}
```

- [ ] **Step 2: Select it in the public route** `src/app/api/ads/active/route.ts`

Old:
```ts
        .select('web_enabled, adsense_publisher_id, adsense_slot_id, native_enabled, admob_ios_app_id, admob_android_app_id, admob_banner_unit_id')
```
New:
```ts
        .select('web_enabled, adsense_publisher_id, adsense_slot_id, native_enabled, admob_ios_app_id, admob_android_app_id, admob_banner_unit_id, admob_ios_banner_unit_id')
```

- [ ] **Step 3: Add to the ops route** `apps/ops/src/app/api/internal/ad-network-config/route.ts`

Old `COLS`:
```ts
const COLS = 'key, web_enabled, adsense_publisher_id, adsense_slot_id, native_enabled, admob_ios_app_id, admob_android_app_id, admob_banner_unit_id, updated_at'
```
New `COLS`:
```ts
const COLS = 'key, web_enabled, adsense_publisher_id, adsense_slot_id, native_enabled, admob_ios_app_id, admob_android_app_id, admob_banner_unit_id, admob_ios_banner_unit_id, updated_at'
```
Old `ALLOWED`:
```ts
  'native_enabled', 'admob_ios_app_id', 'admob_android_app_id', 'admob_banner_unit_id',
```
New `ALLOWED`:
```ts
  'native_enabled', 'admob_ios_app_id', 'admob_android_app_id', 'admob_banner_unit_id', 'admob_ios_banner_unit_id',
```

- [ ] **Step 4: Add the input to `AdsTab.tsx`** — in the `NetworkConfig` interface add `admob_ios_banner_unit_id: string | null`, and in the Native/AdMob grid relabel + add the iOS field. Replace the existing single banner field:

Old:
```tsx
                <Field label="Banner ad-unit ID">
                  <input className="ui-input" value={config.admob_banner_unit_id ?? ''} onChange={(e) => setConfig({ ...config, admob_banner_unit_id: e.target.value || null })} />
                </Field>
```
New:
```tsx
                <Field label="Android banner ad-unit ID">
                  <input className="ui-input" value={config.admob_banner_unit_id ?? ''} onChange={(e) => setConfig({ ...config, admob_banner_unit_id: e.target.value || null })} />
                </Field>
                <Field label="iOS banner ad-unit ID">
                  <input className="ui-input" value={config.admob_ios_banner_unit_id ?? ''} onChange={(e) => setConfig({ ...config, admob_ios_banner_unit_id: e.target.value || null })} />
                </Field>
```
And in the `NetworkConfig` interface (top of file) add after `admob_banner_unit_id: string | null`:
```tsx
  admob_ios_banner_unit_id: string | null
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -E "ad-banner-resolver|ads/active" || echo "public clean"
cd apps/ops && npx tsc --noEmit 2>&1 | grep -E "ad-network-config|AdsTab" || echo "ops clean"; cd ../..
```
Expected: both "clean".

- [ ] **Step 6: Commit**

```bash
git add src/lib/ad-banner-resolver.ts src/app/api/ads/active/route.ts apps/ops/src/app/api/internal/ad-network-config/route.ts "apps/ops/src/app/(app)/ads/_components/AdsTab.tsx"
git commit -m "feat: per-platform AdMob banner unit (iOS) in config, route, ops form"
```

---

## Task 3: Pure eligibility helper (`shouldShowAdMob`, `pickBannerUnit`)

**Files:**
- Create: `src/lib/admob-eligibility.ts`
- Test: `src/lib/__tests__/admob-eligibility.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/admob-eligibility.test.ts
import { describe, it, expect } from 'vitest'
import { shouldShowAdMob, pickBannerUnit, isAdRoute } from '@/lib/admob-eligibility'

describe('isAdRoute', () => {
  it('matches matches/match/player (locale-stripped)', () => {
    expect(isAdRoute('/matches')).toBe(true)
    expect(isAdRoute('/matches/2026-06-03')).toBe(true)
    expect(isAdRoute('/match/abc')).toBe(true)
    expect(isAdRoute('/player/abc')).toBe(true)
  })
  it('rejects other routes', () => {
    expect(isAdRoute('/')).toBe(false)
    expect(isAdRoute('/rankings')).toBe(false)
  })
})

describe('shouldShowAdMob', () => {
  const base = { isNative: true, pathname: '/matches', hasDirectBanner: false, networkNativeEnabled: true }
  it('shows when native, on an ad route, no direct banner, flag on', () => {
    expect(shouldShowAdMob(base)).toBe(true)
  })
  it('hides on web', () => {
    expect(shouldShowAdMob({ ...base, isNative: false })).toBe(false)
  })
  it('hides when a direct banner is present (direct wins)', () => {
    expect(shouldShowAdMob({ ...base, hasDirectBanner: true })).toBe(false)
  })
  it('hides when the network flag is off', () => {
    expect(shouldShowAdMob({ ...base, networkNativeEnabled: false })).toBe(false)
  })
  it('hides off-route', () => {
    expect(shouldShowAdMob({ ...base, pathname: '/rankings' })).toBe(false)
  })
})

describe('pickBannerUnit', () => {
  const cfg = { admob_banner_unit_id: 'android-unit', admob_ios_banner_unit_id: 'ios-unit' }
  it('picks the iOS unit on ios', () => {
    expect(pickBannerUnit('ios', cfg)).toBe('ios-unit')
  })
  it('picks the Android unit on android', () => {
    expect(pickBannerUnit('android', cfg)).toBe('android-unit')
  })
  it('returns null when the platform unit is missing', () => {
    expect(pickBannerUnit('ios', { admob_banner_unit_id: 'x', admob_ios_banner_unit_id: null })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/__tests__/admob-eligibility.test.ts`
Expected: FAIL — cannot resolve `@/lib/admob-eligibility`.

- [ ] **Step 3: Implement**

```ts
// src/lib/admob-eligibility.ts
// Pure helpers for the native AdMob banner controller. No Capacitor imports —
// safe to unit-test and to import anywhere.

/** Routes where the sticky slot (and thus AdMob fill) is allowed. Mirrors
 *  StickyAdBanner's matcher (locale-stripped paths). */
export function isAdRoute(pathname: string): boolean {
  return /^\/(matches(\/|$)|match\/|player\/)/.test(pathname)
}

export function shouldShowAdMob(args: {
  isNative: boolean
  pathname: string
  hasDirectBanner: boolean
  networkNativeEnabled: boolean
}): boolean {
  const { isNative, pathname, hasDirectBanner, networkNativeEnabled } = args
  return isNative && isAdRoute(pathname) && !hasDirectBanner && networkNativeEnabled
}

/** The AdMob banner ad-unit id for the running platform, or null if unset. */
export function pickBannerUnit(
  platform: 'ios' | 'android' | string,
  cfg: { admob_banner_unit_id: string | null; admob_ios_banner_unit_id: string | null },
): string | null {
  if (platform === 'ios') return cfg.admob_ios_banner_unit_id || null
  if (platform === 'android') return cfg.admob_banner_unit_id || null
  return null
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/__tests__/admob-eligibility.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admob-eligibility.ts src/lib/__tests__/admob-eligibility.test.ts
git commit -m "feat: pure AdMob eligibility + platform-unit helpers"
```

---

## Task 4: Install the plugin + Capacitor config

**Files:**
- Modify: `package.json` / lockfile
- Modify: `capacitor.config.ts`

- [ ] **Step 1: Install**

Run: `npm install @capacitor-community/admob@^7`
(If `npm` reports a peer-dep conflict with Capacitor 8, install the version whose peer range includes `@capacitor/core@^8` — check `npm view @capacitor-community/admob versions` and pick the latest matching; record which version in the commit message.)
Expected: package added; `ls node_modules/@capacitor-community/admob` succeeds.

- [ ] **Step 2: Confirm the plugin's exported API** (so later tasks use the right names)

Run: `grep -rEh "showBanner|requestConsentInfo|requestTrackingAuthorization|BannerAdPosition|BannerAdSize|AdmobConsentStatus|initialize" node_modules/@capacitor-community/admob/dist/esm/*.d.ts | head -30`
Expected: the symbols exist. If any name differs, note it and adjust Tasks 6–7.

- [ ] **Step 3: Add the AdMob block to `capacitor.config.ts`** — inside the existing `plugins: { ... }` object, add:

```ts
    AdMob: {
      // App IDs are also set natively (AndroidManifest / Info.plist); this
      // block documents intent and enables plugin config if needed.
      initializeForTesting: false,
    },
```

- [ ] **Step 4: Sync native projects**

Run: `npx cap sync`
Expected: completes; `@capacitor-community/admob` listed in the synced plugins for ios + android.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json capacitor.config.ts ios android
git commit -m "build: add @capacitor-community/admob + cap sync"
```

---

## Task 5: Native config (Android manifest + iOS Info.plist)

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `ios/App/App/Info.plist`

- [ ] **Step 1: Android — add the AdMob App ID meta-data** inside the `<application>` element of `android/app/src/main/AndroidManifest.xml` (next to the existing FCM meta-data):

```xml
        <meta-data
            android:name="com.google.android.gms.ads.APPLICATION_ID"
            android:value="ca-app-pub-8997476366246416~7727014604"/>
```

- [ ] **Step 2: iOS — add keys to `ios/App/App/Info.plist`** (inside the top-level `<dict>`):

```xml
    <key>GADApplicationIdentifier</key>
    <string>ca-app-pub-8997476366246416~3897100718</string>
    <key>NSUserTrackingUsageDescription</key>
    <string>We use this to show you more relevant ads. You can decline and still use the app.</string>
    <key>SKAdNetworkItems</key>
    <array>
      <dict>
        <key>SKAdNetworkIdentifier</key>
        <string>cstr6suwn9.skadnetwork</string>
      </dict>
    </array>
```
(`cstr6suwn9.skadnetwork` is Google's. Add more network IDs later if mediation is enabled — see Google's SKAdNetwork list.)

- [ ] **Step 3: Verify the files parse / build prep**

Run: `npx cap sync ios && npx cap sync android`
Expected: sync completes with no plist/manifest errors. (A full native build happens in the manual verification task.)

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml ios/App/App/Info.plist
git commit -m "build: AdMob app IDs + ATT/SKAdNetwork native config"
```

---

## Task 6: AdMob init + UMP consent + ATT in `native-init.ts`

**Files:**
- Modify: `src/lib/native-init.ts`

- [ ] **Step 1: Add an AdMob init function** near the bottom of `src/lib/native-init.ts` (lazy-import the plugin so the web bundle never sees it — mirrors the Firebase messaging pattern documented at the top of the file):

```ts
// AdMob: initialize the SDK, run the UMP consent flow (required for EEA),
// then the iOS ATT prompt. Lazy-imported so the plugin never enters the web
// bundle. All steps best-effort — never block app boot.
async function initAdMob(): Promise<void> {
  try {
    const { AdMob, AdmobConsentStatus } = await import('@capacitor-community/admob')
    await AdMob.initialize({ initializeForTesting: false })

    // UMP (GDPR / EEA). Show the consent form when one is required + available.
    try {
      const info = await AdMob.requestConsentInfo()
      if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
        await AdMob.showConsentForm()
      }
    } catch (err) {
      console.log('[AdMob] consent flow skipped:', err)
    }

    // iOS App Tracking Transparency — sequenced after UMP. No-op on Android.
    try {
      await AdMob.requestTrackingAuthorization()
    } catch (err) {
      console.log('[AdMob] ATT skipped:', err)
    }
  } catch (err) {
    console.log('[AdMob] init failed:', err)
  }
}
```

- [ ] **Step 2: Call it from `initNative()`** — add a line in the native-only body of `initNative()` (after the existing setup calls, before the function ends):

```ts
  void initAdMob()
```

- [ ] **Step 3: Verify web bundle stays clean**

Run: `npx tsc --noEmit 2>&1 | grep native-init || echo "tsc clean"`
Then: `npx next build 2>&1 | grep -iE "admob|can't resolve" || echo "no admob in web build errors"`
Expected: `tsc clean`; the web build does **not** fail trying to resolve the plugin (the dynamic import keeps it native-only). If `next build` is too slow/heavy in this environment, at minimum confirm `tsc` is clean and that the import is `await import(...)` inside the function (not a top-level import).

- [ ] **Step 4: Commit**

```bash
git add src/lib/native-init.ts
git commit -m "feat: init AdMob + UMP consent + iOS ATT on native boot"
```

---

## Task 7: `useAdMobBanner` controller hook

**Files:**
- Create: `src/components/ads/useAdMobBanner.ts`

- [ ] **Step 1: Implement the controller** (native-only; lazy-imports the plugin; shows/hides the native banner based on the pure eligibility helper)

```ts
// src/components/ads/useAdMobBanner.ts
'use client'

import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { shouldShowAdMob, pickBannerUnit } from '@/lib/admob-eligibility'
import type { AdNetworkConfig } from '@/lib/ad-banner-resolver'

/**
 * Shows/hides the native AdMob adaptive banner (BOTTOM_CENTER, margined above
 * the bottom nav). Native-only — no-ops on web. The banner is a native overlay,
 * not a DOM node. Driven by the same inputs as the web sticky banner:
 *   - pathname (ad-route gate)
 *   - hasDirectBanner (a direct sponsor banner is showing → AdMob stays hidden)
 *   - network config (native_enabled + per-platform banner unit)
 *   - navHeight (margin so the banner sits above the tab bar)
 */
export function useAdMobBanner(args: {
  pathname: string
  hasDirectBanner: boolean
  network: AdNetworkConfig | null
  navHeight: number
}): void {
  const { pathname, hasDirectBanner, network, navHeight } = args
  const shownRef = useRef(false)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const platform = Capacitor.getPlatform() // 'ios' | 'android'
    const eligible = shouldShowAdMob({
      isNative: true,
      pathname,
      hasDirectBanner,
      networkNativeEnabled: !!network?.native_enabled,
    })
    const unit = network ? pickBannerUnit(platform, network) : null

    let cancelled = false
    ;(async () => {
      try {
        const { AdMob, BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob')
        if (eligible && unit) {
          await AdMob.showBanner({
            adId: unit,
            adSize: BannerAdSize.ADAPTIVE_BANNER,
            position: BannerAdPosition.BOTTOM_CENTER,
            margin: Math.max(0, Math.round(navHeight)),
          })
          if (!cancelled) shownRef.current = true
        } else if (shownRef.current) {
          await AdMob.removeBanner()
          if (!cancelled) shownRef.current = false
        }
      } catch (err) {
        console.log('[AdMob] banner toggle failed:', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pathname, hasDirectBanner, network, navHeight])

  // Hide the banner when the component using this hook unmounts.
  useEffect(() => {
    return () => {
      if (!Capacitor.isNativePlatform() || !shownRef.current) return
      void import('@capacitor-community/admob')
        .then(({ AdMob }) => AdMob.removeBanner())
        .catch(() => {})
    }
  }, [])
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit 2>&1 | grep useAdMobBanner || echo "tsc clean"`
Expected: `tsc clean`. (If the plugin's `showBanner` option/enum names differ from Task 4 Step 2, adjust here.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ads/useAdMobBanner.ts
git commit -m "feat: useAdMobBanner native controller (show/hide adaptive banner)"
```

---

## Task 8: Wire `StickyAdBanner` to drive the controller on native

**Files:**
- Modify: `src/components/ads/StickyAdBanner.tsx`

Context: `StickyAdBanner` already computes `country`, `pathname`, `active` (`useActiveBanner('sticky-bottom')` → `{ banners, network }`), `banner` (`pickBanner`), `navHeight`, and `isNative`. We add the controller call so that on native, when there's **no** direct `banner`, AdMob fills the slot.

- [ ] **Step 1: Import the controller** — add near the other imports:

```ts
import { useAdMobBanner } from './useAdMobBanner'
```

- [ ] **Step 2: Call the hook** — add it after `banner`/`navHeight`/`isNative` are computed and before the `if (!visible) return null` early return (hooks must run unconditionally every render):

```ts
  // Native AdMob fill: show the native banner when there's no matching direct
  // banner on an ad route (the hook no-ops on web and when ineligible).
  useAdMobBanner({
    pathname,
    hasDirectBanner: !!banner,
    network: active?.network ?? null,
    navHeight,
  })
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit 2>&1 | grep StickyAd || echo "tsc clean"
npx eslint src/components/ads/StickyAdBanner.tsx src/components/ads/useAdMobBanner.ts src/lib/admob-eligibility.ts 2>&1 | tail -5
npx vitest run src/lib/__tests__/admob-eligibility.test.ts 2>&1 | grep -E "Tests|Test Files"
```
Expected: `tsc clean`; lint clean; tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/ads/StickyAdBanner.tsx
git commit -m "feat: drive native AdMob fill from StickyAdBanner (no direct banner)"
```

---

## Task 9: Verification (web safety + manual native checklist)

**Files:** none (verification only)

- [ ] **Step 1: Web-safety + unit sweep**

```bash
npx vitest run src/lib/__tests__/admob-eligibility.test.ts src/lib/__tests__/ad-banner-resolver.test.ts 2>&1 | grep -E "Tests|Test Files"
npx tsc --noEmit 2>&1 | grep -E "admob|ads/|StickyAd|native-init" || echo "tsc clean"
npx eslint src/components/ads src/lib/admob-eligibility.ts src/lib/native-init.ts 2>&1 | tail -5
# Confirm the plugin is NOT statically imported anywhere (must be dynamic only):
grep -rn "from '@capacitor-community/admob'" src && echo "!! static import found — must be dynamic" || echo "no static admob imports (good)"
```
Expected: tests pass; `tsc clean`; lint clean; **no static imports** of the plugin.

- [ ] **Step 2: Enter the iOS/Android banner units in the admin**

In admin.padelnachos.com → Ad Banners → Network ads: set **Android banner ad-unit ID** = `ca-app-pub-8997476366246416/4978552012`, **iOS banner ad-unit ID** = `ca-app-pub-8997476366246416/7026130851`, App IDs already set. Leave **Native enabled OFF** for now. Save.

- [ ] **Step 3: Manual native verification** (on device/simulator — can't be automated here)

Build & run each platform (`npx cap run ios` / `npx cap run android`, or via Xcode/Android Studio). For first-run test ads, register your **test device ID** (log it from the AdMob SDK init output) in `AdMob.initialize({ testingDevices: ['<ID>'], initializeForTesting: true })` temporarily, or use Google test units, so you never click live ads. Then verify:
  1. On launch in an EEA locale, the **UMP consent form** appears; on iOS the **ATT prompt** follows.
  2. Temporarily set **Native enabled = ON** in admin (and ensure no direct banner targets your test country). Open a matches/match/player page → an AdMob **test banner** renders **above the bottom nav** (not covering it).
  3. Make a direct banner active for your test country → the AdMob banner **disappears** (direct wins).
  4. Set **Native enabled = OFF** → AdMob banner stops showing.
  5. Navigate to a non-ad route (e.g. rankings) → banner hides.
  6. Web (`padelnachos.com` in a browser) shows no behavior change and the plugin is absent from the JS bundle.

- [ ] **Step 4: Note the rollout sequence** (no code) — ship the native build to the stores with `native_enabled = false`; once approved & verified live, flip `native_enabled = ON` in admin (no new release needed). Revert any temporary `initializeForTesting`/test-device code before submitting.

- [ ] **Step 5: Final commit (only if fixes were needed)**

```bash
git add -A
git commit -m "chore: verification fixes for native AdMob banner"
```

---

## Self-Review

**Spec coverage:**
- UMP consent + iOS ATT on boot → Task 6 ✓
- AdMob fills sticky slot as fallback (direct wins) → Tasks 3 (`shouldShowAdMob`), 7, 8 ✓
- Native overlay above nav (margin = navHeight) → Task 7 ✓
- Remote kill-switch via `native_enabled` → Tasks 3, 7 (read from network config) ✓
- Per-platform iOS banner unit (schema + type + route + ops form + selection) → Tasks 1, 2, 3 (`pickBannerUnit`) ✓
- Plugin install + capacitor config + native manifest/plist (App IDs, ATT, SKAdNetwork) → Tasks 4, 5 ✓
- Native-only / web bundle clean (lazy import) → Tasks 6, 7, 9 (grep guard) ✓
- Personalized ads → follows UMP/ATT result (no NPA flag forced) ✓
- Test ad units / ship-disabled rollout → Task 9 ✓
- Out of scope (interstitial, web AdSense, mediation) → not included ✓

**Placeholder scan:** No TBD/placeholder requirements. The plugin-version pin (Task 4) and SKAdNetwork extra IDs are explicit, bounded instructions, not vague work. Native tasks correctly end in build/manual checks because they can't be unit-tested in this environment.

**Type consistency:** `AdNetworkConfig` gains `admob_ios_banner_unit_id` in Task 2 and is consumed with that exact name in Tasks 3 (`pickBannerUnit`), 7, 8. `shouldShowAdMob`/`pickBannerUnit`/`isAdRoute` signatures defined in Task 3 match their calls in Task 7. `useAdMobBanner` args (`pathname`, `hasDirectBanner`, `network`, `navHeight`) defined in Task 7 match the call in Task 8.
