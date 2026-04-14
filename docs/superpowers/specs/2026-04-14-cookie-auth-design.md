# Cookie-Based Auth Migration — Design Spec

**Date:** 2026-04-14
**Status:** Draft
**Approach:** Approach A — `@supabase/ssr` cookie middleware

## Problem

Supabase's browser-side auth stores JWTs in localStorage and manages refresh via an internal JS ticker. When a tab is backgrounded or a device sleeps, the JS runtime suspends — timers stop, the ticker stalls, and internal auth state can become inconsistent ("wedged"). We've built ~400 lines of recovery code (soft recovery, click probes, wake refresh, custom locks) to compensate, but edge cases remain, especially on iOS/Safari.

The competitor (Padelscore) uses server-side httpOnly cookies via NextAuth — no JS-managed tokens, no wedge risk. Cookies survive idle natively.

## Solution

Install `@supabase/ssr` and migrate to cookie-based session management. The proxy (`proxy.ts`) refreshes the session on every request. Browser and server clients read from the same cookie store. The existing recovery code is kept but disabled behind a feature flag.

## Architecture

### Cookie Flow

```
1. User logs in → Supabase sets session cookies (via @supabase/ssr)
2. Every request → proxy.ts reads cookies → refreshes token if expired → writes updated cookies
3. Browser client → reads session from cookies (not localStorage)
4. Server components → read session from cookies (user-scoped queries possible)
5. Tab wakes after idle → next request sends cookies automatically → proxy refreshes → done
```

### Three Client Types

| Client | Created by | Where used | Cookie access |
|---|---|---|---|
| **Proxy client** | `createServerClient` in `proxy.ts` | Proxy only | Read + Write (request + response) |
| **Server client** | `createServerClient` in `lib/supabase-server.ts` | Server Components, API routes needing user context | Read only (via `cookies()`) |
| **Browser client** | `createBrowserClient` in `lib/supabase.ts` | Client components | Read via `document.cookie` (automatic) |
| **Service client** | `createClient` in `lib/supabase.ts` (unchanged) | Cron jobs, admin APIs | None (uses service key, bypasses RLS) |

### Feature Flag

```
NEXT_PUBLIC_USE_COOKIE_AUTH=true
```

- `true` (default after migration): cookie-based auth, recovery code disabled
- `false` (rollback): localStorage auth, recovery code active

## File Changes

### 1. `package.json` — Add dependency

```
npm install @supabase/ssr
```

### 2. `src/proxy.ts` — Add session refresh

Insert Supabase cookie refresh **before** the next-intl middleware call. This ensures every request gets a fresh token.

```typescript
import { createServerClient } from '@supabase/ssr'

// Inside proxy():
let response = NextResponse.next({ request: { headers: request.headers } })

const supabase = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  }
)

// Triggers token refresh if access token is expired
const { data: { user } } = await supabase.auth.getUser()
```

**Composition order in proxy.ts:**
1. Auth param rescue (existing)
2. Legacy redirects (existing)
3. Ops dashboard auth (existing, unified — see below)
4. **Supabase cookie refresh (new)**
5. next-intl locale routing (existing)
6. Post-i18n cookie decoration (existing)

**Important:** The `setAll` callback must set cookies on both the request (so downstream server components see fresh tokens) and the response (so the browser receives `Set-Cookie` headers).

### 3. `src/lib/supabase.ts` — Cookie-aware browser client

Replace the current `createClient` with `createBrowserClient` from `@supabase/ssr`:

```typescript
import { createBrowserClient } from '@supabase/ssr'

const cookieAuthEnabled = process.env.NEXT_PUBLIC_USE_COOKIE_AUTH !== 'false'

export const supabase = cookieAuthEnabled
  ? createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { isSingleton: true }
    )
  : createClient(/* existing localStorage config */)
```

The browser client from `@supabase/ssr` automatically uses `document.cookie` for storage. No custom lock needed — the proxy handles refresh, not the browser.

**Keep the existing `createClient` code** as the fallback path behind the feature flag.

**Keep the service-key `createServiceClient`** unchanged — cron jobs and admin APIs don't use cookies.

### 4. `src/lib/supabase-server.ts` — New file: server client factory

```typescript
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
            // setAll fails in Server Components (read-only context)
            // This is expected — the proxy handles refresh
          }
        },
      },
    }
  )
}
```

Used in server components and API routes that need user context. The `try/catch` on `setAll` is the documented pattern — Server Components can't set cookies, but Route Handlers can.

### 5. `src/components/AuthProvider.tsx` — Simplify

When `cookieAuthEnabled`:
- **Remove:** `readCachedSession()` localStorage reads, 3s safety timeout, custom keepalive
- **Keep:** `onAuthStateChange` listener (still needed for `retryKey` bumps, data migrations, profile loading)
- **Change:** Session initialization calls `supabase.auth.getUser()` instead of localStorage cache
- **Keep:** Profile lazy-loading, login streak, referral claiming, bookmark migration

The optimistic render from localStorage is no longer needed — the proxy already validated the session before the page renders.

### 6. `src/lib/supabase-health.ts` — Disable behind flag

```typescript
const cookieAuthEnabled = process.env.NEXT_PUBLIC_USE_COOKIE_AUTH !== 'false'

export function reportBatchFailures(...) {
  if (cookieAuthEnabled) return // Cookie auth handles recovery via proxy
  // ... existing code unchanged
}

export function startClickRecovery(...) {
  if (cookieAuthEnabled) return () => {}
  // ... existing code unchanged
}

export function startSessionKeepalive(...) {
  if (cookieAuthEnabled) return () => {}
  // ... existing code unchanged
}
```

### 7. `src/hooks/useWakeRefresh.ts` — Disable behind flag

```typescript
export function useWakeRefresh(refetch: () => void, options?) {
  const cookieAuthEnabled = process.env.NEXT_PUBLIC_USE_COOKIE_AUTH !== 'false'
  
  useEffect(() => {
    if (cookieAuthEnabled) return // Proxy handles session refresh on next request
    // ... existing visibilitychange code unchanged
  }, [...])
}
```

Note: The `refetch` callback for fresh data on wake is still useful even with cookie auth — but it no longer needs the auth recovery dance (startAutoRefresh, 1.5s delay, refreshSessionIfNeeded). Simplify to just call `refetch()` on visibility change.

### 8. Ops Dashboard — Unified auth

Current: Each `/api/ops/*` route reads the `ops_token` cookie individually and compares to `CRON_SECRET`.

New: The proxy handles ops auth in one place:
1. Proxy checks if path starts with `/ops` or `/api/ops`
2. Reads `ops_token` cookie, compares to `CRON_SECRET`
3. If valid, sets `x-ops-authenticated: true` request header
4. API routes check the header instead of reading cookies directly

This removes auth boilerplate from every ops API route.

### 9. API Routes — Selective migration

| Route type | Client | Change needed |
|---|---|---|
| `/api/cron/*` | Service client (no user) | None |
| `/api/admin/*` | Service client (no user) | None |
| `/api/ops/*` | Service client + ops_token | Remove per-route cookie check, use header from proxy |
| `/api/feed/*` | Service client (no user) | None |
| `/api/match-stats` | Service client | None |
| `/api/match-rating` | Needs user context | Switch to `createServerSupabase()` |
| `/api/auth/callback` | N/A | Keep existing callback flow |

Most API routes use the service-key client and don't need changes. Only routes that need the current user's identity benefit from the cookie-aware server client.

## Cookie Configuration

`@supabase/ssr` defaults:
- **Name prefix:** `sb-<project-ref>-auth-token`
- **Path:** `/`
- **SameSite:** `Lax`
- **Max-Age:** ~13 months (400 days)
- **Chunking:** Automatic for tokens > 3,180 bytes (split into `.0`, `.1`, etc.)

No custom cookie options needed — the defaults match our requirements.

## Performance Note

The proxy calls `supabase.auth.getUser()` on every matched request. This makes a network round-trip to Supabase Auth (~50-100ms). This is acceptable because:
1. The proxy matcher already excludes `_next/static`, `_next/image`, and file extensions — only page navigations and API calls hit it
2. The token refresh only happens when the access token is actually expired (typically every hour)
3. `getUser()` is the recommended approach over `getSession()` because it validates the token server-side, catching revoked sessions

If latency becomes a concern, we could switch to `getSession()` (local JWT decode, no network call) for most requests and only use `getUser()` on sensitive routes. But start with `getUser()` for correctness.

## Security Considerations

- Cookies are **not httpOnly** by default in `@supabase/ssr` (the browser client needs to read them via `document.cookie`). This is the same security posture as localStorage — tokens are accessible to JS.
- The proxy validates the token server-side on every request via `getUser()` (not just `getSession()`), which makes an API call to Supabase Auth. This catches revoked sessions that localStorage-only auth misses.
- `SameSite: Lax` prevents CSRF on state-changing requests from cross-origin contexts.

## Migration Safety

1. **Feature flag** gates the entire change — flip `NEXT_PUBLIC_USE_COOKIE_AUTH=false` to rollback
2. **Recovery code** kept intact but gated — no code deletion in this phase
3. **localStorage** not cleaned up — old tokens stay but are ignored when cookie auth is active
4. **Dual-read period:** During rollout, if cookie session is missing (e.g., first visit after deploy), the browser client falls back to localStorage session gracefully. `@supabase/ssr`'s `createBrowserClient` handles this internally.
5. **Auth callback** (`/auth/callback`) continues to work — Supabase auth flows set cookies on the redirect response

## Follow-up Work (Not in this spec)

1. **Remove recovery code** — once cookie auth is stable for 1-2 weeks, delete supabase-health.ts recovery paths and useWakeRefresh auth logic
2. **localStorage cleanup** — add one-time migration to clear old `sb-*-auth-token` from localStorage
3. **Server component data fetching** — with cookie-aware server clients, some pages (rankings, player profiles) could move data fetching to server components for better TTFB
4. **RLS policies** — cookie-aware server client enables per-user RLS in server components (currently bypassed via service key)

## Testing Plan

1. **Login flows:** Google OAuth, magic link — verify cookies are set after redirect
2. **Idle recovery:** Background tab for 30+ minutes, return — verify session is still valid without recovery code firing
3. **iOS Safari:** Background app, switch back — verify no wedge
4. **Multi-tab:** Login in one tab, verify other tabs pick up session
5. **Logout:** Verify cookies are cleared across tabs
6. **Ops dashboard:** Login via `?token=`, verify cookie + header flow
7. **Feature flag rollback:** Set `NEXT_PUBLIC_USE_COOKIE_AUTH=false`, verify localStorage path works
8. **Cron jobs:** Verify service-key routes are unaffected
