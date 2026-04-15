# Auth.js Migration — Replace Supabase Auth for Performance Parity

**Date:** 2026-04-15
**Status:** Draft
**Goal:** Logged-in users must have identical perceived performance to anonymous users.

## Problem

Authenticated users experience degraded performance due to the Supabase Auth client-side stack:

- **8-12 network calls on page init** (getSession, fetchProfile, updateLoginStreak, checkBadgeInline x2, refreshSessionIfNeeded, keepalive tick)
- **5 recovery mechanisms** running exclusively for logged-in users (keepalive, click recovery, batch failure detection, wake refresh, safety timeouts)
- **1.5s mandatory delay on tab wake** for network radio stabilization
- **Proxy polarity bug** (`proxy.ts` line 14) runs `supabase.auth.getUser()` on every page load even though cookie auth is disabled
- **~1,100 lines of auth complexity** that only exists to work around GoTrue client lock/wedge issues

Anonymous users skip all of this — their page loads are instant.

## Solution

Replace Supabase Auth with Auth.js (NextAuth v5). Auth becomes a cookie read (~0ms), not a network ceremony. Public data stays client-side via anon key. User-specific data moves to Next.js API routes via service key.

## Architecture

### Before

```
Browser -> proxy.ts (getUser() per request) -> Page
  |-> Supabase client (anon key + user JWT)
      |-> Public data (matches, tournaments, etc.)
      |-> User data (bookmarks, badges, ratings)
         |-> RLS via auth.uid()
         |-> 5 recovery mechanisms, locks, keepalive, probes
```

### After

```
Browser -> proxy.ts (no auth call, cookie already present) -> Page
  |-> Supabase client (anon key only, NO auth)
  |   |-> Public data (matches, tournaments, players, articles, highlights)
  |-> Next.js API routes (session cookie -> service key)
      |-> User data (bookmarks, badges, ratings, profile, streak)
```

### Performance comparison

| Metric | Before (logged-in) | After (logged-in) | After (anonymous) |
|--------|--------------------|--------------------|-------------------|
| Auth network calls on init | 8-12 | 0 | 0 |
| Tab wake overhead | 1.7-5.5s | 0ms | 0ms |
| Background timers | 3 (keepalive, click, batch) | 0 | 0 |
| Proxy auth overhead | 50-300ms (getUser) | ~0ms (cookie read) | ~0ms |

## Auth.js Setup

### Configuration (`src/auth.ts`)

- **Providers:** Google OAuth (reuse existing client ID/secret) + Email magic link (via Resend)
- **Session strategy:** `database` — sessions stored in Supabase via Auth.js Supabase adapter
- **Database tables:** `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verification_tokens` (Auth.js standard schema)
- **Session callback:** Injects Auth.js user ID into the session object for API route access

### Auth API Route (`src/app/api/auth/[...nextauth]/route.ts`)

Standard Auth.js catch-all route — handles login, callback, signout, session endpoints.

### Proxy Composition (`src/proxy.ts`)

- Auth.js exposes an `auth()` wrapper, but it cannot be used directly because the proxy must compose with next-intl middleware
- Proxy reads the session cookie via `getToken()` from Auth.js (lightweight, no DB hit)
- Existing i18n routing, geo-cookies, and ops auth remain unchanged
- The Supabase cookie refresh block (lines 104-146) is deleted entirely

### LoginSheet Changes

- `supabase.auth.signInWithOAuth({ provider: 'google' })` -> `signIn('google')` from next-auth/react
- `supabase.auth.signInWithOtp({ email })` -> `signIn('email', { email })` from next-auth/react
- Same UI, same bottom sheet, same UX

## User Data API Routes

All user-specific queries move from direct client-side Supabase calls (with RLS) to Next.js API routes (with service key).

### Route inventory

| Route | Methods | Purpose | Replaces |
|-------|---------|---------|----------|
| `/api/user/profile` | GET, PATCH | Fetch/update profile | Direct `supabase.from('profiles')` calls |
| `/api/user/bookmarks` | GET, POST, DELETE | List/add/remove bookmarks | `useFollowing` hook direct queries |
| `/api/user/badges` | GET | List earned badges + check new unlocks | `useBadges` hook + `checkBadgeInline` |
| `/api/user/ratings` | GET, POST | Match ratings | `useMatchRating` hook direct queries |
| `/api/user/streak` | POST | Update login streak (once on session start) | `updateLoginStreak` in AuthProvider |
| `/api/user/activity` | POST | Log user activity | `logActivity` direct calls |

### Auth pattern (all routes)

```ts
import { auth } from '@/auth'
import { createServiceClient } from '@/lib/supabase'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data } = await supabase
    .from('...')
    .select('...')
    .eq('user_id', session.user.id)
  return Response.json(data)
}
```

### Client-side hook changes

- `useFollowing` — switches from direct Supabase queries to `fetch('/api/user/bookmarks')`
- `useBadges` — switches to `fetch('/api/user/badges')`
- `useMatchRating` — switches to `fetch('/api/user/ratings')`
- All become simpler: no `withTimeout`, no auth token management, just standard `fetch`

### Badge checking

- `checkBadgeInline` currently runs 4-6 DB queries from the browser on every AuthProvider init
- Moves server-side into `/api/user/badges` — called lazily when badge UI is visible
- Login streak + badge check combined into single `/api/user/streak` POST

## AuthProvider Rewrite

### Before (453 lines)

Reads localStorage cache, calls getSession() with safety timeouts, runs fetchProfile + updateLoginStreak + checkBadgeInline x2, starts keepalive + click recovery, listens to onAuthStateChange, migrates bookmarks/ratings, claims referrals.

### After (~50 lines)

```tsx
'use client'
import { SessionProvider, useSession } from 'next-auth/react'

export function AuthProvider({ children, session }) {
  return <SessionProvider session={session}>{children}</SessionProvider>
}

export function useAuth() {
  const { data: session, status } = useSession()
  return {
    user: session?.user ?? null,
    loading: status === 'loading',
    session,
  }
}
```

### Concern migration table

| Concern | Before | After |
|---------|--------|-------|
| Session state | 5 recovery layers + localStorage | Auth.js SessionProvider (cookie, instant) |
| Profile data | Fetched on AuthProvider init | Lazy fetch by components that need it |
| Login streak | Every auth event (read + write + badge checks) | Single `/api/user/streak` POST, deferred via requestIdleCallback |
| Badge checks | 4-6 queries on init | Lazy fetch when achievements page or badge UI visible |
| Bookmark migration | Runs on SIGNED_IN | One-time manual migration (3 users) |
| Rating migration | Runs on SIGNED_IN | One-time manual migration (3 users) |
| Referral claim | Runs on SIGNED_IN | Auth.js signIn callback (server-side) |
| retryKey (wedge recovery) | Bumped on TOKEN_REFRESHED | Removed — no wedges possible |
| useWakeRefresh | 1.5s delay + probe + refresh | Removed — cookie session never wedges |

## Supabase Client Simplification

### Before (`src/lib/supabase.ts`, 150 lines)

Custom serializing lock, cookie auth feature flag, build-time placeholder guards, browser client with auth options, window debug exposure.

### After (~30 lines)

```ts
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

// Browser client — anon key only, no auth, no locks, no recovery
export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

// Server client — service key, for API routes
export function createServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? ''
  if (!url || !serviceKey) throw new Error('Missing SUPABASE_SERVICE_KEY')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
```

## RLS Policy Changes

Tables with `auth.uid()` policies: `profiles`, `user_bookmarks`, `user_badges`, `match_ratings`, `feature_interest`, `user_activity_log`.

Since all user queries now go through API routes with the service key (bypasses RLS), drop the RLS policies. The API routes enforce auth via `auth()` session check. RLS on tables only accessed via service key is dead code.

Migration will disable RLS on these tables and drop the associated policies.

## Database Changes

### New tables (Auth.js standard schema)

- `auth_users` — Auth.js user records (id, name, email, image, emailVerified)
- `auth_sessions` — active sessions (sessionToken, userId, expires)
- `auth_accounts` — OAuth provider links (userId, provider, providerAccountId, tokens)
- `auth_verification_tokens` — magic link tokens (identifier, token, expires)

### Modified tables

- `profiles` — `id` column re-mapped from Supabase `auth.users(id)` to Auth.js `auth_users(id)` for 3 existing users

### FK updates (3 users)

All tables with `user_id` FKs updated for the 3 existing users:
- `user_bookmarks`
- `user_badges`
- `match_ratings`
- `user_activity_log`
- `feature_interest`
- `push_subscriptions`
- `social_posts` (if user-linked)

## Email Provider

- **Service:** Resend (free tier: 100 emails/day, 3,000/month)
- **Purpose:** Magic link sign-in emails
- **Integration:** Auth.js Email provider with Resend API
- **New env var:** `RESEND_API_KEY`

## Dependencies

### Added

- `next-auth@5` — Auth.js for Next.js
- `@auth/pg-adapter` (or `@auth/drizzle-adapter`) — stores Auth.js data in Supabase's Postgres via direct connection string
- `resend` — magic link emails

### New env vars

- `AUTH_SECRET` — Auth.js encryption key for session cookies
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth (may reuse existing values from Supabase Google provider config)
- `RESEND_API_KEY` — Resend API key for magic link emails
- `DATABASE_URL` — Supabase Postgres direct connection string (for Auth.js adapter)

### Removed

- `@supabase/ssr` — cookie auth client (no longer needed)

## Files Deleted (~823 lines)

| File | Lines | Reason |
|------|-------|--------|
| `src/lib/supabase-health.ts` | 360 | All recovery machinery eliminated |
| `src/hooks/useWakeRefresh.ts` | 125 | Cookie session never wedges |
| `src/lib/with-timeout.ts` | — | KEPT — still used by 6 page files for public data query timeouts |
| `src/app/auth/callback/page.tsx` | 172 | Auth.js handles callbacks natively |
| `src/lib/badge-check-inline.ts` | 73 | Moves server-side into API route |
| `src/lib/badge-eval.ts` | 93 | Moves server-side into API route |

## Files Heavily Rewritten

| File | Before | After | Change |
|------|--------|-------|--------|
| `src/components/AuthProvider.tsx` | 453 lines | ~50 lines | -403 lines |
| `src/lib/supabase.ts` | 150 lines | ~30 lines | -120 lines |
| `src/proxy.ts` | 195 lines | ~150 lines | -45 lines, remove Supabase cookie block |
| `src/components/LoginSheet.tsx` | 268 lines | ~250 lines | Swap signIn calls |
| `src/hooks/useFollowing.ts` | ~200 lines | ~100 lines | Switch to fetch-based |
| `src/hooks/useBadges.ts` | ~300 lines | ~80 lines | Switch to fetch-based |
| `src/hooks/useMatchRating.ts` | ~150 lines | ~80 lines | Switch to fetch-based |

## New Files

| File | Purpose |
|------|---------|
| `src/auth.ts` | Auth.js configuration (providers, adapter, callbacks) |
| `src/app/api/auth/[...nextauth]/route.ts` | Auth.js API route handler |
| `src/app/api/user/profile/route.ts` | Profile GET/PATCH |
| `src/app/api/user/bookmarks/route.ts` | Bookmarks GET/POST/DELETE |
| `src/app/api/user/badges/route.ts` | Badges GET (with server-side unlock check) |
| `src/app/api/user/ratings/route.ts` | Ratings GET/POST |
| `src/app/api/user/streak/route.ts` | Login streak POST |
| `src/app/api/user/activity/route.ts` | Activity log POST |
| `supabase/migrations/2026XXXX_authjs_tables.sql` | Auth.js schema + RLS changes |

## Migration Plan (3 users)

1. Deploy Auth.js stack — old Supabase auth sessions stop working, users signed out
2. Users sign in again with Google — Auth.js creates their account
3. Run one-time migration script: map old Supabase user IDs to new Auth.js IDs across all user tables
4. Verify bookmarks, badges, ratings preserved
5. Drop old Supabase RLS policies
6. Delete old auth code

## Rollback

If Auth.js has issues post-deploy:
- The old Supabase Auth code exists in git history
- Supabase auth.users table still exists (not deleted)
- Revert the deploy, users sign in via Supabase again
- With 3 users, coordination is trivial

## Success Criteria

- Logged-in page load: 0 auth-related network calls (same as anonymous)
- Tab wake: no delay, no probes (same as anonymous)
- No background auth timers or recovery mechanisms
- All user data (bookmarks, badges, ratings, streak) preserved after migration
- Google + magic link login working via Auth.js
