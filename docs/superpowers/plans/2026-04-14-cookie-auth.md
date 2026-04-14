# Cookie-Based Auth Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from localStorage JWT auth to `@supabase/ssr` cookie-based auth to eliminate idle/wedge issues.

**Architecture:** Install `@supabase/ssr`. The proxy refreshes the session cookie on every request. Browser and server clients read from the same cookie store. Existing recovery code disabled behind `NEXT_PUBLIC_USE_COOKIE_AUTH` feature flag but kept for rollback.

**Tech Stack:** `@supabase/ssr`, Next.js 16 proxy, Supabase v2

**Spec:** `docs/superpowers/specs/2026-04-14-cookie-auth-design.md`

---

### Task 1: Install `@supabase/ssr` and add feature flag

**Files:**
- Modify: `package.json`
- Modify: `.env.local` (add feature flag)

- [ ] **Step 1: Install the package**

```bash
npm install @supabase/ssr
```

- [ ] **Step 2: Add feature flag to `.env.local`**

Add to `.env.local`:
```
NEXT_PUBLIC_USE_COOKIE_AUTH=true
```

- [ ] **Step 3: Verify installation**

```bash
node -e "require('@supabase/ssr'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @supabase/ssr for cookie-based auth"
```

---

### Task 2: Create shared ops auth helper

Before touching the proxy, extract the duplicated ops auth check from ~20 API routes into a single reusable function. This is prerequisite work — the proxy will later set a header that this helper reads.

**Files:**
- Create: `src/lib/ops-auth.ts`

- [ ] **Step 1: Create the shared helper**

Create `src/lib/ops-auth.ts`:

```typescript
// src/lib/ops-auth.ts
// Shared ops dashboard auth check.
// Phase 1: reads ops_token cookie directly (existing behavior, centralized).
// Phase 2 (Task 6): will read x-ops-authenticated header set by proxy.

import { cookies, headers } from 'next/headers'

/**
 * Check if the current request is authenticated for ops dashboard access.
 * Returns null if authenticated, or a Response to return if not.
 */
export async function checkOpsAuth(): Promise<Response | null> {
  // Phase 2: check header from proxy first
  const hdrs = await headers()
  if (hdrs.get('x-ops-authenticated') === 'true') return null

  // Phase 1 fallback: read cookie directly
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('[Ops Auth] CRON_SECRET env var is not set')
    return Response.json(
      { error: 'Unauthorized', reason: 'server_misconfigured' },
      { status: 401 }
    )
  }

  if (token !== cronSecret) {
    console.error('[Ops Auth] Token mismatch', {
      hasToken: !!token,
      tokenLength: token?.length,
    })
    return Response.json(
      { error: 'Unauthorized', reason: 'token_mismatch' },
      { status: 401 }
    )
  }

  return null
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ops-auth.ts
git commit -m "refactor: extract shared ops auth helper"
```

---

### Task 3: Cookie-aware browser client

Replace the browser Supabase client with `createBrowserClient` from `@supabase/ssr`, gated behind the feature flag. Keep the existing localStorage client as fallback.

**Files:**
- Modify: `src/lib/supabase.ts`

- [ ] **Step 1: Add cookie client alongside existing client**

Edit `src/lib/supabase.ts`. Replace the current file contents with:

```typescript
// src/lib/supabase.ts
// Supabase client helpers — browser (anon) and server (service role)

import { createClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const cookieAuthEnabled =
  process.env.NEXT_PUBLIC_USE_COOKIE_AUTH !== 'false'

// Canonical site URL — uses env var in production, falls back to window.location.origin for local dev
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '')

// ── Custom auth lock (legacy path — used when cookie auth is disabled) ──
//
// History: Supabase's default `navigator.locks`-based lock was timing out
// at 5s on slow DB responses. This in-memory serializing lock has NO timeout
// on the actual operation — only on lock acquisition.
const lockChains = new Map<string, Promise<unknown>>()

async function serializingLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>
): Promise<R> {
  const previous = lockChains.get(name) ?? Promise.resolve()
  const waitForPrevious = Promise.race([
    previous.catch(() => undefined),
    new Promise<void>((resolve) =>
      setTimeout(resolve, acquireTimeout || 5000)
    ),
  ])
  const tail: Promise<R> = waitForPrevious.then(() => fn())
  lockChains.set(
    name,
    tail.catch(() => undefined)
  )
  return tail
}

// ── Browser client ──────────────────────────────────────────────
// Cookie auth: uses @supabase/ssr createBrowserClient (reads/writes document.cookie)
// Legacy path: uses createClient with localStorage + custom lock
export const supabase = cookieAuthEnabled
  ? createBrowserClient(supabaseUrl, supabaseAnonKey, {
      isSingleton: true,
    })
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        detectSessionInUrl: true,
        flowType: 'pkce',
        autoRefreshToken: false,
        persistSession: true,
        lock: serializingLock,
      },
    })

// Expose for console debugging
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__pn_supabase = supabase
}

// Server client — uses service key, bypasses RLS.
// Used by cron jobs and admin APIs. Unchanged by cookie auth migration.
export function createServiceClient() {
  return createClient(supabaseUrl, process.env.SUPABASE_SERVICE_KEY!)
}

// Legacy alias — kept for existing call sites that import createServerClient
export { createServiceClient as createServerClient }
```

- [ ] **Step 2: Verify the build compiles**

```bash
npx next build 2>&1 | head -30
```

If there are import errors from existing code that uses `createServerClient`, the legacy alias handles it.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat(auth): add cookie-aware browser client behind feature flag"
```

---

### Task 4: Cookie-aware server client factory

Create a new server client that reads cookies. Used by server components and API routes that need user context.

**Files:**
- Create: `src/lib/supabase-server-cookie.ts`

- [ ] **Step 1: Create the server cookie client factory**

Create `src/lib/supabase-server-cookie.ts`:

```typescript
// src/lib/supabase-server-cookie.ts
// Cookie-aware Supabase server client for Server Components and API routes.
// Reads the session from cookies (set/refreshed by proxy.ts).
// Uses the anon key (not service key) so RLS policies apply.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabase() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll throws in Server Components (read-only context).
            // This is expected and documented — the proxy handles refresh.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/supabase-server-cookie.ts
git commit -m "feat(auth): add cookie-aware server client factory"
```

---

### Task 5: Proxy session refresh

Add Supabase cookie refresh to `proxy.ts`. This is the core of the migration — every request gets a fresh token via cookies.

**Files:**
- Modify: `src/proxy.ts`

- [ ] **Step 1: Add Supabase cookie refresh to proxy**

Edit `src/proxy.ts`. Replace the entire file with:

```typescript
// src/proxy.ts
// Next.js 16 proxy (formerly middleware.ts)
// Composes: auth param rescue → legacy redirects → ops auth →
// Supabase cookie refresh → next-intl locale routing → geo cookies

import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const handleI18nRouting = createMiddleware(routing)

const cookieAuthEnabled =
  process.env.NEXT_PUBLIC_USE_COOKIE_AUTH !== 'false'

export default async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  // ── Pre-i18n: short-circuit routes ─────────────────────────────

  // 1. Auth param rescue — if Supabase redirects to wrong page with auth params, forward to callback
  const code = searchParams.get('code')
  const hasAuthCode = code && code.length >= 20 && !/^[0-9]{1,10}$/.test(code)
  const hasTokenHash = searchParams.has('token_hash')
  if ((hasAuthCode || hasTokenHash) && pathname !== '/auth/callback') {
    const callbackUrl = new URL('/auth/callback', request.url)
    callbackUrl.search = request.nextUrl.search
    return NextResponse.redirect(callbackUrl)
  }

  // 2. Legacy /v3/* redirects
  if (pathname === '/v3' || pathname === '/v3/') {
    return NextResponse.redirect(new URL('/home', request.url), 308)
  }
  if (pathname.startsWith('/v3/scores')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/scores', '/matches'), request.url), 308)
  }
  if (pathname.startsWith('/v3/ranking')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/ranking', '/rankings'), request.url), 308)
  }
  if (pathname.startsWith('/v3/feed')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/feed', '/feed'), request.url), 308)
  }
  if (pathname.startsWith('/v3/following')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/following', '/following'), request.url), 308)
  }
  if (pathname.startsWith('/v3/profile')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/profile', '/profile'), request.url), 308)
  }
  if (pathname.startsWith('/v3/tournaments')) {
    return NextResponse.redirect(new URL(pathname.replace('/v3/tournaments', '/tournaments'), request.url), 308)
  }

  // 3. Ops dashboard auth
  if (pathname.startsWith('/ops') || pathname.startsWith('/api/ops')) {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return new NextResponse('Server misconfigured', { status: 500 })
    }

    // Check for token in query param (first visit / bookmark)
    const tokenParam = searchParams.get('token')
    if (tokenParam === cronSecret) {
      const cleanUrl = new URL(pathname, request.url)
      const response = NextResponse.redirect(cleanUrl)
      response.cookies.set('ops_token', cronSecret, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
        path: '/',
      })
      return response
    }

    // Check cookie
    const cookieToken = request.cookies.get('ops_token')?.value
    if (cookieToken !== cronSecret) {
      // For /ops pages, show 401. For /api/ops, return JSON error.
      if (pathname.startsWith('/api/ops')) {
        return Response.json(
          { error: 'Unauthorized', reason: 'token_mismatch' },
          { status: 401 }
        )
      }
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Ops authenticated — set header for API routes to read
    request.headers.set('x-ops-authenticated', 'true')

    // For /api/ops routes, pass through with the header (skip i18n)
    if (pathname.startsWith('/api/ops')) {
      return NextResponse.next({
        request: { headers: request.headers },
      })
    }

    // For /ops pages, continue to i18n routing (falls through below)
    // but we already validated — the header is set on the request
  }

  // 4. Auth routes — outside [locale], skip i18n routing
  if (pathname.startsWith('/auth')) {
    return NextResponse.next()
  }

  // 5. Admin routes — auth checked client-side and in API routes
  if (pathname.startsWith('/admin')) {
    return NextResponse.next()
  }

  // ── 6. Supabase cookie session refresh ─────────────────────────
  // Creates a server client that reads/writes session cookies.
  // Calling getUser() triggers token refresh if the access token expired.
  // This runs BEFORE i18n routing so the response carries fresh cookies.

  let supabaseResponse = NextResponse.next({
    request: { headers: request.headers },
  })

  if (cookieAuthEnabled) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (cookiesToSet) => {
            // Set on request so downstream server components see fresh tokens
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            )
            // Recreate response with updated request
            supabaseResponse = NextResponse.next({ request })
            // Set on response so browser receives Set-Cookie headers
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    // getUser() validates the JWT server-side with Supabase Auth.
    // If the access token expired, this triggers a refresh and setAll
    // writes the new tokens to cookies.
    // We intentionally ignore the result — we just want the side effect
    // of refreshing cookies. The app reads the user from the client.
    await supabase.auth.getUser()
  }

  // ── Run next-intl locale routing ───────────────────────────────
  const response = handleI18nRouting(request)

  // ── Post-i18n: merge Supabase cookies + decorate with geo cookies ──

  // Copy any Supabase auth cookies from supabaseResponse to i18n response
  if (cookieAuthEnabled) {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value, cookie)
    })
  }

  // Geo-country cookie
  const country = request.headers.get('x-vercel-ip-country') ?? ''
  if (country) {
    response.cookies.set('geo-country', country, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 86400,
    })
  }

  // Geo-timezone cookie
  const timezone = request.headers.get('x-vercel-ip-timezone') ?? ''
  if (timezone) {
    response.cookies.set('geo-timezone', timezone, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 86400,
    })
  }

  // Invite ref code capture
  const ref = searchParams.get('ref')
  if (ref && /^[A-Z0-9]{6}$/.test(ref)) {
    response.cookies.set('pn_invite_ref', ref, {
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
      sameSite: 'lax',
    })
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (static files)
     * - Files with extensions (e.g. .png, .ico, .webp — static assets)
     * - api routes (handled separately) — EXCEPT /api/ops which needs ops auth
     * - _vercel (Vercel internals)
     */
    '/((?!api(?!/ops)|_next|_vercel|.*\\..*).*)',
  ],
}
```

**Note on matcher change:** The matcher now includes `/api/ops` routes so the proxy can validate ops auth centrally. Other `/api/*` routes are still excluded.

- [ ] **Step 2: Verify the build compiles**

```bash
npx next build 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add src/proxy.ts
git commit -m "feat(auth): add Supabase cookie refresh to proxy"
```

---

### Task 6: Simplify AuthProvider for cookie auth

Simplify AuthProvider when cookie auth is enabled — remove localStorage cache reads, safety timeout, and keepalive. Keep `onAuthStateChange` for retryKey, profile loading, and migrations.

**Files:**
- Modify: `src/components/AuthProvider.tsx`

- [ ] **Step 1: Add cookie auth path to AuthProvider**

Edit `src/components/AuthProvider.tsx`. Replace the entire file with:

```typescript
'use client'
// src/components/AuthProvider.tsx
// Provides auth state (user, profile, session, loading, signOut) to the app via React context.
// Cookie auth mode: session comes from cookies (refreshed by proxy), no localStorage dance.
// Legacy mode: reads session from localStorage cache, uses keepalive + click recovery.

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { supabase, cookieAuthEnabled } from '@/lib/supabase'
import { startSessionKeepalive, startClickRecovery, refreshSessionIfNeeded } from '@/lib/supabase-health'
import { checkBadgeInline } from '@/lib/badge-check-inline'
import type { User, Session } from '@supabase/supabase-js'

interface Profile {
  id: string
  display_name: string | null
  avatar_url: string | null
  preferred_country: string | null
}

interface AuthContextType {
  user: User | null
  profile: Profile | null
  session: Session | null
  loading: boolean
  retryKey: number
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  session: null,
  loading: true,
  retryKey: 0,
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

const BOOKMARKS_STORAGE_KEY = 'pn_bookmarked_matches'
const FOLLOWING_STORAGE_KEY = 'pn_following'

interface FollowingData {
  matches?: string[]
  players?: string[]
  tournaments?: string[]
  news_sources?: string[]
}

async function migrateLocalBookmarks(userId: string) {
  try {
    const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY)
    if (raw) {
      const ids: string[] = JSON.parse(raw)
      if (ids.length) {
        const rows = ids.map(id => ({
          user_id: userId,
          bookmark_type: 'match' as const,
          target_id: id,
        }))
        const { error } = await supabase
          .from('user_bookmarks')
          .upsert(rows, { onConflict: 'user_id,bookmark_type,target_id' })
        if (!error) {
          localStorage.removeItem(BOOKMARKS_STORAGE_KEY)
          console.log(`[Auth] Migrated ${ids.length} legacy bookmarks to Supabase`)
        } else {
          console.warn('[Auth] Legacy bookmark migration error:', error)
        }
      }
    }
  } catch (e) {
    console.warn('[Auth] Legacy bookmark migration failed:', e)
  }

  try {
    const raw = localStorage.getItem(FOLLOWING_STORAGE_KEY)
    if (!raw) return
    const following: FollowingData = JSON.parse(raw)

    const rows: { user_id: string; bookmark_type: string; target_id: string }[] = []
    for (const id of following.matches ?? []) {
      rows.push({ user_id: userId, bookmark_type: 'match', target_id: id })
    }
    for (const id of following.players ?? []) {
      rows.push({ user_id: userId, bookmark_type: 'player', target_id: id })
    }
    for (const id of following.tournaments ?? []) {
      rows.push({ user_id: userId, bookmark_type: 'tournament', target_id: id })
    }

    if (rows.length) {
      const { error } = await supabase
        .from('user_bookmarks')
        .upsert(rows, { onConflict: 'user_id,bookmark_type,target_id' })
      if (error) {
        console.warn('[Auth] Following migration error:', error)
        return
      }
      console.log(`[Auth] Migrated ${rows.length} follows to Supabase`)
    }

    const kept: FollowingData = { news_sources: following.news_sources ?? [] }
    localStorage.setItem(FOLLOWING_STORAGE_KEY, JSON.stringify(kept))
  } catch (e) {
    console.warn('[Auth] Following migration failed:', e)
  }
}

async function migrateLocalRatings(accessToken: string) {
  try {
    const { readAllRatings, RATINGS_KEY, DEVICE_ID_KEY } = await import('@/hooks/useMatchRating')
    const ratings = readAllRatings()
    const entries = Object.entries(ratings)
    if (!entries.length) return

    const deviceId = localStorage.getItem(DEVICE_ID_KEY)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    }

    const results = await Promise.allSettled(
      entries.map(([matchId, rating]) =>
        fetch('/api/match-rating', {
          method: 'POST',
          headers,
          body: JSON.stringify({ matchId, rating, deviceId }),
        })
      )
    )

    const allOk = results.every(r => r.status === 'fulfilled' && (r.value as Response).ok)
    if (allOk) {
      localStorage.removeItem(RATINGS_KEY)
      console.log(`[Auth] Migrated ${entries.length} ratings to Supabase`)
    }
  } catch (e) {
    console.error('[Auth] Rating migration failed:', e)
  }
}

async function claimReferral(userId: string) {
  if (typeof document === 'undefined') return
  const match = document.cookie.match(/(?:^|;\s*)pn_invite_ref=([A-Z0-9]{6})/)
  if (!match) return
  const code = match[1]

  try {
    const { data: inviter } = await supabase
      .from('profiles')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle()

    if (!inviter) return
    if (inviter.id === userId) {
      document.cookie = 'pn_invite_ref=; Path=/; Max-Age=0; SameSite=lax'
      return
    }

    const { error } = await supabase
      .from('profiles')
      .update({ referred_by: inviter.id })
      .eq('id', userId)
      .is('referred_by', null)

    if (!error) {
      document.cookie = 'pn_invite_ref=; Path=/; Max-Age=0; SameSite=lax'
      console.log('[Auth] Claimed referral from', code)
      try {
        const pending = localStorage.getItem('pn_pending_referral')
        if (pending) {
          const { inviterName, inviterAvatar } = JSON.parse(pending)
          localStorage.setItem('pn_show_referral_toast', JSON.stringify({ inviterName, inviterAvatar }))
          localStorage.removeItem('pn_pending_referral')
        }
      } catch { /* ignore */ }
    }
  } catch (e) {
    console.warn('[Auth] claimReferral failed:', e)
  }
}

async function updateLoginStreak(userId: string) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('last_active_at, login_streak, longest_streak')
      .eq('id', userId)
      .single()

    if (!profile) return

    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const lastActive = profile.last_active_at
      ? new Date(profile.last_active_at).toISOString().slice(0, 10)
      : null

    if (lastActive === today) return

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)

    const newStreak = lastActive === yesterdayStr
      ? (profile.login_streak ?? 0) + 1
      : 1

    const newLongest = Math.max(newStreak, profile.longest_streak ?? 0)

    await supabase
      .from('profiles')
      .update({
        last_active_at: now.toISOString(),
        login_streak: newStreak,
        longest_streak: newLongest,
      })
      .eq('id', userId)

    void checkBadgeInline(userId, 'login_streak')
    void checkBadgeInline(userId, 'longest_streak')
  } catch (e) {
    console.warn('[Auth] updateLoginStreak failed:', (e as Error)?.message)
  }
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, preferred_country')
      .eq('id', userId)
      .single()
    if (error) return null
    return data
  } catch {
    return null
  }
}

// ── Legacy: Optimistic session reader (disabled when cookie auth is on) ──
function readCachedSession(): { user: User; session: Session } | null {
  if (cookieAuthEnabled) return null // Cookie auth — proxy handles session
  if (typeof window === 'undefined') return null
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const ref = supabaseUrl.match(/\/\/(.*?)\.supabase/)?.[1]
    if (!ref) return null
    const raw = localStorage.getItem(`sb-${ref}-auth-token`)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data?.user?.id || !data?.access_token) return null
    const expiry = data.expires_at ? data.expires_at * 1000 : 0
    if (expiry > 0 && Date.now() > expiry) {
      console.log('[Auth] cached session expired, skipping optimistic render')
      return null
    }
    return { user: data.user as User, session: data as Session }
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const cached = readCachedSession()
  const [user, setUser] = useState<User | null>(cached?.user ?? null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [session, setSession] = useState<Session | null>(cached?.session ?? null)
  const [loading, setLoading] = useState(!cached)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    // If we have a cached user (legacy path), start profile fetch immediately
    if (cached?.user) {
      fetchProfile(cached.user.id).then(p => { if (!cancelled) setProfile(p) }).catch(() => {})
      void updateLoginStreak(cached.user.id)
    }

    // ── Session initialization ──
    if (cookieAuthEnabled) {
      // Cookie auth: getUser() reads from cookies (already refreshed by proxy).
      // No safety timeout needed — proxy already validated the session.
      supabase.auth.getUser().then(({ data: { user: u } }) => {
        if (cancelled) return
        setUser(u)
        setLoading(false)
        if (u) {
          fetchProfile(u.id).then(p => { if (!cancelled) setProfile(p) }).catch(() => {})
          void updateLoginStreak(u.id)
        }
      }).catch(() => {
        if (!cancelled) setLoading(false)
      })

      // Also get the full session for context consumers that need it
      supabase.auth.getSession().then(({ data: { session: s } }) => {
        if (cancelled) return
        setSession(s)
      }).catch(() => {})
    } else {
      // Legacy path: safety timeout + getSession + deferred refresh
      const safetyTimeout = setTimeout(() => {
        if (!cancelled) {
          console.warn('[Auth] getSession() timed out after 3s — unblocking UI')
          setLoading(false)
        }
      }, 3000)

      supabase.auth.getSession().then(({ data: { session: s } }) => {
        if (cancelled) return
        clearTimeout(safetyTimeout)
        setSession(s)
        setUser(s?.user ?? null)
        setLoading(false)
        if (s?.user) {
          if (!cached?.user || s.user.id !== cached.user.id) {
            fetchProfile(s.user.id).then(p => { if (!cancelled) setProfile(p) }).catch(() => {})
            void updateLoginStreak(s.user.id)
          }
          if (s) {
            setTimeout(() => { void refreshSessionIfNeeded('mount') }, 2000)
          }
        }
      }).catch(err => {
        console.error('[Auth] getSession() failed:', err)
        if (!cancelled) {
          clearTimeout(safetyTimeout)
          setLoading(false)
          setTimeout(() => { void refreshSessionIfNeeded('retry-after-failure') }, 3000)
        }
      })
    }

    // Auth state change listener — same for both paths
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        const ts = new Date().toISOString()
        console.log(`[Auth] ${ts} event=${event} hasSession=${!!s} userId=${s?.user?.id?.slice(0, 8) ?? '-'}`)
        if (cancelled) return
        setSession(s)
        setUser(s?.user ?? null)
        setLoading(false)

        if (event === 'TOKEN_REFRESHED') {
          setRetryKey(k => k + 1)
        }

        if (s?.user) {
          const p = await fetchProfile(s.user.id)
          if (cancelled) return
          setProfile(p)
          void updateLoginStreak(s.user.id)

          if (event === 'SIGNED_IN') {
            await migrateLocalBookmarks(s.user.id)
            void claimReferral(s.user.id)
            if (s.access_token) {
              await migrateLocalRatings(s.access_token)
            }
          }
        } else {
          setProfile(null)
        }
      }
    )

    // Legacy-only: keepalive + click recovery
    const stopKeepalive = cookieAuthEnabled ? () => {} : startSessionKeepalive()
    const stopClickRecovery = cookieAuthEnabled ? () => {} : startClickRecovery()

    return () => {
      cancelled = true
      subscription.unsubscribe()
      stopKeepalive()
      stopClickRecovery()
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setSession(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, retryKey, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npx next build 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add src/components/AuthProvider.tsx
git commit -m "feat(auth): simplify AuthProvider for cookie auth mode"
```

---

### Task 7: Simplify useWakeRefresh for cookie auth

When cookie auth is enabled, the wake refresh no longer needs auth recovery — just the data refetch on visibility change.

**Files:**
- Modify: `src/hooks/useWakeRefresh.ts`

- [ ] **Step 1: Add cookie auth path**

Replace `src/hooks/useWakeRefresh.ts` with:

```typescript
'use client'
// src/hooks/useWakeRefresh.ts
// Detects when the tab returns from idle and runs a refetch callback.
// Cookie auth mode: just refetch data (no auth recovery needed — proxy handles it).
// Legacy mode: restart auth ticker, wait for radio, refresh session, then refetch.

import { useEffect, useRef } from 'react'
import { supabase, cookieAuthEnabled } from '@/lib/supabase'
import { refreshSessionIfNeeded } from '@/lib/supabase-health'

interface UseWakeRefreshOptions {
  idleThresholdMs?: number
  refreshSession?: boolean
}

export function useWakeRefresh(
  refetch: () => void | Promise<void>,
  opts: UseWakeRefreshOptions = {}
) {
  const idleThresholdMs = opts.idleThresholdMs ?? 30_000
  const refreshSession = opts.refreshSession ?? true

  const refetchRef = useRef(refetch)
  useEffect(() => { refetchRef.current = refetch }, [refetch])

  useEffect(() => {
    if (typeof document === 'undefined') return

    let hiddenSince: number | null = null

    async function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now()
        return
      }
      if (hiddenSince == null) return
      const hiddenForMs = Date.now() - hiddenSince
      hiddenSince = null
      if (hiddenForMs < idleThresholdMs) return

      console.log(`[useWakeRefresh] tab visible after ${Math.round(hiddenForMs / 1000)}s — refreshing`)

      if (cookieAuthEnabled) {
        // Cookie auth: no auth recovery needed. The next fetch will send
        // cookies, and the proxy will refresh the token if expired.
        // Just refetch data.
        try {
          await refetchRef.current()
        } catch (e) {
          console.warn('[useWakeRefresh] refetch failed:', e)
        }
      } else {
        // Legacy path: full auth recovery dance
        try { await supabase.auth.startAutoRefresh() } catch { /* safe to ignore */ }
        await new Promise(resolve => setTimeout(resolve, 1500))
        if (refreshSession) {
          await refreshSessionIfNeeded('wake')
        }
        try {
          await refetchRef.current()
        } catch (e) {
          console.warn('[useWakeRefresh] refetch failed:', e)
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [idleThresholdMs, refreshSession])
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useWakeRefresh.ts
git commit -m "feat(auth): simplify useWakeRefresh for cookie auth mode"
```

---

### Task 8: Gate recovery code in supabase-health.ts

Disable the recovery functions when cookie auth is enabled. Keep the code for rollback.

**Files:**
- Modify: `src/lib/supabase-health.ts`

- [ ] **Step 1: Add early returns behind feature flag**

Edit `src/lib/supabase-health.ts`. Add the import and early returns:

At the top of the file, after existing imports, add:

```typescript
import { cookieAuthEnabled } from '@/lib/supabase'
```

Then add early returns to the three public functions:

In `reportBatchFailures`, add as the first line of the function body:
```typescript
  if (cookieAuthEnabled) return // Cookie auth — proxy handles recovery
```

In `startClickRecovery`, add as the first line after the `typeof window` check:
```typescript
  if (cookieAuthEnabled) return () => {} // Cookie auth — proxy handles recovery
```

In `startSessionKeepalive`, add as the first line after the `typeof window` check:
```typescript
  if (cookieAuthEnabled) return () => {} // Cookie auth — proxy handles recovery
```

In `refreshSessionIfNeeded`, add as the first line:
```typescript
  if (cookieAuthEnabled) return Promise.resolve(false) // Cookie auth — proxy handles refresh
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/supabase-health.ts
git commit -m "feat(auth): gate recovery code behind cookie auth flag"
```

---

### Task 9: Migrate ops API routes to shared helper

Replace the duplicated `checkOpsAuth()` in each ops API route with the shared import from `src/lib/ops-auth.ts`.

**Files:**
- Modify: All files under `src/app/api/ops/` that contain `checkOpsAuth` or `ops_token`

The routes to update (20 files):
- `src/app/api/ops/brands/route.ts`
- `src/app/api/ops/rackets/route.ts`
- `src/app/api/ops/players/route.ts`
- `src/app/api/ops/players/merge/route.ts`
- `src/app/api/ops/search-players/route.ts`
- `src/app/api/ops/player-equipment/route.ts`
- `src/app/api/ops/tournament-draws/route.ts`
- `src/app/api/ops/seed-entry-list/route.ts`
- `src/app/api/ops/seed-draw/route.ts`
- `src/app/api/ops/parse-entry-list/route.ts`
- `src/app/api/ops/parse-draw/route.ts`
- `src/app/api/ops/duplicate-scan/route.ts`
- `src/app/api/ops/extract-racket/route.ts`
- `src/app/api/ops/schedule-review/route.ts`
- `src/app/api/ops/schedule-review/changes/route.ts`
- `src/app/api/ops/launch-monitor/route.ts`
- `src/app/api/ops/simulator/tournaments/route.ts`
- `src/app/api/ops/simulator/create-tournament/route.ts`
- `src/app/api/ops/simulator/score/route.ts`
- `src/app/api/ops/simulator/purge/route.ts`

- [ ] **Step 1: Replace per-route auth with shared import**

For each file, make these changes:

1. **Remove** the local `checkOpsAuth` function definition (typically 10-15 lines)
2. **Remove** the `import { cookies } from 'next/headers'` line (if only used for auth)
3. **Add** `import { checkOpsAuth } from '@/lib/ops-auth'` at the top

The call sites (`const authError = await checkOpsAuth(); if (authError) return authError;`) stay the same — the shared function has the same signature.

- [ ] **Step 2: Verify build**

```bash
npx next build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ops/
git commit -m "refactor: use shared ops auth helper in all API routes"
```

---

### Task 10: Smoke test and verification

Test the full auth flow end-to-end.

**Files:** None (testing only)

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test login flow**

1. Open `http://localhost:3002/home` in browser
2. Open DevTools → Application → Cookies
3. Sign in via magic link or Google
4. Verify cookies are present: `sb-<ref>-auth-token` (or chunked `.0`, `.1`)
5. Verify the auth callback redirects to `/home`
6. Verify user appears in the UI

- [ ] **Step 3: Test idle recovery**

1. Note the current time
2. Background the tab for 2+ minutes
3. Return to the tab
4. Verify: no loading spinner, data refreshes, console shows `[useWakeRefresh]` log
5. Verify: no `[supabase-health]` recovery messages (recovery code is disabled)

- [ ] **Step 4: Test ops dashboard**

1. Navigate to `http://localhost:3002/ops?token=<CRON_SECRET>`
2. Verify cookie `ops_token` is set
3. Verify ops dashboard loads
4. Verify API calls (e.g. player search) return 200

- [ ] **Step 5: Test feature flag rollback**

1. Set `NEXT_PUBLIC_USE_COOKIE_AUTH=false` in `.env.local`
2. Restart dev server
3. Verify: localStorage auth path is used (check for `sb-<ref>-auth-token` in localStorage)
4. Verify: keepalive and click recovery are active in console logs

- [ ] **Step 6: Commit any fixes, then final commit**

```bash
git add -A
git commit -m "feat(auth): complete cookie-based auth migration"
```
