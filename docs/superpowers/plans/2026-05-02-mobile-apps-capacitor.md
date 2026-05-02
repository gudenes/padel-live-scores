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

## Phase 3b — Native push (FCM)

> **Re-spec landed 2026-05-02.** Original Phase 3b was written assuming nothing existed. Reality: the codebase has a complete two-layer notification system already in production — Web Push for browser users, in-app log via `user_notifications`, full settings page at `/profile/settings/notifications`, 3 active triggers (`match_live_follow`, `match_live_bookmark`, `match_finished`), recipient fan-out across bookmarks + follows, dedup via `user_notifications`, stale subscription cleanup. Phase 3b is now scoped to **adding FCM as a third transport** behind the existing pipeline, not building the pipeline.

**Why narrower than the original:**
- ❌ No new triggers — the 3 active ones already fire from `/api/cron/scores` + padelgod
- ❌ No localized payload builders — payloads are already built per-recipient inside `/api/push/notify` (with personalization for follow vs bookmark reason)
- ❌ No new settings UI — `/profile/settings/notifications` already covers it. Single per-category "Push" toggle routes to web *and* FCM transports for users with both subscribed (Slack/Discord pattern)
- ❌ No `user_predictions` work — there's no "prediction resolved" trigger in the existing taxonomy. Predictions stay localStorage-only

iOS deferred until macOS upgrade. Phase 3b ships Android-only FCM; APNs adds later.

### Task 3b.0: Firebase project setup (MANUAL, owner-driven, ~30 min)

This step is for you, not the implementer subagent. Do it before kicking off implementation:

- [ ] Go to console.firebase.google.com → **Create project** named "Padel Nachos"
- [ ] **Add Android app** — package name `com.padelnachos.app`. Download `google-services.json` and place at `android/app/google-services.json`. (Will be gitignored — don't commit.)
- [ ] Firebase console → **Project Settings → Cloud Messaging** → enable Cloud Messaging API if not already on
- [ ] Firebase console → **Project Settings → Service accounts** → click **Generate new private key**. Saves a JSON file
- [ ] Add Vercel env vars (Production + Preview):
  - `FCM_PROJECT_ID` = the `project_id` value from the service account JSON
  - `FCM_SERVICE_ACCOUNT_JSON` = the entire JSON file contents (single line, escape if needed)
- [ ] Update `android/.gitignore`:

  ```gitignore
  # Firebase config — should be present locally but never committed
  android/app/google-services.json
  ```

- [ ] When done, tell the orchestrator. Phase 3b implementation can then proceed.

### Task 3b.1: Schema — `native_push_subscriptions` table

**Files:**
- Create: `supabase/migrations/20260502_native_push_subscriptions.sql`

The existing `push_subscriptions` table stays as-is for Web Push. Native (FCM/APNs) gets its own sibling table — cleaner separation, no risk of breaking the working Web Push system, makes "all transports for user X" a clean UNION across the two tables.

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20260502_native_push_subscriptions.sql
-- Sibling to push_subscriptions (Web Push); stores FCM (Android) and
-- APNs (iOS, future) device tokens separately so Web Push schema
-- stays unchanged. Service-key access only — same pattern as the
-- other Auth.js-era tables (user_badges, match_ratings, etc.).

CREATE TABLE public.native_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  device_token text NOT NULL,
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','es','pt','it','fr')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_token)
);

CREATE INDEX native_push_user_idx ON public.native_push_subscriptions(user_id);
```

- [ ] **Step 2: Apply via Supabase dashboard** SQL editor. Confirm table appears.
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260502_native_push_subscriptions.sql
git commit -m "feat(push): native_push_subscriptions table for FCM/APNs"
```

### Task 3b.2: Endpoint — POST /api/user/native-push-subscriptions

**Files:**
- Create: `src/app/api/user/native-push-subscriptions/route.ts`

Mirrors the existing `/api/user/push-subscriptions` route (same auth pattern via `getUserOrFail()`, same UPSERT shape), but stores FCM/APNs device tokens.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/user/native-push-subscriptions/route.ts
import { getUserOrFail } from '../../_auth'

export async function POST(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const body = await req.json().catch(() => null)
  if (!body || !body.platform || !body.deviceToken) {
    return Response.json({ error: 'Missing platform or deviceToken' }, { status: 400 })
  }
  if (body.platform !== 'android' && body.platform !== 'ios') {
    return Response.json({ error: 'Invalid platform' }, { status: 400 })
  }

  const { error: dbErr } = await supabase
    .from('native_push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        platform: body.platform,
        device_token: body.deviceToken,
        locale: body.locale || 'en',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,device_token' },
    )

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { deviceToken } = await req.json().catch(() => ({}))
  if (!deviceToken) return Response.json({ error: 'Missing deviceToken' }, { status: 400 })

  await supabase
    .from('native_push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('device_token', deviceToken)

  return Response.json({ ok: true })
}
```

- [ ] **Step 2: Run typecheck** — `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit**

```bash
git add src/app/api/user/native-push-subscriptions/
git commit -m "feat(push): /api/user/native-push-subscriptions endpoint"
```

### Task 3b.3: Server-side FCM send helper

**Files:**
- Create: `src/lib/push-fcm.ts`
- Modify: `package.json` (add `firebase-admin`)

- [ ] **Step 1: Install firebase-admin**

```bash
npm install firebase-admin
```

- [ ] **Step 2: Write the helper** — mirrors the existing `src/lib/push.ts` API surface so `/api/push/notify` can call both transports with similar code.

```ts
// src/lib/push-fcm.ts
// Server-side FCM v1 send. Sibling to src/lib/push.ts (Web Push).
// Lazy-initialises firebase-admin on first call so test envs without
// FCM env vars don't crash at module import.

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

export interface FcmPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

export interface FcmSendResult {
  success: number
  failed: number
  /** Tokens FCM rejected as unregistered/invalid — caller should
   *  delete these from native_push_subscriptions. */
  invalidTokens: string[]
}

export async function sendPushToFcmTokens(
  tokens: string[],
  payload: FcmPayload,
): Promise<FcmSendResult> {
  if (tokens.length === 0) return { success: 0, failed: 0, invalidTokens: [] }

  const messaging = admin.messaging(getApp())
  const result = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: {
      url: payload.url || '/',
      tag: payload.tag || 'match-live',
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'padel_default',
        sound: 'default',
        tag: payload.tag,
      },
    },
  })

  const invalid: string[] = []
  result.responses.forEach((r, i) => {
    if (!r.success && r.error) {
      const code = r.error.code
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
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

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/lib/push-fcm.ts
git commit -m "feat(push): server-side FCM send helper"
```

### Task 3b.4: Wire FCM into /api/push/notify

**Files:**
- Modify: `src/app/api/push/notify/route.ts`

The existing route already builds personalized payloads per-recipient (different for "follow" reason vs "bookmark" reason) and calls `sendPush()` from `src/lib/push.ts`. Extend it to ALSO query `native_push_subscriptions` for the same recipients and send via FCM. Same payload, different transport.

- [ ] **Step 1: Find the existing `sendPush` call site(s)** in `src/app/api/push/notify/route.ts`. Document where the per-recipient `payload` object is finalized — that's our hook point.

- [ ] **Step 2: After the existing Web Push fan-out**, add a parallel FCM fan-out:
  - Query `native_push_subscriptions` for the same `recipientUserIds` set (same user IDs the Web Push branch used).
  - For each native subscription, build the same payload that was sent via Web Push for that user (or rebuild it the same way — keep the personalization logic shared).
  - Group tokens by user (a user may have multiple Android devices) and call `sendPushToFcmTokens` once per payload-shape with all matching tokens.
  - Collect `invalidTokens` from FCM responses and `DELETE` them from `native_push_subscriptions`.

- [ ] **Step 3: Update the response shape** to include native send counts:
  ```ts
  return Response.json({
    ok: true,
    recipients,
    inapp_written,
    sent: webPushSent,        // existing
    fcm_sent: fcmSent,        // new
    by_reason: { bookmark, follow },
    stale_cleaned: webStale,  // existing
    fcm_stale_cleaned: fcmStale,  // new
  })
  ```

- [ ] **Step 4: Run typecheck** — `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/push/notify/
git commit -m "feat(push): fan out match notifications to FCM tokens"
```

> **Note for the implementer:** the existing route is large and dense. Read it carefully before editing — keep the existing dedup, recipient fan-out, follow-vs-bookmark personalization, and stale cleanup logic intact. Add FCM as a parallel branch, don't restructure the existing one.

### Task 3b.5: Install @capacitor/push-notifications + native scaffolding

**Files:**
- Modify: `package.json`
- Verify: `android/app/google-services.json` (placed by user in Task 3b.0)
- Possibly modify: `android/app/build.gradle` (Capacitor's plugin auto-applies the google-services Gradle plugin)

- [ ] **Step 1: Install plugin**

```bash
npm install @capacitor/push-notifications
npx cap sync android
```

- [ ] **Step 2: Verify `google-services.json` is present** at `android/app/google-services.json`. If missing, ask the user to complete Task 3b.0.

- [ ] **Step 3: Append to `android/.gitignore`** (if not already done in Task 3b.0):

```gitignore
android/app/google-services.json
```

- [ ] **Step 4: Verify build** — `cd android && ./gradlew assembleDebug && cd ..`. Expected: gradle now applies the google-services plugin automatically (Capacitor handles this) and the build succeeds.

- [ ] **Step 5: Commit** (the .gitignore append + any android/ Capacitor sync output)

```bash
git add package.json package-lock.json android/
git commit -m "feat(push): @capacitor/push-notifications plugin"
```

### Task 3b.6: Wire Capacitor client to register

**Files:**
- Modify: `src/lib/native-init.ts`

Add `initPush()` to the existing native-init module. Same `Capacitor.isNativePlatform()` gate, same try/catch pattern as the other plugin setups in that file.

- [ ] **Step 1: Extend `src/lib/native-init.ts`** — append after the existing back-button listener:

```ts
import { PushNotifications } from '@capacitor/push-notifications'

// ... at the bottom of initNative(), AFTER the back-button listener:

// Push notifications: register the device with FCM (Android) / APNs
// (iOS, future), POST the resulting token to our backend so the
// /api/push/notify fan-out can target this device. Tap routing: when
// the user taps a notification, deep-link via window.location to the
// URL embedded in the notification's data payload.
try {
  const perm = await PushNotifications.requestPermissions()
  if (perm.receive === 'granted') {
    await PushNotifications.register()
  }

  PushNotifications.addListener('registration', async (token) => {
    try {
      await fetch('/api/user/native-push-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: Capacitor.getPlatform(), // 'android' | 'ios'
          deviceToken: token.value,
          locale: navigator.language?.split('-')[0] || 'en',
        }),
      })
    } catch (err) {
      console.warn('[native-init] push register POST failed', err)
    }
  })

  PushNotifications.addListener('registrationError', (err) => {
    console.warn('[native-init] push registration error', err)
  })

  // When user taps a notification, route the WebView to the deep link
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url = action.notification.data?.url
    if (typeof url === 'string' && url.startsWith('/')) {
      window.location.href = url
    }
  })
} catch (err) {
  console.warn('[native-init] PushNotifications setup failed', err)
}
```

- [ ] **Step 2: Run typecheck** — `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/native-init.ts
git commit -m "feat(push): Capacitor client registration + tap routing"
```

### Task 3b.7: End-to-end smoke test (owner-driven)

After all the above is merged + Vercel deploys + APK rebuilt + reinstalled:

- [ ] **Step 1: Sign in to the app** on the Xiaomi device, ensure user has a session
- [ ] **Step 2: Verify token registration** — check `native_push_subscriptions` table in Supabase, should see a row for the device
- [ ] **Step 3: Trigger a test push** via `/api/admin/test-push` with the user's email:

  ```bash
  curl -X POST https://padelnachos.com/api/admin/test-push \
    -H "Authorization: Bearer $CRON_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"email": "your@email.com", "title": "Test 🟢", "body": "FCM hello", "url": "/"}'
  ```

  Note: `/api/admin/test-push` currently only sends Web Push. We may extend it to also send FCM in this task, or use a simpler standalone curl that hits `/api/push/notify` for a real match the user has bookmarked.

- [ ] **Step 4: Verify notification arrives** on the device, taps deep-link to the right page, doesn't fire twice (dedup works)

- [ ] **Step 5: Test the actual triggers** — bookmark a player whose match is starting soon, wait for it to go live, verify push arrives

If all green, Phase 3b is done.

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
