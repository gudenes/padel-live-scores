# Replace Vercel with Railway + Cloudflare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `padelnachos.com` (and later admin/labs) off Vercel and run the Next.js apps on Railway, with Cloudflare in front for DNS, CDN, WAF, and geo — without touching padelgod, relay, OCR, Supabase, or shipping a new store binary.

**Architecture:** Cloudflare becomes the public edge for `padelnachos.com`. A new Railway service (`padelnachos-web`) in project `hearty-charm` (EU West, same project as padelgod) runs `next start`. A second Railway service (`padelnachos-cron`) curls the existing `/api/cron/*` routes on the schedules currently in `vercel.json`. Capacitor stays in remote-URL mode on `https://padelnachos.com`. Cutover is a Cloudflare origin switch; Vercel stays up for 48–72h as instant rollback.

**Tech Stack:** Next.js 16 (`next start`), Railway Railpack, Cloudflare DNS/proxy, existing Auth.js + `pg` + Supabase, vitest.

**Out of scope:** rewriting live score, moving padelgod/relay/OCR, OpenNext/Workers as the host, new Play Store / App Store binaries, changing `server.url` in Capacitor.

---

## File Structure

**Created:**

- `src/lib/request-geo.ts` — pure helper: country + timezone from request headers (CF first, Vercel fallback, then `countryToTimezone`).
- `src/lib/__tests__/request-geo.test.ts` — unit tests for the header precedence.
- `src/lib/public-app-url.ts` — single place to resolve the public origin (no more `VERCEL_URL` hard-wires).
- `src/lib/__tests__/public-app-url.test.ts`
- `src/lib/runtime-env.ts` — `isProdRuntime()` / Sentry env+release, so we stop depending on `VERCEL_ENV`.
- `src/app/api/health/route.ts` — Railway healthcheck (`GET` → `{ ok: true }`).
- `scripts/railway-cron-runner.mjs` — one Node process with the vercel.json schedule table; HTTP-hits the web service.
- `railway.toml` — build/start/healthcheck for `padelnachos-web` (repo root).
- `docs/runbooks/replace-vercel-cutover.md` — operator cutover + rollback.

**Modified:**

- `src/proxy.ts` — use `resolveRequestGeo`; keep Vercel headers as fallback during the dual-origin window.
- `src/i18n/request.ts` — comment only (still reads `geo-timezone` cookie).
- `src/hooks/useUserCountry.ts` — comment only (cookie source is now CF-or-Vercel).
- `next.config.ts` — add `headers()` for `/.well-known/apple-app-site-association` and `assetlinks.json` (Railway has no `vercel.json` headers).
- `instrumentation.ts` — Sentry enabled on Railway production too.
- `src/lib/analytics-init.ts` — Sentry env/release fallbacks include `RAILWAY_*`.
- `src/auth.ts` — `pg` pool `max` from `PG_POOL_MAX` (default 8 on Railway, 1 remains fine locally if unset we pick 8 when `RAILWAY_ENVIRONMENT` is set else 1).
- `src/app/api/cron/scores/route.ts` and `src/app/api/cron/sync/route.ts` — `baseUrl` via `publicAppUrl()`.
- `src/app/api/admin/dev-login/route.ts` — treat Railway production as secure cookie context.
- `src/app/ops/page.tsx` — host fallback without `VERCEL_URL`.
- `vercel.json` — leave crons in place until cutover is declared done; last task empties `crons`.
- `CLAUDE.md` / `MONOREPO.md` — deployment map (Vercel → Railway + Cloudflare).

**Do not touch:**

- `capacitor.config.ts` (`server.url` stays `https://padelnachos.com`)
- `ios/`, `android/`, `public/.well-known/*` contents
- `padelgod/`, `relay/`, `apps/ocr-worker/`
- Railway service `precious-unity` / `padel-live-scores` (that **is** the relay)

---

## What Gustavo needs to prepare (do this first)

Nothing in Tasks 1–3 requires DNS yet. Tasks 4–7 block on the items below. Gather them into a single note (1Password / a local scratch file — **do not commit secrets**).

### Accounts and access

- [ ] **Cloudflare** — account that can add the zone `padelnachos.com` (and later `padellabs.tech`). If the domain is at another registrar, you only need permission to change nameservers.
- [ ] **Registrar login** — wherever `padelnachos.com` NS records live today (often the registrar, sometimes Vercel/Google Domains/Cloudflare already).
- [ ] **Railway** — already signed in as `gudenes@gmail.com`. Confirm you can create services in project **`hearty-charm`** (`ec638a56-c42f-4fa6-9216-dcd7668e34b7`), EU West. We will **not** reuse service `padel-live-scores` in `precious-unity`.
- [ ] **Vercel** — dashboard access to projects `padelnachos`, `padelnachos-admin`, `padel-labs` to dump env vars and, later, pause crons.
- [ ] **Google Cloud Console** — OAuth client used by the main app (Authorized JavaScript origins + redirect URIs). We keep `https://padelnachos.com` so **no change** unless a stray `*.vercel.app` is the only origin (it must not be).
- [ ] **Apple Developer** — Services ID / Sign in with Apple return URL is `https://padelnachos.com/api/auth/callback/apple`. No change if the domain stays. Confirm it, do not edit.
- [ ] **Firebase / FCM** — `FCM_SERVICE_ACCOUNT_JSON` and `FCM_PROJECT_ID` must exist on Vercel today (native sign-in + Android push). Export them; they are required on Railway or store login/push dies.
- [ ] **Sentry + PostHog + Resend** — no account change. We only remap env.

### Dump from Vercel (Production + Preview)

From Vercel → `padelnachos` → Settings → Environment Variables, copy **names and values** for Production into a local secrets file. Expected names (local `.env.local` is a subset — Production has more):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_SERVICE_KEY
DATABASE_URL
AUTH_SECRET
AUTH_URL                          # must be https://padelnachos.com after cutover
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
AUTH_APPLE_ID
AUTH_APPLE_TEAM_ID
AUTH_APPLE_KEY_ID
AUTH_APPLE_PRIVATE_KEY
AUTH_EMAIL_FROM
RESEND_API_KEY
CRON_SECRET
RELAY_SECRET
RELAY_URL
PADELAPI_TOKEN
PADELAPI_PAUSED                   # keep 'true'
YOUTUBE_API_KEY
ANTHROPIC_API_KEY
MISTRAL_API_KEY
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
FCM_SERVICE_ACCOUNT_JSON
FCM_PROJECT_ID
SENTRY_DSN
SENTRY_AUTH_TOKEN
SENTRY_ORG
SENTRY_PROJECT
NEXT_PUBLIC_SENTRY_DSN
NEXT_PUBLIC_POSTHOG_KEY
NEXT_PUBLIC_POSTHOG_HOST
PADELGOD_ADMIN_TOKEN
NEXT_PUBLIC_FIP_STREAMS_ENABLED
```

Also dump anything else that exists on Vercel and not in this list (feature flags, `PADELGOD_*`, ads, etc.). The rule is: **Railway Production must be a superset of Vercel Production**.

Same dump later for `padelnachos-admin` and `padel-labs` (Phase B).

### Devices for the store gate (cutover day)

- [ ] Android phone with the **Play Store** build of Padel Nachos installed (not a local debug APK).
- [ ] iPhone with the **App Store / TestFlight** build installed.
- [ ] A logged-in account on each (Google and, on iOS, Apple).
- [ ] Ability to tap a Universal Link: `https://padelnachos.com/match/<a-real-live-or-recent-id>` from Notes/WhatsApp — must open the **app**, not Safari.

### DNS snapshot (before touching NS)

Write down current records for:

- `padelnachos.com` (apex)
- `www.padelnachos.com`
- `admin.padelnachos.com`
- any `api.` / mail / Resend TXT/MX / Google site verification

We will recreate them on Cloudflare. Apex will become a Cloudflare proxied record; `admin` stays on Vercel until Phase B.

### Decide now (defaults if you say nothing)

| Decision | Default in this plan |
|---|---|
| First cutover | **main app only** (`padelnachos.com`) |
| Admin / Labs | Phase B, after soak |
| Railway project | `hearty-charm`, region `europe-west4-drams3a` |
| Cloudflare SSL | **Full (strict)** once Railway cert exists |
| New store release | **No** |

---

## Task 1: Extract `resolveRequestGeo` and cover it with tests

**Files:**
- Create: `src/lib/request-geo.ts`
- Create: `src/lib/__tests__/request-geo.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { resolveRequestGeo } from '../request-geo'

function headers(init: Record<string, string>) {
  return new Headers(init)
}

describe('resolveRequestGeo', () => {
  it('prefers CF-IPCountry over x-vercel-ip-country', () => {
    const geo = resolveRequestGeo(headers({
      'cf-ipcountry': 'ES',
      'x-vercel-ip-country': 'US',
    }))
    expect(geo.country).toBe('ES')
  })

  it('falls back to x-vercel-ip-country when CF is missing', () => {
    const geo = resolveRequestGeo(headers({ 'x-vercel-ip-country': 'BR' }))
    expect(geo.country).toBe('BR')
  })

  it('treats CF-IPCountry XX as unknown', () => {
    const geo = resolveRequestGeo(headers({ 'cf-ipcountry': 'XX' }))
    expect(geo.country).toBeNull()
  })

  it('prefers x-vercel-ip-timezone when present', () => {
    const geo = resolveRequestGeo(headers({
      'cf-ipcountry': 'US',
      'x-vercel-ip-timezone': 'America/Los_Angeles',
    }))
    expect(geo.timezone).toBe('America/Los_Angeles')
  })

  it('maps country → IANA tz when no timezone header exists', () => {
    const geo = resolveRequestGeo(headers({ 'cf-ipcountry': 'ES' }))
    expect(geo.timezone).toBe('Europe/Madrid')
  })

  it('returns nulls when no geo headers are present', () => {
    expect(resolveRequestGeo(headers({}))).toEqual({ country: null, timezone: null })
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL** (module missing)

```bash
npx vitest run src/lib/__tests__/request-geo.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lib/request-geo.ts
//
// Resolve visitor country + IANA timezone from request headers.
// Cloudflare is preferred (post-cutover). Vercel headers remain as
// fallback during the dual-origin window and for any leftover preview.

import { countryToTimezone } from './country-timezone'

export type RequestGeo = {
  country: string | null
  timezone: string | null
}

function read(headers: Headers, name: string): string {
  return (headers.get(name) ?? '').trim()
}

export function resolveRequestGeo(headers: Headers): RequestGeo {
  const cfCountry = read(headers, 'cf-ipcountry').toUpperCase()
  const vercelCountry = read(headers, 'x-vercel-ip-country').toUpperCase()
  const countryRaw = cfCountry && cfCountry !== 'XX' ? cfCountry : vercelCountry
  const country = countryRaw && countryRaw !== 'XX' ? countryRaw : null

  const vercelTz = read(headers, 'x-vercel-ip-timezone')
  const timezone = vercelTz || (country ? countryToTimezone(country) : null) || null

  return { country, timezone }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/lib/__tests__/request-geo.test.ts src/lib/__tests__/country-timezone.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/request-geo.ts src/lib/__tests__/request-geo.test.ts
git commit -m "feat(geo): resolve country/tz from Cloudflare or Vercel headers"
```

---

## Task 2: Wire geo into `proxy.ts` (safe on Vercel today)

**Files:**
- Modify: `src/proxy.ts` (geo cookie block ~197–217)
- Modify: `src/i18n/request.ts` (comment)
- Modify: `src/hooks/useUserCountry.ts` (comment)

- [ ] **Step 1: Replace the two header reads in `src/proxy.ts`**

At the top, add:

```ts
import { resolveRequestGeo } from './lib/request-geo'
```

Replace the geo-country / geo-timezone blocks with:

```ts
  const geo = resolveRequestGeo(request.headers)
  if (geo.country) {
    response.cookies.set('geo-country', geo.country, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 86400,
    })
  }
  if (geo.timezone) {
    response.cookies.set('geo-timezone', geo.timezone, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 86400,
    })
  }
```

- [ ] **Step 2: Update comments only** in `src/i18n/request.ts` and `src/hooks/useUserCountry.ts` so they no longer say “Vercel header only”.

- [ ] **Step 3: Manual check locally**

```bash
npm run dev
# curl -sI -H 'cf-ipcountry: ES' http://localhost:3002/home | grep -i set-cookie
```

Expected: `geo-country=ES` and `geo-timezone=Europe/Madrid` in `Set-Cookie`. Repeat with `x-vercel-ip-country: BR` and no CF header → `BR` / `America/Sao_Paulo`.

- [ ] **Step 4: Commit**

```bash
git add src/proxy.ts src/i18n/request.ts src/hooks/useUserCountry.ts
git commit -m "feat(geo): set geo cookies from CF-IPCountry with Vercel fallback"
```

Ship this to `main` **while still on Vercel**. Behavior is unchanged for Vercel headers; Cloudflare starts working the moment the zone is proxied.

---

## Task 3: Public URL + runtime env helpers (stop hard-wiring Vercel)

**Files:**
- Create: `src/lib/public-app-url.ts`
- Create: `src/lib/__tests__/public-app-url.test.ts`
- Create: `src/lib/runtime-env.ts`
- Modify: `instrumentation.ts`
- Modify: `src/lib/analytics-init.ts`
- Modify: `src/app/api/cron/scores/route.ts` (~709)
- Modify: `src/app/api/cron/sync/route.ts` (~707)
- Modify: `src/app/api/admin/dev-login/route.ts` (~91, ~120)
- Modify: `src/app/ops/page.tsx` (~23)
- Modify: `src/auth.ts` (pool `max`)

- [ ] **Step 1: Tests for `publicAppUrl`**

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { publicAppUrl } from '../public-app-url'

const KEYS = ['AUTH_URL', 'NEXT_PUBLIC_APP_URL', 'RAILWAY_PUBLIC_DOMAIN', 'VERCEL_URL']

afterEach(() => {
  for (const k of KEYS) delete process.env[k]
})

describe('publicAppUrl', () => {
  it('prefers AUTH_URL', () => {
    process.env.AUTH_URL = 'https://padelnachos.com'
    process.env.VERCEL_URL = 'padel-nacho.vercel.app'
    expect(publicAppUrl()).toBe('https://padelnachos.com')
  })

  it('uses https:// + RAILWAY_PUBLIC_DOMAIN', () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = 'padelnachos-web.up.railway.app'
    expect(publicAppUrl()).toBe('https://padelnachos-web.up.railway.app')
  })

  it('uses https:// + VERCEL_URL', () => {
    process.env.VERCEL_URL = 'padel-nacho.vercel.app'
    expect(publicAppUrl()).toBe('https://padel-nacho.vercel.app')
  })

  it('falls back to localhost in dev', () => {
    expect(publicAppUrl()).toBe('http://localhost:3002')
  })
})
```

- [ ] **Step 2: Implement helpers**

```ts
// src/lib/public-app-url.ts
export function publicAppUrl(): string {
  const auth = process.env.AUTH_URL?.replace(/\/$/, '')
  if (auth) return auth
  const app = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (app) return app
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3002'
}
```

```ts
// src/lib/runtime-env.ts
export function isProdRuntime(): boolean {
  return (
    process.env.VERCEL_ENV === 'production'
    || process.env.RAILWAY_ENVIRONMENT_NAME === 'production'
    || (process.env.NODE_ENV === 'production' && !!process.env.RAILWAY_ENVIRONMENT)
  )
}

export function isHostedRuntime(): boolean {
  return !!(process.env.VERCEL_ENV || process.env.RAILWAY_ENVIRONMENT)
}

export function runtimeEnvironment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT
    ?? process.env.VERCEL_ENV
    ?? process.env.RAILWAY_ENVIRONMENT_NAME
    ?? process.env.NODE_ENV
    ?? 'development'
  )
}

export function runtimeRelease(): string | undefined {
  return (
    process.env.SENTRY_RELEASE
    ?? process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.RAILWAY_GIT_COMMIT_SHA
    ?? undefined
  )
}
```

- [ ] **Step 3: Wire call sites**

`instrumentation.ts` `sentryEnabled()`: also return true when `isProdRuntime()` or `RAILWAY_ENVIRONMENT_NAME === 'production'`. Use `runtimeEnvironment()` / `runtimeRelease()` in `commonInit()`.

`src/lib/analytics-init.ts`: add `?? process.env.RAILWAY_ENVIRONMENT_NAME` and `?? process.env.RAILWAY_GIT_COMMIT_SHA` next to the Vercel fallbacks.

Cron `baseUrl` lines: `const baseUrl = publicAppUrl()`.

`dev-login`: `isHostedRuntime()` instead of `process.env.VERCEL_ENV` for cookie name + `secure`.

`src/app/ops/page.tsx`: `const host = process.env.RAILWAY_PUBLIC_DOMAIN ?? process.env.VERCEL_URL ?? \`localhost:${process.env.PORT ?? '3000'}\``.

`src/auth.ts` pool:

```ts
  max: Number(process.env.PG_POOL_MAX)
    || (process.env.RAILWAY_ENVIRONMENT ? 8 : 1),
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/public-app-url.test.ts src/lib/__tests__/request-geo.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/public-app-url.ts src/lib/__tests__/public-app-url.test.ts src/lib/runtime-env.ts \
  instrumentation.ts src/lib/analytics-init.ts \
  src/app/api/cron/scores/route.ts src/app/api/cron/sync/route.ts \
  src/app/api/admin/dev-login/route.ts src/app/ops/page.tsx src/auth.ts
git commit -m "feat(runtime): host-agnostic public URL, Sentry, and pg pool"
```

---

## Task 4: Well-known headers + healthcheck (Railway-safe)

**Files:**
- Modify: `next.config.ts` — add `headers()`
- Create: `src/app/api/health/route.ts`
- Create: `railway.toml`

Vercel already sets AASA/assetlinks Content-Type via `vercel.json`. `next start` on Railway will not read that file, so Next must emit the same headers.

- [ ] **Step 1: Add `headers()` to `next.config.ts`** (keep existing `rewrites`)

```ts
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
      {
        source: '/.well-known/assetlinks.json',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    ]
  },
```

- [ ] **Step 2: Health route**

```ts
// src/app/api/health/route.ts
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: `railway.toml` at repo root** (only used by the new web service; padelgod has its own under `padelgod/`)

```toml
[build]
builder = "RAILPACK"
buildCommand = "npm run build"

[deploy]
startCommand = "npx next start -p ${PORT:-3000}"
healthcheckPath = "/api/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

Railpack on a monorepo root will see the root `package.json` (the main app). Do **not** set `rootDirectory` to `/` on the relay service.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts src/app/api/health/route.ts railway.toml
git commit -m "feat(deploy): well-known headers, healthcheck, railway.toml for web"
```

---

## Task 5: Cron runner script (replaces `vercel.json` crons)

**Files:**
- Create: `scripts/railway-cron-runner.mjs`

One always-cheap Node process. It does **not** import Next. It HTTP-hits the web service the same way Vercel Cron does (`Authorization: Bearer $CRON_SECRET`).

- [ ] **Step 1: Write the runner** with the exact schedules from current `vercel.json`:

```js
// scripts/railway-cron-runner.mjs
// HTTP cron shim. Keep JOBS in sync with vercel.json until Vercel is retired.
import { CronJob } from 'cron'

const BASE = (process.env.CRON_BASE_URL || process.env.AUTH_URL || '').replace(/\/$/, '')
const SECRET = process.env.CRON_SECRET

if (!BASE) {
  console.error('[cron-runner] CRON_BASE_URL or AUTH_URL required')
  process.exit(1)
}
if (!SECRET) {
  console.error('[cron-runner] CRON_SECRET required')
  process.exit(1)
}

const JOBS = [
  { path: '/api/cron/process-factsheets', cron: '8 */2 * * *' },
  { path: '/api/cron/sync-highlights', cron: '20 */1 * * *' },
  { path: '/api/cron/youtube-channels-discover', cron: '*/5 * * * *' },
  { path: '/api/cron/sync-articles', cron: '40 */1 * * *' },
  { path: '/api/cron/enrich-articles', cron: '*/15 * * * *' },
  { path: '/api/cron/regenerate-dynamic-sources', cron: '0 5 * * 1' },
  { path: '/api/cron/sync-articles-dynamic', cron: '0 3 * * 3' },
  { path: '/api/cron/refresh-source-volume', cron: '0 4 * * *' },
  { path: '/api/cron/quality-scores', cron: '7 * * * *' },
  { path: '/api/cron/nacho-health', cron: '0 7 * * *' },
  { path: '/api/cron/sync-broadcasters', cron: '0 4 * * 0' },
  { path: '/api/cron/oop-monitor', cron: '30 */2 * * *' },
  { path: '/api/cron/editorial-gen', cron: '0 6 * * *' },
  { path: '/api/cron/anon-push-cleanup', cron: '0 4 * * 1' },
  { path: '/api/cron/resolve-predictions', cron: '*/5 * * * *' },
  { path: '/api/cron/recompute-earnings', cron: '0 6 * * 1' },
]

async function fire(path) {
  const url = `${BASE}${path}`
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${SECRET}` },
    })
    const ms = Date.now() - started
    console.log(JSON.stringify({ msg: 'cron', path, status: res.status, ms }))
  } catch (err) {
    console.error(JSON.stringify({ msg: 'cron-error', path, err: String(err) }))
  }
}

for (const job of JOBS) {
  CronJob.from({
    cronTime: job.cron,
    onTick: () => fire(job.path),
    start: true,
    timeZone: 'UTC',
  })
  console.log(JSON.stringify({ msg: 'scheduled', path: job.path, cron: job.cron }))
}

console.log(JSON.stringify({ msg: 'cron-runner-up', base: BASE, jobs: JOBS.length }))
```

Add `cron` to **root** `package.json` dependencies (the runner lives next to the web app in the same repo/build; the cron service can use the same image with a different start command).

- [ ] **Step 2: Install + smoke locally** (will 401/connect-fail if Next is down — that's fine if the process stays up)

```bash
npm install cron
node scripts/railway-cron-runner.mjs
# expect: cron-runner-up, 15 scheduled lines
# Ctrl-C
```

- [ ] **Step 3: Commit**

```bash
git add scripts/railway-cron-runner.mjs package.json package-lock.json
git commit -m "feat(deploy): Railway HTTP cron runner matching vercel.json"
```

---

## Task 6: Provision Railway web + cron (shadow, not live)

**Human + agent. No DNS change.**

Project: `hearty-charm` / env `production` / region `europe-west4-drams3a`.

- [ ] **Step 1: Create service `padelnachos-web`**

```bash
railway add --service padelnachos-web --json \
  --project ec638a56-c42f-4fa6-9216-dcd7668e34b7 \
  --environment dc1b58ce-dddc-4e2f-9faa-11296ef4385e
```

Then set source to repo `gudenes/padel-live-scores`, **root directory empty / repo root** (not `/relay`, not `/padelgod`). Watch patterns: ignore `apps/**`, `padelgod/**`, `relay/**`, `android/**`, `ios/**`.

```bash
railway environment edit --service padelnachos-web \
  --project ec638a56-c42f-4fa6-9216-dcd7668e34b7 \
  --environment dc1b58ce-dddc-4e2f-9faa-11296ef4385e \
  build.watchPatterns '["src/**","public/**","next.config.ts","package.json","package-lock.json","railway.toml","instrumentation.ts","instrumentation-client.ts"]'

railway environment edit --service padelnachos-web \
  --project ec638a56-c42f-4fa6-9216-dcd7668e34b7 \
  --environment dc1b58ce-dddc-4e2f-9faa-11296ef4385e \
  deploy.startCommand "npx next start -p \${PORT:-3000}"
```

Region: `europe-west4-drams3a`. Memory: start at 2 GB.

- [ ] **Step 2: Load env vars** from the Vercel dump. Required extras that Vercel set implicitly:

```
AUTH_URL=https://padelnachos.com
AUTH_TRUST_HOST=true
NEXTAUTH_URL=https://padelnachos.com
PG_POOL_MAX=8
PADELAPI_PAUSED=true
HOSTNAME=0.0.0.0
```

`AUTH_URL` stays the **public** domain even on the shadow hostname so OAuth cookies match production. Shadow login tests use a temporary `AUTH_URL=https://<railway-domain>` **only** on a separate check, or skip OAuth on shadow and test pages that do not need a session.

- [ ] **Step 3: Generate a Railway domain and deploy**

```bash
railway domain --service padelnachos-web \
  --project ec638a56-c42f-4fa6-9216-dcd7668e34b7 \
  --environment dc1b58ce-dddc-4e2f-9faa-11296ef4385e --json
# note the *.up.railway.app host; targetPort must be the Next listen port (Railway injects PORT)

# deploy from main after Tasks 1–5 are merged
```

Poll until latest deployment `status === SUCCESS`. Then:

```bash
curl -sS https://<railway-domain>/api/health
# {"ok":true}

curl -sSI https://<railway-domain>/.well-known/apple-app-site-association
# Content-Type: application/json
# body starts with {"applinks":

curl -sSI https://<railway-domain>/.well-known/assetlinks.json
# Content-Type: application/json
```

- [ ] **Step 4: Shadow smoke (browser on the Railway URL)**

- `/` and `/home` render
- a live or recent `/match/[id]` renders scores (data still comes from Supabase + padelgod)
- `/rankings` renders
- OG: `curl -sSI https://<railway-domain>/en/match/<id>/opengraph-image` is `image/`
- `/api/cron/quality-scores` with `Authorization: Bearer $CRON_SECRET` returns 200

- [ ] **Step 5: Create service `padelnachos-cron`**

Same repo, same build. Start command:

```
node scripts/railway-cron-runner.mjs
```

Vars: `CRON_SECRET`, `CRON_BASE_URL=https://<railway-domain>` for shadow. After cutover, change `CRON_BASE_URL` to `https://padelnachos.com` (or the private URL if you add one).

Do **not** start this against production `padelnachos.com` while Vercel crons still fire — you would double-run enrich/youtube. Keep `CRON_BASE_URL` on the Railway hostname until Vercel crons are paused.

- [ ] **Step 6: Write `docs/runbooks/replace-vercel-cutover.md`** with the exact curl checks above + rollback (“Cloudflare origin back to Vercel”).

- [ ] **Step 7: Commit the runbook** (service IDs can be filled in after provision)

```bash
git add docs/runbooks/replace-vercel-cutover.md
git commit -m "docs: Vercel → Railway cutover and rollback runbook"
```

---

## Task 7: Cloudflare in front of **Vercel** (still no origin change)

**Human-led. Agent assists with `proxy.ts` already shipped.**

- [ ] **Step 1:** Add zone `padelnachos.com` in Cloudflare. Copy existing DNS records (apex, www, admin, mail, Resend, verifications).

- [ ] **Step 2:** Point registrar nameservers to Cloudflare. Wait until the zone is **Active**.

- [ ] **Step 3:** Apex + `www` proxied (orange cloud) to the **current Vercel target** (`cname.vercel-dns.com` or the Vercel A record). `admin` can stay DNS-only to Vercel for now.

- [ ] **Step 4:** SSL/TLS = **Full (strict)** only after Cloudflare shows a valid origin cert. If Vercel is the origin, Full (strict) already works.

- [ ] **Step 5:** Cache rules:
  - Bypass cache for `/api/*`, `/auth/*`, `/ops/*`
  - Standard cache for `/_next/static/*` and `/public` assets
  - Do **not** cache `/.well-known/*` behind a long HTML cache (keep 1h, respect origin `Content-Type`)

- [ ] **Step 6:** Verify geo while origin is still Vercel:

```bash
curl -sI https://padelnachos.com/home | grep -i set-cookie
# geo-country and geo-timezone present
```

Browser: Where to Watch / match times still look right in ES and BR (VPN or two people).

- [ ] **Step 7:** Store check (no deploy): open the Play/App Store app once. It must still load. Universal Link still opens the app.

If anything breaks, turn the orange cloud **grey** (DNS only) — instant undo.

---

## Task 8: Cutover origin Vercel → Railway

**Gate:** Task 6 shadow green + Task 7 Cloudflare green.

- [ ] **Step 1:** In Railway, attach custom domain `padelnachos.com` (and `www`) to `padelnachos-web`. Note the CNAME/verification TXT Railway returns.

- [ ] **Step 2:** In Cloudflare, switch apex/`www` from Vercel to the Railway target. Keep **proxied**. Add the Railway ownership TXT.

- [ ] **Step 3:** Set `AUTH_URL=https://padelnachos.com` on `padelnachos-web` (already). Set `CRON_BASE_URL=https://padelnachos.com` on `padelnachos-cron` **only after** pausing Vercel crons (next step).

- [ ] **Step 4:** Pause Vercel crons the same hour: Vercel → Project → Settings → Crons → disable, **or** empty `crons` in `vercel.json` and deploy. Prefer dashboard disable first (no code) so rollback can re-enable without a commit.

- [ ] **Step 5:** Start / confirm `padelnachos-cron` is hitting production.

- [ ] **Step 6: Production smoke (web)**

- `https://padelnachos.com/api/health` → `{ok:true}`
- AASA + assetlinks Content-Type still `application/json`, **no 301/302**
- Login Google (web)
- Live match page updates (Supabase realtime — independent of host)
- One cron log line on `padelnachos-cron` with `status: 200`

- [ ] **Step 7: Production smoke (store) — hard gate**

On Play Store Android and App Store/TestFlight iOS:

1. Cold-open the app → home loads (splash then WebView).
2. Native Google sign-in (iOS also Apple) → session cookie sticks, profile shows.
3. Tap `https://padelnachos.com/match/<id>` from Notes → **app** opens, not the browser.
4. If a live match is on, a test push or a real live-notify still arrives.

If 3 fails: Cloudflare is rewriting AASA (wrong content-type or HTML challenge). Fix cache/WAF for `/.well-known/*` before anything else. Do not ship a new IPA.

- [ ] **Step 8: Soak 48–72h** with Vercel project still deployed but crons off. Rollback = Cloudflare origin back to Vercel + re-enable Vercel crons + stop `padelnachos-cron`.

---

## Task 9: Decommission Vercel (main project only)

**Only after soak. Admin/Labs stay on Vercel until Phase B.**

- [ ] **Step 1:** Remove `padelnachos.com` / `www` from the Vercel project domains (so Vercel stops serving/renewing certs for the apex).

- [ ] **Step 2:** Empty `crons` in `vercel.json` (keep `ignoreCommand` until the project is deleted). Commit:

```json
{
  "ignoreCommand": "git diff --quiet HEAD^ HEAD -- . ':(exclude)apps/labs'",
  "crons": [],
  "headers": []
}
```

Headers now live in `next.config.ts`.

- [ ] **Step 3:** Update `CLAUDE.md` “Deployment: Vercel…” and `MONOREPO.md` Vercel project map to Railway + Cloudflare. Point cron docs at `scripts/railway-cron-runner.mjs`.

- [ ] **Step 4:** Remove `@vercel/analytics` usage from `GatedAnalytics` **or** leave it as a no-op (it simply sends nothing off Vercel). Prefer leave-for-now to keep this PR small; track a follow-up.

- [ ] **Step 5:** Do **not** delete the Vercel project for another week. Then delete or hibernate.

```bash
git add vercel.json CLAUDE.md MONOREPO.md
git commit -m "chore: retire Vercel crons/headers for the main app"
```

---

## Task 10 (Phase B, not the first cutover): Admin + Labs

Same recipe, separate Railway services, after main soak.

| App | Railway service | Domain | Root |
|---|---|---|---|
| Admin | `padelnachos-admin` | `admin.padelnachos.com` | `apps/ops` |
| Labs | `padel-labs` | `padellabs.tech` / `analyst.padellabs.tech` | `apps/labs` |

Admin has 3 SEO crons (`apps/ops/vercel.json`) — either fold into the cron runner with `CRON_BASE_URL=https://admin.padelnachos.com` or a third tiny runner.

OAuth: add nothing if callbacks stay on the same hostnames.

---

## Rollback (keep this on a sticky note)

1. Cloudflare: apex/`www` target back to Vercel. Proxied stays on.
2. Vercel: re-enable crons.
3. Railway: stop `padelnachos-cron` (so jobs do not double).
4. Store apps: no action — they still load `padelnachos.com`.

---

## Self-review

**Spec coverage**

| Requirement | Task |
|---|---|
| Replace Vercel only | Tasks 6–9 |
| Keep padelgod / relay / OCR / Supabase | Out of scope, called out |
| Cloudflare for geo/CDN | Tasks 2, 7 |
| Capacitor / store, no new binary | Prep + Task 8.7 |
| AASA / assetlinks | Tasks 4, 6.3, 8.6 |
| Crons | Task 5 + 6.5 + 8.4 |
| Admin/Labs later | Task 10 |
| Do not reuse relay service | Prep + Task 6 |
| User prep | section “What Gustavo needs to prepare” |

**Placeholders:** none.

**Type consistency:** `resolveRequestGeo` → `{ country, timezone }`; `publicAppUrl()` string; `countryToTimezone` already exists.
