# Mobile apps (Android + iOS) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-05-02-mobile-apps-capacitor-design.md](../specs/2026-05-02-mobile-apps-capacitor-design.md)

**Goal:** Ship Padel Nachos to the Google Play Store with a parallel iOS App Store launch ~14 days later, both as Capacitor apps loading the live `padelnachos.com` Vercel deploy. Native push notifications, deep links, and offline shell included in v1.

**Architecture:** Capacitor in remote URL mode. Single repo (`padel-live-scores`). Native folders excluded from Vercel deploys via `.vercelignore`. All product logic stays in the existing Next.js code; Capacitor only adds the native plugin layer.

**Tech Stack:** Next.js 16, Capacitor 8 (latest stable as of execution; plan was originally drafted against 7), hand-rolled service worker (Phase 1 deviation from the plan), Firebase Cloud Messaging (Android delivery + APNs proxy for iOS when iOS unblocked), Fastlane (build + upload automation).

> **Execution notes (2026-05-02):**
> - **iOS scaffold (Phase 2c, 4) is deferred indefinitely.** Owner machine runs macOS 12 Monterey (Darwin 21.6.0); current Xcode requires macOS 26+. Forcing a macOS upgrade now is friction; iOS will resume after upgrade. Android-only v1 ship plan still holds.
> - **Capacitor 8 not 7.** Capacitor released 8 between plan draft and execution; we installed 8.3.1. API surface for `CapacitorConfig` is unchanged so the config sample below typechecks identically. Phase 2b instructions for `npx cap add android` apply to 8 too — the only real downstream change is Android target SDK / Gradle versions, which Capacitor 8 picks newer defaults for automatically.

---

## Phase 1 — PWA hardening

Make the existing PWA pass Lighthouse's installability check and serve a usable offline state. This is a prerequisite for both Play Store acceptance and good app UX in poor connectivity. Pure web work — no native code touched.

> **Discovery during execution (2026-05-02):** the codebase already has a working hand-rolled service worker at `public/sw.js` with Web Push handlers, plus full client/server push infrastructure (`src/lib/push.ts`, `src/hooks/usePushNotifications.ts`, `/api/user/push-subscriptions`, `push_subscriptions` table with Web Push schema). Original Phase 1 plan called for serwist (Workbox wrapper) but two blockers emerged: (1) `@serwist/next` doesn't support Next 16's default Turbopack build; (2) serwist's `swDest: 'public/sw.js'` would clobber the existing push handlers. **Revised approach: enhance the existing `public/sw.js` directly with precache + offline fallback, no serwist.** Trade-off: lose Workbox's pre-built runtime cache strategies (we'd hand-roll any we want later); gain zero risk of breaking production push, no Turbopack workaround, simpler mental model.

### Task 1.1: Enhance `public/sw.js` with precache + offline fallback

**Files:**
- Modify: `public/sw.js` (existing — keep push handlers intact)
- Modify: `src/app/layout.tsx` (the SW is already registered there — verify the register call survives any layout changes)

- [ ] **Step 1: Read the current `public/sw.js`** to confirm its push + notificationclick handlers, and `src/app/layout.tsx:120` for the existing `navigator.serviceWorker.register('/sw.js')` call.

- [ ] **Step 2: Append precache + offline fallback to `public/sw.js`** — keeping existing push/notificationclick listeners untouched.

```js
// public/sw.js — append to existing file (do NOT replace push handlers)

// ── Precache ────────────────────────────────────────────────────
// Hard-coded list of brand assets we want available offline. Bump
// CACHE_VERSION any time a new asset is added so old caches are
// purged on activate. Keep this list short — it ships every SW
// install. Match cards / score data are network-only (cache-first
// would serve stale scores, which is worse than an offline banner).
const CACHE_VERSION = 'pn-shell-v1'
const PRECACHE_URLS = [
  '/offline',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/padelnachos-logo-v2.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// ── Fetch handler ──────────────────────────────────────────────
// Strategy:
//  - Navigation requests (HTML pages): network first, fall back to
//    the precached /offline page when network fails.
//  - All other requests (assets, API, images): just pass through to
//    the network. We deliberately do NOT cache match scores, API
//    responses, etc. — staleness here is worse than no offline.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  // Navigation request = top-level page load
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/offline').then((res) => res || new Response('Offline', { status: 503 }))
      )
    )
    return
  }
  // Static assets we precached — serve from cache when available
  if (PRECACHE_URLS.includes(new URL(req.url).pathname)) {
    event.respondWith(caches.match(req).then((res) => res || fetch(req)))
    return
  }
  // Everything else: pass through. No SW interference.
})
```

- [ ] **Step 3: Verify `src/app/layout.tsx` already registers the SW** (it should, per the existing setup). If the register call is missing/stale, ensure it looks like:

```tsx
// In src/app/layout.tsx — should already exist near line 120
useEffect(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }
}, [])
```

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

Expected: build succeeds. (No SW generation step — we're shipping the file as-is.)

- [ ] **Step 5: Smoke test in dev**

```bash
npm run dev
```

In Chrome DevTools → Application → Service Workers, confirm `sw.js` is "activated and is running". Trigger an offline nav (DevTools → Network → Offline → reload). Should not crash; should show the `/offline` page (which we'll create in Task 1.2 — until then, expect the fallback to fail with the inline 503 string, that's fine).

- [ ] **Step 6: Commit**

```bash
git add public/sw.js
git commit -m "feat(pwa): precache + offline fallback in sw.js"
```

### Task 1.3: Build the offline fallback page

**Files:**
- Create: `src/app/[locale]/(app)/offline/page.tsx`
- Create: `src/messages/{en,es,pt,it,fr}.json` (add `offline.*` keys)

- [ ] **Step 1: Add translation keys to all 5 locale JSONs**

Add this object inside each `src/messages/{en,es,pt,it,fr}.json`:

```json
"offline": {
  "title": "You're offline",
  "subtitle": "We can't reach the live scores right now. Showing what we last loaded.",
  "retry": "Try again"
}
```

(Translate per locale.)

- [ ] **Step 2: Create the offline page** (`src/app/[locale]/(app)/offline/page.tsx`)

```tsx
'use client'
import { useTranslations } from 'next-intl'

const ORANGE = '#F5A623'
const BG_BASE = '#1A1A1A'
const CHUNKY = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export default function OfflinePage() {
  const t = useTranslations('offline')
  return (
    <div style={{
      minHeight: '100dvh',
      background: BG_BASE,
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      padding: 24,
      textAlign: 'center',
    }}>
      <div style={{
        width: 80, height: 80,
        background: ORANGE,
        clipPath: CHUNKY,
      }} />
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
        {t('title')}
      </h1>
      <p style={{ color: '#6B7280', margin: 0, maxWidth: 320 }}>
        {t('subtitle')}
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: 8,
          padding: '12px 24px',
          background: ORANGE,
          color: '#000',
          border: 'none',
          clipPath: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
          fontWeight: 700,
          fontSize: 14,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {t('retry')}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Manually test** — `npm run dev`, hit `/offline`, verify it renders chunky brand styling.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/\(app\)/offline/page.tsx src/messages/
git commit -m "feat(pwa): offline fallback page"
```

### Task 1.4: Add "as of HH:mm" timestamp to cached match data

**Files:**
- Modify: `src/components/MatchesDayShell.tsx`
- Create: `src/lib/cache-meta.ts`

- [ ] **Step 1: Create cache-meta helper**

```ts
// src/lib/cache-meta.ts
// Detects whether the current page is being served from the service
// worker cache vs. fresh from network. Used to show an "as of HH:mm"
// stamp when the user is offline so they know data may be stale.

export function isServedFromCache(): boolean {
  if (typeof window === 'undefined') return false
  if (!navigator.onLine) return true
  // performance.getEntriesByType('navigation')[0].transferSize === 0
  // when the response came from SW cache
  const nav = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  return nav?.transferSize === 0
}

export function getCacheTimestamp(): Date {
  // The SW could expose this via a postMessage in the future. For now
  // we assume "now-ish" — when the user is offline, the page rendered
  // means the SW served them its cached version.
  return new Date()
}
```

- [ ] **Step 2: Render the stamp in `MatchesDayShell`**

Find the section under the day-pill rail (sticky header) and inject:

```tsx
{!navigator.onLine && (
  <div style={{
    fontSize: 11,
    color: '#F5A623',
    background: 'rgba(245,166,35,0.08)',
    padding: '6px 16px',
    textAlign: 'center',
  }}>
    Offline — showing data as of {getCacheTimestamp().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
  </div>
)}
```

(Wrap in `useEffect` + state if hydration warnings appear — `navigator.onLine` reads differ between server and client.)

- [ ] **Step 3: Commit**

```bash
git add src/components/MatchesDayShell.tsx src/lib/cache-meta.ts
git commit -m "feat(pwa): offline timestamp banner"
```

### Task 1.5: Verify Lighthouse PWA installability

- [ ] **Step 1: Build and serve production**

```bash
npm run build && npm run start
```

- [ ] **Step 2: Run Lighthouse PWA audit**

In Chrome DevTools → Lighthouse → check "Progressive Web App" → Analyze.

Required passes:
- Manifest present and valid ✓ (already)
- Icons including 192px and 512px ✓ (already)
- Service worker registered and controls page
- Offline fallback page loads when SW intercepts a failed nav
- Installable (the "Install" prompt should appear)

- [ ] **Step 3: If installability fails**, check chrome://inspect → Service Workers, ensure SW is registered and active. Common fix: hard reload (Cmd-Shift-R), then re-test.

- [ ] **Step 4: Commit any final tweaks**

---

## Phase 2 — Capacitor scaffold

Create the native shells. After this phase, you can build and run an Android APK and an iOS app, both loading production `padelnachos.com`.

### Task 2.1: Install Capacitor

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Capacitor 7 packages**

```bash
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android @capacitor/ios
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(mobile): add Capacitor 7 packages"
```

### Task 2.2: Initialize Capacitor config

**Files:**
- Create: `capacitor.config.ts`

- [ ] **Step 1: Initialize**

```bash
npx cap init "Padel Nachos" "com.padelnachos.app" --web-dir public
```

- [ ] **Step 2: Edit `capacitor.config.ts` to set the remote URL and plugin defaults**

```ts
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.padelnachos.app',
  appName: 'Padel Nachos',
  webDir: 'public',
  // Remote URL mode — the native shell loads the live deploy.
  // The web app must be HTTPS (Vercel handles this).
  server: {
    url: 'https://padelnachos.com',
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#1A1A1A',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0A0A0A',
    },
  },
}

export default config
```

- [ ] **Step 3: Commit**

```bash
git add capacitor.config.ts
git commit -m "feat(mobile): Capacitor config for production URL"
```

### Task 2.3: Add Android platform

**Files:**
- Create: `android/` (full Android Studio project, generated)
- Modify: `.gitignore`

- [ ] **Step 1: Add the platform**

```bash
npx cap add android
```

- [ ] **Step 2: Update `.gitignore` to skip Android build artifacts**

Append to `.gitignore`:

```gitignore
# Android Studio
android/.gradle/
android/.idea/
android/build/
android/app/build/
android/local.properties
android/captures/
android/.cxx/
*.iml
```

- [ ] **Step 3: Verify build**

```bash
cd android && ./gradlew assembleDebug && cd ..
```

Expected: APK appears at `android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 4: Commit**

```bash
git add android/ .gitignore
git commit -m "feat(mobile): Android Studio project (Capacitor scaffold)"
```

### Task 2.4: Add iOS platform

**Files:**
- Create: `ios/` (full Xcode project, generated)
- Modify: `.gitignore`

- [ ] **Step 1: Add the platform** (must be on macOS with Xcode installed)

```bash
npx cap add ios
```

- [ ] **Step 2: Append iOS gitignores**

Append to `.gitignore`:

```gitignore
# Xcode / iOS
ios/App/Pods/
ios/App/build/
ios/App/DerivedData/
ios/.xcode.env.local
ios/App/App.xcworkspace/xcuserdata/
ios/App/App.xcodeproj/xcuserdata/
ios/App/App.xcodeproj/project.xcworkspace/xcuserdata/
```

- [ ] **Step 3: Verify build via Xcode**

```bash
npx cap open ios
```

In Xcode: Product → Build. Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add ios/ .gitignore
git commit -m "feat(mobile): iOS Xcode project (Capacitor scaffold)"
```

### Task 2.5: Exclude native folders from Vercel

**Files:**
- Create: `.vercelignore`

- [ ] **Step 1: Create `.vercelignore`**

```
android/
ios/
fastlane/
*.gif
.playwright-mcp/
```

- [ ] **Step 2: Commit and push to confirm Vercel deploy still succeeds**

```bash
git add .vercelignore
git commit -m "chore(mobile): exclude native folders from Vercel deploys"
git push
```

Wait for Vercel deploy notification. Confirm green checkmark.

### Task 2.6: Smoke-test both platforms

- [ ] **Step 1: Run Android on emulator/device**

```bash
npx cap run android
```

Expected: app launches, loads `padelnachos.com` home page, navigation works.

- [ ] **Step 2: Run iOS on simulator/device**

```bash
npx cap run ios
```

Expected: same.

- [ ] **Step 3: If web app loads but feels off** (status bar overlap, splash too long, etc.) — note for Phase 3 polish, not a blocker here.

---

## Phase 3a — Simple native plugins

Status bar, splash screen, share, and back-button handling. Each plugin is a quick install + minimal config.

### Task 3a.1: Status bar

**Files:**
- Modify: `package.json`
- Create: `src/lib/native-init.ts`
- Modify: `src/app/[locale]/(app)/layout.tsx` (or root client layout) to call native-init on mount

- [ ] **Step 1: Install plugin**

```bash
npm install @capacitor/status-bar
npx cap sync
```

- [ ] **Step 2: Create native-init**

```ts
// src/lib/native-init.ts
// Initializes Capacitor plugins on app boot. Safe to call from a
// browser context — Capacitor's plugins are no-ops when running on web.

import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

let initialized = false

export async function initNative(): Promise<void> {
  if (initialized || !Capacitor.isNativePlatform()) return
  initialized = true

  // Match the page header's background so there's no visible band.
  await StatusBar.setStyle({ style: Style.Dark })
  await StatusBar.setBackgroundColor({ color: '#0A0A0A' })
}
```

- [ ] **Step 3: Call `initNative()` on first client paint**

Find a top-level client component (e.g., the locale layout's client wrapper or `AuthProvider`) and add:

```tsx
import { useEffect } from 'react'
import { initNative } from '@/lib/native-init'

useEffect(() => { void initNative() }, [])
```

- [ ] **Step 4: Sync + run**

```bash
npx cap sync
npx cap run android
```

Verify status bar is dark with light icons.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/native-init.ts src/app/
git commit -m "feat(mobile): status bar styling"
```

### Task 3a.2: Splash screen

**Files:**
- Modify: `src/lib/native-init.ts`
- Create: `android/app/src/main/res/drawable/splash.png` (1080×1920 brand splash)
- Create: `ios/App/App/Assets.xcassets/Splash.imageset/*` (3 sizes)

- [ ] **Step 1: Install plugin**

```bash
npm install @capacitor/splash-screen
npx cap sync
```

- [ ] **Step 2: Generate splash images**

Use the existing brand polygon SVG in `public/`. Export at:
- Android: 1080×1920 → `android/app/src/main/res/drawable/splash.png`
- iOS: 2732×2732 (universal) → set in `ios/App/App/Assets.xcassets/Splash.imageset/`

(Use Figma / similar; concrete generation steps depend on what brand source files you have.)

- [ ] **Step 3: Hide splash on first paint**

In `src/lib/native-init.ts`, after `StatusBar` setup:

```ts
import { SplashScreen } from '@capacitor/splash-screen'

// Hide splash once React's first paint is committed (~1 frame after mount)
await new Promise(r => requestAnimationFrame(r))
await SplashScreen.hide()
```

- [ ] **Step 4: Sync + verify on both platforms**

```bash
npx cap sync && npx cap run android  # then ios
```

Verify splash shows for ≤1.5s and disappears smoothly.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/native-init.ts android/ ios/
git commit -m "feat(mobile): splash screen with brand polygon"
```

### Task 3a.3: Native share

**Files:**
- Modify: `package.json`
- Modify: existing `useShare` hook or share button components

- [ ] **Step 1: Install plugin**

```bash
npm install @capacitor/share
npx cap sync
```

- [ ] **Step 2: Locate existing Web Share API call sites**

```bash
grep -rn "navigator.share\|navigator\.share" src/ --include="*.tsx" --include="*.ts"
```

- [ ] **Step 3: Replace with Capacitor's `Share.share()`** (it falls back to Web Share API on web automatically)

```ts
import { Share } from '@capacitor/share'

await Share.share({
  title: match.title,
  text: `${match.pair1} vs ${match.pair2}`,
  url: `https://padelnachos.com/match/${match.id}`,
  dialogTitle: 'Share match',
})
```

- [ ] **Step 4: Verify on both platforms** — long-press a match card share button, confirm native share sheet appears.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/
git commit -m "feat(mobile): native share via Capacitor"
```

### Task 3a.4: Hardware back button (Android)

**Files:**
- Modify: `src/lib/native-init.ts`

- [ ] **Step 1: Install plugin**

```bash
npm install @capacitor/app
npx cap sync
```

- [ ] **Step 2: Wire back button to web router history**

```ts
import { App } from '@capacitor/app'

App.addListener('backButton', ({ canGoBack }) => {
  if (canGoBack) {
    window.history.back()
  } else {
    void App.exitApp()
  }
})
```

- [ ] **Step 3: Verify on Android device** — tap back button on home page, confirm app exits cleanly. Tap back from match detail, confirm it returns to previous page.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/native-init.ts
git commit -m "feat(mobile): hardware back button handling"
```

---

## Phase 3b — Push notifications

The largest single subsystem in v1. Two triggers (favourite player goes live, prediction resolved), localized payloads, preferences UI.

> **Re-spec required before starting Phase 3b.** During Phase 1 we discovered the codebase already has a complete Web Push implementation (`src/lib/push.ts`, `src/hooks/usePushNotifications.ts`, `/api/user/push-subscriptions`, `push_subscriptions` table with `endpoint` + `keys` columns). The plan below was written assuming nothing existed. Reality: **Web Push works for browser users today. We need to ADD an FCM/APNs path alongside for native apps**, not replace. Capacitor's WebView doesn't reliably surface Web Push, so native apps need the `@capacitor/push-notifications` plugin → FCM (Android) / APNs (iOS). The existing `push_subscriptions` table needs a column add (`device_token`, `platform`) to coexist with the Web Push columns. Re-do this Phase 3b section with the existing infra in mind before kicking off implementation.

### Task 3b.1: Firebase project setup (manual, ~30 min)

- [ ] **Step 1: Go to console.firebase.google.com → Create project** named "Padel Nachos".
- [ ] **Step 2: Add Android app** — package name `com.padelnachos.app`, download `google-services.json`, place at `android/app/google-services.json`.
- [ ] **Step 3: Add iOS app** — bundle ID `com.padelnachos.app`, download `GoogleService-Info.plist`, place at `ios/App/App/GoogleService-Info.plist`.
- [ ] **Step 4: Enable Cloud Messaging API** in Firebase console → Settings → Cloud Messaging.
- [ ] **Step 5: Generate FCM v1 service account key** — Firebase console → Project settings → Service accounts → Generate new private key. Save JSON securely, NOT in repo.
- [ ] **Step 6: Add to Vercel env vars**:
  - `FCM_PROJECT_ID` (from service account JSON)
  - `FCM_SERVICE_ACCOUNT_JSON` (full JSON contents, single line)

### Task 3b.2: Apple APNs setup (manual, ~45 min, requires Apple Developer account)

- [ ] **Step 1: Apple Developer portal → Certificates → New → APNs Key**. Download `.p8` file.
- [ ] **Step 2: In Firebase console → Project settings → Cloud Messaging → APNs authentication key → Upload** the `.p8` along with key ID and team ID.
- [ ] **Step 3: In Xcode**: select App target → Signing & Capabilities → + Capability → Push Notifications. Then + Capability → Background Modes → check "Remote notifications".
- [ ] **Step 4: Commit any Xcode project file changes**

```bash
git add ios/App/App.xcodeproj/project.pbxproj
git commit -m "feat(mobile): enable APNs push capability on iOS"
```

### Task 3b.3: Database migration — push_subscriptions

**Files:**
- Create: `supabase/migrations/20260502_push_subscriptions.sql`

- [ ] **Step 1: Write migration**

> **Note:** project uses Auth.js v5 (not Supabase Auth), so `user_id` references `public.profiles(id)` (the convention used by `user_badges`, `match_ratings`, etc. in this codebase). Access goes through service-key API endpoints only — RLS stays disabled like the other Auth.js-era tables.

```sql
-- supabase/migrations/20260502_push_subscriptions.sql
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  device_token text NOT NULL,
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','es','pt','it','fr')),
  prefs jsonb NOT NULL DEFAULT '{"player_live": true, "prediction_resolved": true}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_token)
);

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions(user_id);
CREATE INDEX push_subscriptions_token_idx ON public.push_subscriptions(device_token);
```

- [ ] **Step 2: Apply via Supabase dashboard** (paste SQL into SQL editor, run)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260502_push_subscriptions.sql
git commit -m "feat(push): push_subscriptions table"
```

### Task 3b.4: Server endpoint — register a device

**Files:**
- Create: `src/app/api/push/register/route.ts`
- Create: `src/lib/__tests__/push-register.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/push-register.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('POST /api/push/register', () => {
  it('rejects without auth session', async () => {
    // Mock auth() to return null
    vi.doMock('@/auth', () => ({ auth: () => Promise.resolve(null) }))
    const { POST } = await import('@/app/api/push/register/route')
    const req = new Request('http://localhost/api/push/register', {
      method: 'POST',
      body: JSON.stringify({ platform: 'android', deviceToken: 'abc', locale: 'en' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('upserts subscription for authenticated user', async () => {
    // Test wiring TBD when Supabase mock harness is in scope
    expect(true).toBe(true) // placeholder
  })
})
```

- [ ] **Step 2: Run, verify failure** (auth import path mismatch is OK at this stage; the structure is the deliverable)

```bash
npx vitest run src/lib/__tests__/push-register.test.ts
```

- [ ] **Step 3: Implement the endpoint**

```ts
// src/app/api/push/register/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createServerClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || !body.platform || !body.deviceToken) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      user_id: session.user.id,
      platform: body.platform,
      device_token: body.deviceToken,
      locale: body.locale || 'en',
      last_seen_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,device_token',
    })

  if (error) {
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Verify test passes**

```bash
npx vitest run src/lib/__tests__/push-register.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/push/register/ src/lib/__tests__/push-register.test.ts
git commit -m "feat(push): /api/push/register endpoint"
```

### Task 3b.5: Client-side registration

**Files:**
- Modify: `src/lib/native-init.ts`
- Install: `@capacitor/push-notifications`

- [ ] **Step 1: Install plugin**

```bash
npm install @capacitor/push-notifications
npx cap sync
```

- [ ] **Step 2: Wire registration**

```ts
// In src/lib/native-init.ts, append:
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

async function initPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  // Request permission
  const perm = await PushNotifications.requestPermissions()
  if (perm.receive !== 'granted') return

  // Register with the OS — fires 'registration' event with device token
  await PushNotifications.register()

  PushNotifications.addListener('registration', async (token) => {
    // Send to our backend
    await fetch('/api/push/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: Capacitor.getPlatform(), // 'android' | 'ios'
        deviceToken: token.value,
        locale: navigator.language.split('-')[0] || 'en',
      }),
    }).catch(err => console.error('push register failed', err))
  })

  PushNotifications.addListener('registrationError', (err) => {
    console.error('push registration error', err)
  })

  // When user taps a notification, deep-link to the match/etc.
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url = action.notification.data?.url
    if (url) window.location.href = url
  })
}

// Call from the existing initNative()
export async function initNative(): Promise<void> {
  // ...existing status bar / splash code
  await initPush()
}
```

- [ ] **Step 3: Build and run on device**

```bash
npx cap sync && npx cap run android
```

Watch logcat: `adb logcat | grep -i fcm` — verify token logged.

- [ ] **Step 4: Verify token landed in `push_subscriptions` table** via Supabase dashboard.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/native-init.ts
git commit -m "feat(push): client-side device registration"
```

### Task 3b.6: Server-side FCM send helper

**Files:**
- Create: `src/lib/push-server.ts`
- Create: `src/lib/__tests__/push-server.test.ts`

- [ ] **Step 1: Install firebase-admin**

```bash
npm install firebase-admin
```

- [ ] **Step 2: Write the helper**

```ts
// src/lib/push-server.ts
// Server-side FCM v1 push send. Unifies Android (direct FCM) and iOS
// (FCM proxies to APNs). Reads service account from env at boot;
// initialized lazily so test envs don't crash.

import admin from 'firebase-admin'

let app: admin.app.App | null = null

function getApp(): admin.app.App {
  if (app) return app
  const json = process.env.FCM_SERVICE_ACCOUNT_JSON
  if (!json) throw new Error('FCM_SERVICE_ACCOUNT_JSON env var missing')
  const credentials = JSON.parse(json)
  app = admin.initializeApp({
    credential: admin.credential.cert(credentials),
    projectId: process.env.FCM_PROJECT_ID,
  })
  return app
}

export interface PushPayload {
  title: string
  body: string
  url?: string  // deep link path for notification tap
  imageUrl?: string
}

export async function sendPushToTokens(
  tokens: string[],
  payload: PushPayload,
): Promise<{ success: number; failed: number; invalidTokens: string[] }> {
  if (tokens.length === 0) return { success: 0, failed: 0, invalidTokens: [] }

  const messaging = admin.messaging(getApp())
  const result = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: payload.title,
      body: payload.body,
      imageUrl: payload.imageUrl,
    },
    data: {
      url: payload.url || '/',
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'padel_default',
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: { sound: 'default', badge: 1 },
      },
    },
  })

  // Identify expired/invalid tokens so caller can clean them up
  const invalid: string[] = []
  result.responses.forEach((r, i) => {
    if (!r.success && r.error) {
      const code = r.error.code
      if (code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token') {
        invalid.push(tokens[i])
      }
    }
  })

  return {
    success: result.successCount,
    failed: result.failureCount,
    invalidTokens: invalid,
  }
}
```

- [ ] **Step 3: Smoke test** — manual, send test push to your device using Firebase console → Cloud Messaging → Send your first message. Verify it lands.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/push-server.ts
git commit -m "feat(push): server-side FCM send helper"
```

### Task 3b.7: Localized payload builders

**Files:**
- Create: `src/lib/push-payloads.ts`
- Modify: `src/messages/{en,es,pt,it,fr}.json` (add `push.*` keys)

- [ ] **Step 1: Add translation keys to all 5 locales**

```json
"push": {
  "playerLive": {
    "title": "{playerName} is on court!",
    "body": "Live now: {pair1} vs {pair2} — {tournamentName}"
  },
  "predictionResolved": {
    "titleWin": "You called it! 🎯",
    "titleLoss": "Match over",
    "body": "{pair1} vs {pair2} — {result}"
  }
}
```

(Translate per locale.)

- [ ] **Step 2: Write the payload builder**

```ts
// src/lib/push-payloads.ts
// Builds localized push payloads. Mirrors the createTranslator pattern
// used by the welcome email so the same JSON files drive both channels.

import { createTranslator } from 'next-intl'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import pt from '@/messages/pt.json'
import it from '@/messages/it.json'
import fr from '@/messages/fr.json'
import type { PushPayload } from './push-server'

const messages = { en, es, pt, it, fr } satisfies Record<string, unknown>
type Locale = keyof typeof messages

function t(locale: string) {
  const safe = (locale in messages ? locale : 'en') as Locale
  return createTranslator({ locale: safe, messages: messages[safe] as never })
}

export function buildPlayerLivePayload(input: {
  locale: string
  playerName: string
  pair1: string
  pair2: string
  tournamentName: string
  matchId: string
}): PushPayload {
  const tr = t(input.locale)
  return {
    title: tr('push.playerLive.title', { playerName: input.playerName }),
    body: tr('push.playerLive.body', {
      pair1: input.pair1,
      pair2: input.pair2,
      tournamentName: input.tournamentName,
    }),
    url: `/match/${input.matchId}`,
  }
}

export function buildPredictionResolvedPayload(input: {
  locale: string
  pair1: string
  pair2: string
  result: string
  matchId: string
  userPredictionCorrect: boolean
}): PushPayload {
  const tr = t(input.locale)
  return {
    title: tr(input.userPredictionCorrect ? 'push.predictionResolved.titleWin' : 'push.predictionResolved.titleLoss'),
    body: tr('push.predictionResolved.body', {
      pair1: input.pair1,
      pair2: input.pair2,
      result: input.result,
    }),
    url: `/match/${input.matchId}`,
  }
}
```

- [ ] **Step 3: Add unit tests**

```ts
// src/lib/__tests__/push-payloads.test.ts
import { describe, it, expect } from 'vitest'
import { buildPlayerLivePayload } from '../push-payloads'

describe('buildPlayerLivePayload', () => {
  it('renders English title with player name', () => {
    const p = buildPlayerLivePayload({
      locale: 'en', playerName: 'Tapia',
      pair1: 'Tapia/Coello', pair2: 'Galan/Chingotto',
      tournamentName: 'Miami P1', matchId: 'abc',
    })
    expect(p.title).toContain('Tapia')
    expect(p.url).toBe('/match/abc')
  })

  it('falls back to en for unknown locale', () => {
    const p = buildPlayerLivePayload({
      locale: 'xyz', playerName: 'Tapia',
      pair1: 'A/B', pair2: 'C/D',
      tournamentName: 'X', matchId: 'q',
    })
    expect(p.title).toBeDefined()
  })
})
```

```bash
npx vitest run src/lib/__tests__/push-payloads.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/push-payloads.ts src/lib/__tests__/push-payloads.test.ts src/messages/
git commit -m "feat(push): localized payload builders"
```

### Task 3b.8: Trigger — bookmarked-player-live

**Files:**
- Modify: `src/app/api/cron/scores/route.ts` (or wherever match-status transitions happen)
- Create: `src/lib/push-triggers.ts`

- [ ] **Step 1: Write the trigger function**

```ts
// src/lib/push-triggers.ts
import { createServerClient } from '@/lib/supabase'
import { sendPushToTokens } from './push-server'
import { buildPlayerLivePayload } from './push-payloads'

export async function notifyPlayerWentLive(matchId: string): Promise<void> {
  const supabase = createServerClient()

  // Look up match details + player IDs
  const { data: match } = await supabase
    .from('matches')
    .select(`
      id,
      pair1_player1:pair1_player1_id(id, name),
      pair1_player2:pair1_player2_id(id, name),
      pair2_player1:pair2_player1_id(id, name),
      pair2_player2:pair2_player2_id(id, name),
      tournament:tournament_id(name)
    `)
    .eq('id', matchId)
    .single()
  if (!match) return

  const playerIds = [
    match.pair1_player1?.id,
    match.pair1_player2?.id,
    match.pair2_player1?.id,
    match.pair2_player2?.id,
  ].filter(Boolean) as string[]

  // Find users who bookmarked any of these players (table assumed to exist)
  const { data: subs } = await supabase
    .from('user_bookmarked_players')
    .select(`
      user_id,
      player_id,
      push_subscriptions:user_id(device_token, locale, prefs)
    `)
    .in('player_id', playerIds)

  if (!subs) return

  // Group tokens by locale + bookmarked player so payloads are personalized
  const byLocale = new Map<string, { tokens: string[]; playerName: string }>()
  for (const row of subs) {
    const subsArr = row.push_subscriptions as Array<{ device_token: string; locale: string; prefs: { player_live?: boolean } }>
    for (const sub of subsArr) {
      if (sub.prefs?.player_live === false) continue
      const playerName = playerIds
        .map(pid => [match.pair1_player1, match.pair1_player2, match.pair2_player1, match.pair2_player2]
          .find(p => p?.id === row.player_id)?.name)
        .find(Boolean) || ''
      const key = `${sub.locale}::${playerName}`
      if (!byLocale.has(key)) byLocale.set(key, { tokens: [], playerName })
      byLocale.get(key)!.tokens.push(sub.device_token)
    }
  }

  // Send a per-locale-per-player batch
  const pair1Names = [match.pair1_player1?.name, match.pair1_player2?.name].filter(Boolean).join('/')
  const pair2Names = [match.pair2_player1?.name, match.pair2_player2?.name].filter(Boolean).join('/')

  for (const [key, { tokens, playerName }] of byLocale) {
    const locale = key.split('::')[0]
    const payload = buildPlayerLivePayload({
      locale, playerName,
      pair1: pair1Names, pair2: pair2Names,
      tournamentName: match.tournament?.name || '',
      matchId: match.id,
    })
    await sendPushToTokens(tokens, payload)
  }
}
```

- [ ] **Step 2: Hook into the score-transition logic**

In `src/app/api/cron/scores/route.ts`, find where matches transition to `status: 'live'` and call:

```ts
import { notifyPlayerWentLive } from '@/lib/push-triggers'

// After the match status update succeeds:
if (newStatus === 'live' && oldStatus !== 'live') {
  await notifyPlayerWentLive(match.id).catch(err => console.error('push trigger failed', err))
}
```

- [ ] **Step 3: Test manually** — bookmark a player on your test account, wait for one of their matches to transition to live, verify push arrives.

- [ ] **Step 4: Commit**

```bash
git add src/lib/push-triggers.ts src/app/api/cron/scores/route.ts
git commit -m "feat(push): trigger when bookmarked player goes live"
```

### Task 3b.9: Trigger — prediction resolved

**Files:**
- Modify: `src/lib/push-triggers.ts`
- Modify: wherever match-finished propagation happens (likely `src/app/api/cron/scores/route.ts` or `relay/index.js`)

- [ ] **Step 1: Add the trigger** to `src/lib/push-triggers.ts`

```ts
import { buildPredictionResolvedPayload } from './push-payloads'

export async function notifyPredictionResolved(matchId: string): Promise<void> {
  const supabase = createServerClient()

  // Look up match + winner
  const { data: match } = await supabase
    .from('matches')
    .select('id, winner_pair, pair1_player1:pair1_player1_id(name), pair1_player2:pair1_player2_id(name), pair2_player1:pair2_player1_id(name), pair2_player2:pair2_player2_id(name), final_score')
    .eq('id', matchId)
    .single()
  if (!match || !match.winner_pair) return

  // Find users who predicted this match (predictions stored in localStorage
  // currently — for v1 push we only fire if user logged in AND we tracked
  // their prediction server-side, e.g., via user_predictions table).
  const { data: predictions } = await supabase
    .from('user_predictions')
    .select('user_id, predicted_pair, push_subscriptions:user_id(device_token, locale, prefs)')
    .eq('match_id', matchId)

  if (!predictions) return

  const pair1 = [match.pair1_player1?.name, match.pair1_player2?.name].filter(Boolean).join('/')
  const pair2 = [match.pair2_player1?.name, match.pair2_player2?.name].filter(Boolean).join('/')
  const result = match.final_score || ''

  for (const pred of predictions) {
    const subsArr = pred.push_subscriptions as Array<{ device_token: string; locale: string; prefs: { prediction_resolved?: boolean } }>
    const correct = pred.predicted_pair === match.winner_pair
    for (const sub of subsArr) {
      if (sub.prefs?.prediction_resolved === false) continue
      const payload = buildPredictionResolvedPayload({
        locale: sub.locale, pair1, pair2, result,
        matchId: match.id,
        userPredictionCorrect: correct,
      })
      await sendPushToTokens([sub.device_token], payload)
    }
  }
}
```

> **Open dependency:** the spec mentions predictions are currently localStorage-only. To trigger this push reliably, predictions need to land in a `user_predictions` table for logged-in users. If that table doesn't exist yet, add it as a prerequisite migration before this trigger ships, or scope the v1 push to bookmarked-player-live only and ship prediction-resolved in v1.1.

- [ ] **Step 2: Hook into match-finished logic** — wherever `winner_pair` gets set or status flips to `finished`:

```ts
import { notifyPredictionResolved } from '@/lib/push-triggers'

// After the match.winner_pair is committed:
await notifyPredictionResolved(match.id).catch(err => console.error('prediction push failed', err))
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/push-triggers.ts src/app/api/
git commit -m "feat(push): trigger when user prediction resolves"
```

### Task 3b.10: Notification preferences UI

**Files:**
- Create: `src/app/[locale]/(app)/profile/notifications/page.tsx`
- Create: `src/app/api/push/prefs/route.ts`

- [ ] **Step 1: Create the prefs endpoint**

```ts
// src/app/api/push/prefs/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createServerClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { prefs } = await req.json()
  if (!prefs || typeof prefs !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { error } = await supabase
    .from('push_subscriptions')
    .update({ prefs })
    .eq('user_id', session.user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Create the prefs page** — chunky styled toggles for `player_live` and `prediction_resolved` (one row per pref, lime active state). Pull initial state from `push_subscriptions` table for the logged-in user; on change, POST to `/api/push/prefs`.

(Skeleton — fill out per existing profile-page styling)

```tsx
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'

export default function NotificationsPage() {
  const { user } = useAuth()
  const [prefs, setPrefs] = useState({ player_live: true, prediction_resolved: true })

  useEffect(() => {
    if (!user) return
    supabase.from('push_subscriptions').select('prefs').eq('user_id', user.id).limit(1)
      .then(({ data }) => { if (data?.[0]?.prefs) setPrefs(data[0].prefs) })
  }, [user])

  async function toggle(key: keyof typeof prefs) {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    await fetch('/api/push/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs: next }),
    })
  }

  // ...render chunky toggle rows for each pref
}
```

- [ ] **Step 3: Add link from `/profile` to `/profile/notifications`**

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/\(app\)/profile/notifications/ src/app/api/push/prefs/
git commit -m "feat(push): /profile/notifications preferences UI"
```

---

## Phase 3c — Deep links

When a user taps `padelnachos.com/match/abc` in any other app and they have Padel Nachos installed, it should open in the app instead of a browser tab.

### Task 3c.1: Android App Links

**Files:**
- Create: `public/.well-known/assetlinks.json`
- Modify: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Get the SHA-256 fingerprint of your upload key** (the one generated in Task 4.1 for Play Store)

```bash
keytool -list -v -keystore upload-keystore.jks -alias upload | grep SHA256
```

- [ ] **Step 2: Create `public/.well-known/assetlinks.json`**

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.padelnachos.app",
      "sha256_cert_fingerprints": [
        "AA:BB:CC:DD:..."
      ]
    }
  }
]
```

- [ ] **Step 3: Update `next.config.ts` to expose `.well-known/` correctly**

Most Next.js setups already serve `public/.well-known/*` at `/.well-known/*` — verify by deploying and `curl https://padelnachos.com/.well-known/assetlinks.json`.

- [ ] **Step 4: Update Android manifest to declare deep link patterns**

In `android/app/src/main/AndroidManifest.xml`, inside the main `<activity>`:

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="padelnachos.com" />
</intent-filter>
```

- [ ] **Step 5: Commit**

```bash
git add public/.well-known/assetlinks.json android/app/src/main/AndroidManifest.xml
git commit -m "feat(mobile): Android App Links for padelnachos.com"
```

### Task 3c.2: iOS Universal Links

**Files:**
- Create: `public/.well-known/apple-app-site-association` (no extension)
- Modify: Xcode entitlements

- [ ] **Step 1: Get your team ID** from Apple Developer portal → Membership

- [ ] **Step 2: Create `public/.well-known/apple-app-site-association`**

```json
{
  "applinks": {
    "apps": [],
    "details": [{
      "appID": "TEAMID.com.padelnachos.app",
      "paths": ["/match/*", "/tournaments/*", "/player/*"]
    }]
  }
}
```

- [ ] **Step 3: Ensure it's served as `application/json`** — Next.js may need a custom route or header config:

```ts
// In next.config.ts headers():
{
  source: '/.well-known/apple-app-site-association',
  headers: [{ key: 'Content-Type', value: 'application/json' }],
}
```

- [ ] **Step 4: Add Associated Domains capability in Xcode**

App target → Signing & Capabilities → + Capability → Associated Domains → add `applinks:padelnachos.com`.

- [ ] **Step 5: Commit**

```bash
git add public/.well-known/apple-app-site-association next.config.ts ios/
git commit -m "feat(mobile): iOS Universal Links for padelnachos.com"
```

### Task 3c.3: Wire URL handler in the app

**Files:**
- Modify: `src/lib/native-init.ts`

- [ ] **Step 1: Listen for incoming URLs**

```ts
import { App } from '@capacitor/app'

App.addListener('appUrlOpen', ({ url }) => {
  // Strip the origin so Next.js router handles the path
  try {
    const parsed = new URL(url)
    const path = parsed.pathname + parsed.search
    window.location.href = path
  } catch {
    // ignore
  }
})
```

- [ ] **Step 2: Test on both platforms** — share a `padelnachos.com/match/<id>` link via WhatsApp / Notes, tap it, verify it opens the app on the right page.

- [ ] **Step 3: Commit**

```bash
git add src/lib/native-init.ts
git commit -m "feat(mobile): handle deep links via appUrlOpen"
```

---

## Phase 4 — Android Play Store submission

### Task 4.1: Generate upload keystore

- [ ] **Step 1: Generate keystore**

```bash
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias upload
```

- [ ] **Step 2: Save passwords to 1Password** under "Padel Nachos Android Upload Keystore". Do NOT commit the .jks file.

- [ ] **Step 3: Add keystore path to `.gitignore`**

```gitignore
*.jks
*.keystore
```

- [ ] **Step 4: Configure Android signing** — edit `android/app/build.gradle`:

```gradle
android {
  signingConfigs {
    release {
      storeFile file(System.getenv("KEYSTORE_PATH") ?: "../../upload-keystore.jks")
      storePassword System.getenv("KEYSTORE_PASSWORD")
      keyAlias System.getenv("KEY_ALIAS") ?: "upload"
      keyPassword System.getenv("KEY_PASSWORD")
    }
  }
  buildTypes {
    release {
      signingConfig signingConfigs.release
      minifyEnabled true
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }
}
```

### Task 4.2: Generate adaptive icon

- [ ] **Step 1: Create foreground + background SVG/PNG** at 432×432 each
- [ ] **Step 2: Use Android Studio's Image Asset Studio** (right-click `app/src/main/res` → New → Image Asset → Launcher Icons (Adaptive and Legacy)) to generate all density buckets

### Task 4.3: Build first signed AAB

- [ ] **Step 1: Build**

```bash
KEYSTORE_PATH=$(pwd)/upload-keystore.jks \
KEYSTORE_PASSWORD=... \
KEY_PASSWORD=... \
cd android && ./gradlew bundleRelease && cd ..
```

- [ ] **Step 2: Output located at** `android/app/build/outputs/bundle/release/app-release.aab`

### Task 4.4: Play Console — create app listing

(Manual, ~1–2 hours)

- [ ] **Step 1: $25 dev account at play.google.com/console**
- [ ] **Step 2: Create app — name, default language English, app type App, free**
- [ ] **Step 3: Privacy policy URL** — link to existing `/privacy` page (or create one)
- [ ] **Step 4: Data safety questionnaire** — declare what we collect (email for auth, device push tokens, basic analytics)
- [ ] **Step 5: Content rating questionnaire** — answer truthfully, expect "Everyone"
- [ ] **Step 6: Upload assets** — feature graphic 1024×500, 4–8 phone screenshots from your dev device
- [ ] **Step 7: Description** — short (80 char) + full (4000 char). Reuse the about page copy.

### Task 4.5: Internal testing → closed → production

- [ ] **Step 1: Internal testing** — Play Console → Testing → Internal testing → upload the AAB → add yourself + 1-2 testers via email
- [ ] **Step 2: Verify the app installs from the Play link, push notifications work, deep links work**
- [ ] **Step 3: Promote to closed testing** — recruit 20+ testers, let it run for 14 calendar days. Google requires this for new dev accounts.
- [ ] **Step 4: After 14 days** — promote to production. First review takes 1–7 days.
- [ ] **Step 5: 🎉 Public launch**

---

## Phase 5 — iOS App Store submission (~14 days after Android)

### Task 5.1: Apple Developer Program signup

(Manual, ~24 hours for approval, $99/year)

- [ ] **Step 1: developer.apple.com → Enroll** — pay $99
- [ ] **Step 2: Wait for approval email** (~24h)

### Task 5.2: Signing certs and provisioning

- [ ] **Step 1: Xcode → Preferences → Accounts → Add Apple ID**
- [ ] **Step 2: App target → Signing & Capabilities → check "Automatically manage signing"** — Xcode generates dev + dist certs
- [ ] **Step 3: Verify the app builds for Release configuration**

### Task 5.3: iOS app icons

- [ ] **Step 1: Generate all sizes** — use AppIcon.co or Xcode's asset catalog at `ios/App/App/Assets.xcassets/AppIcon.appiconset/`
- [ ] **Step 2: Verify in Xcode**

### Task 5.4: App Store Connect listing

(Manual, ~2 hours)

- [ ] **Step 1: appstoreconnect.apple.com → My Apps → New App** — bundle ID `com.padelnachos.app`, name "Padel Nachos"
- [ ] **Step 2: App information** — category Sports, second category News
- [ ] **Step 3: Privacy** — fill out App Privacy details (more granular than Google)
- [ ] **Step 4: Pricing & Availability** — Free, all territories
- [ ] **Step 5: Screenshots** — 6.5" iPhone (1284×2778) at minimum, 5.5" iPhone optional but improves conversion
- [ ] **Step 6: App description, keywords, support URL, marketing URL**

### Task 5.5: Submit to TestFlight → App Review

- [ ] **Step 1: Archive the app** — Xcode → Product → Archive
- [ ] **Step 2: Upload to App Store Connect** via Xcode Organizer
- [ ] **Step 3: TestFlight build review** — Apple processes (1–2 days), then internal testers can install
- [ ] **Step 4: Submit for App Review** — App Store Connect → Submit for Review → answer the export compliance + content rights questions
- [ ] **Step 5: Review takes 1–2 days first time, expect 1 rejection round** (common reasons: "thin web wrapper" — mitigate by emphasizing native push + share + universal links in the review notes)
- [ ] **Step 6: 🎉 Public launch on App Store**

---

## Acceptance criteria

A user can:

1. Install Padel Nachos from the Play Store (and later App Store)
2. Open the app and land on the home page with the same UX as the web
3. Receive a push notification when a bookmarked player goes live, tap it, and land on the match page inside the app
4. Receive a push notification when their match prediction resolves
5. Tap a `padelnachos.com/match/...` link in any other app and have it open inside Padel Nachos (if installed)
6. Open the app while offline and see the last-loaded matches with an "as of HH:mm" timestamp
7. Toggle each notification trigger off in `/profile/notifications`

## Rollback plan per phase

| Phase | Rollback |
|---|---|
| Phase 1 (PWA hardening) | `withSerwist({ disable: true })` in `next.config.ts` — SW unregisters on next visit |
| Phase 2 (Capacitor scaffold) | Native folders ignored — no production impact possible |
| Phase 3 (native plugins) | Each plugin no-ops on web — web app unaffected by any plugin failure |
| Phase 4 (Android live) | Roll back AAB version code in Play Console; users on previous version unaffected |
| Phase 5 (iOS live) | Same — App Store Connect → revert to previous binary |

## Open dependencies

- `user_bookmarked_players` table — assumed to exist; verify before Phase 3b.8
- `user_predictions` table — currently localStorage only per CLAUDE.md; needs server-side equivalent for prediction-resolved push to fire reliably for logged-in users. Either ship this table as a prerequisite, or scope v1 push to player-live only and add prediction-resolved in v1.1.
- Existing `assetlinks.json` / `apple-app-site-association` paths in `next.config.ts` headers — verify these are served with correct Content-Type
- Brand splash screen assets (1080×1920 Android, 2732×2732 iOS) — needs design work or extraction from existing brand SVGs
