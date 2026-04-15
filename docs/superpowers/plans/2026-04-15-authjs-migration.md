# Auth.js Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Auth with Auth.js (NextAuth v5) so logged-in users have identical performance to anonymous users.

**Architecture:** Auth.js handles session via encrypted database-backed cookie. Public data stays client-side (Supabase anon key). User-specific data moves to Next.js API routes (Supabase service key). All client-side auth recovery machinery is deleted.

**Tech Stack:** next-auth@5, @auth/pg-adapter, resend, Supabase Postgres

**Spec:** `docs/superpowers/specs/2026-04-15-authjs-migration-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/auth.ts` | Auth.js config: providers, adapter, callbacks, session shape |
| `src/app/api/auth/[...nextauth]/route.ts` | Auth.js catch-all route handler |
| `src/app/api/user/profile/route.ts` | Profile GET/PATCH |
| `src/app/api/user/bookmarks/route.ts` | Bookmarks GET/POST/DELETE |
| `src/app/api/user/badges/route.ts` | Badges GET (with server-side unlock check) |
| `src/app/api/user/ratings/route.ts` | Ratings GET/POST |
| `src/app/api/user/streak/route.ts` | Login streak POST |
| `src/app/api/user/activity/route.ts` | Activity log POST |
| `src/app/api/user/push-subscriptions/route.ts` | Push subscription POST/DELETE |
| `supabase/migrations/20260415_authjs_tables.sql` | Auth.js schema + RLS teardown |

### Deleted files
| File | Reason |
|------|--------|
| `src/lib/supabase-health.ts` | Recovery machinery eliminated |
| `src/hooks/useWakeRefresh.ts` | Cookie session never wedges |
| `src/app/auth/callback/page.tsx` | Auth.js handles callbacks |
| `src/lib/badge-check-inline.ts` | Moves server-side into `/api/user/badges` |
| `src/lib/badge-eval.ts` | Moves server-side into `/api/user/badges` |
| `src/lib/supabase-server-cookie.ts` | No longer needed without Supabase cookie auth |

### Rewritten files
| File | Change |
|------|--------|
| `src/lib/supabase.ts` | Strip auth config, locks, cookie flag (150→~30 lines) |
| `src/components/AuthProvider.tsx` | Thin SessionProvider wrapper (453→~60 lines) |
| `src/proxy.ts` | Remove Supabase cookie block, fix polarity bug |
| `src/components/LoginSheet.tsx` | Swap `supabase.auth.*` → `signIn()` from next-auth |
| `src/hooks/useFollowing.ts` | Switch to `fetch('/api/user/bookmarks')` |
| `src/hooks/useBadges.ts` | Switch to `fetch('/api/user/badges')` |
| `src/hooks/useMatchRating.ts` | Remove `supabase.auth.getSession()`, use session from useAuth |
| `src/hooks/useInvite.ts` | Remove `checkBadgeInline` import, badge check moves server-side |
| `src/hooks/usePushNotifications.ts` | Replace direct Supabase writes with fetch to API |
| `src/hooks/usePushNotifications.ts` | Replace direct Supabase writes with fetch to API |
| `src/lib/activity-log.ts` | Switch to `fetch('/api/user/activity')` |
| `src/app/api/match-rating/route.ts` | Replace Supabase auth token validation with `auth()` |
| `src/app/api/racket-click/route.ts` | Replace `supabase.auth.getSession()` with `auth()` |
| `src/app/layout.tsx` | Pass session to AuthProvider |
| `src/components/BadgeToast.tsx` | Remove BADGE_UNLOCK_EVENT import from deleted file |

### Page files — remove useWakeRefresh + reportBatchFailures
| File | Remove |
|------|--------|
| `src/app/[locale]/(app)/home/page.tsx` | `useWakeRefresh`, `reportBatchFailures` |
| `src/app/[locale]/(app)/matches/page.tsx` | `useWakeRefresh`, `reportBatchFailures` |
| `src/app/[locale]/(app)/profile/page.tsx` | `useWakeRefresh` |
| `src/app/[locale]/(app)/feed/page.tsx` | `useWakeRefresh`, `checkBadgeInline` |

---

## Task 1: Install dependencies + database migration

**Files:**
- Modify: `package.json`
- Create: `supabase/migrations/20260415_authjs_tables.sql`

- [ ] **Step 1: Install Auth.js + adapter + Resend**

```bash
npm install next-auth@beta @auth/pg-adapter resend
```

Note: Auth.js v5 is published under the `beta` tag on npm. The `@auth/pg-adapter` uses raw Postgres via `pg` or `@neondatabase/serverless`. Since Supabase exposes a direct Postgres connection string, we use `pg`:

```bash
npm install pg @types/pg
```

- [ ] **Step 2: Create the database migration**

Create `supabase/migrations/20260415_authjs_tables.sql`:

```sql
-- Auth.js required tables (standard @auth/pg-adapter schema)
-- See: https://authjs.dev/getting-started/adapters/pg
-- Table names MUST match exactly what the adapter expects: users, accounts, sessions, verification_token.
-- These live in the "public" schema — no conflict with Supabase's auth.users (in "auth" schema).
-- We use UUID PKs instead of SERIAL to match Supabase conventions and our profiles table.

CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  UNIQUE(provider, "providerAccountId")
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "sessionToken" TEXT NOT NULL UNIQUE,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires TIMESTAMPTZ NOT NULL,
  UNIQUE(identifier, token)
);

-- Indexes for session lookups
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions("sessionToken");
CREATE INDEX IF NOT EXISTS idx_sessions_userid ON sessions("userId");
CREATE INDEX IF NOT EXISTS idx_accounts_userid ON accounts("userId");

-- Drop RLS on user-data tables (all access now goes through service key via API routes)
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_bookmarks DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges DISABLE ROW LEVEL SECURITY;
ALTER TABLE match_ratings DISABLE ROW LEVEL SECURITY;
ALTER TABLE feature_interest DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_log DISABLE ROW LEVEL SECURITY;

-- Drop old RLS policies (they reference auth.uid() which won't exist for Auth.js users)
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can read own bookmarks" ON user_bookmarks;
DROP POLICY IF EXISTS "Users can insert own bookmarks" ON user_bookmarks;
DROP POLICY IF EXISTS "Users can delete own bookmarks" ON user_bookmarks;
DROP POLICY IF EXISTS "Users can read own badges" ON user_badges;
DROP POLICY IF EXISTS "Users can insert own badges" ON user_badges;
DROP POLICY IF EXISTS "Users can read own ratings" ON match_ratings;
DROP POLICY IF EXISTS "Users can insert own ratings" ON match_ratings;
DROP POLICY IF EXISTS "Users can update own ratings" ON match_ratings;
DROP POLICY IF EXISTS "Users can read own feature interests" ON feature_interest;
DROP POLICY IF EXISTS "Users can insert own feature interests" ON feature_interest;
DROP POLICY IF EXISTS "Users can delete own feature interests" ON feature_interest;
DROP POLICY IF EXISTS "Users can read own activity log" ON user_activity_log;
DROP POLICY IF EXISTS "Users can insert own activity log" ON user_activity_log;

-- Update profiles FK: remove the foreign key to auth.users if it exists,
-- so profiles.id can reference users instead.
-- (The actual ID remapping happens in the migration script after users re-sign-in.)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
```

- [ ] **Step 3: Apply the migration via Supabase dashboard**

Run the SQL in Supabase SQL Editor (Dashboard → SQL Editor → paste → Run). Verify tables exist:

```sql
SELECT table_name FROM information_schema.tables WHERE table_name IN ('users', 'accounts', 'sessions', 'verification_token');
```

Expected: 4 rows (users, authjs_accounts, authjs_sessions, authjs_verification_tokens).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json supabase/migrations/20260415_authjs_tables.sql
git commit -m "feat(auth): add Auth.js dependencies + database migration"
```

---

## Task 2: Auth.js configuration + API route

**Files:**
- Create: `src/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Create Auth.js configuration**

Create `src/auth.ts`:

```ts
// src/auth.ts
// Auth.js (NextAuth v5) configuration.
// Providers: Google OAuth + Email magic link (via Resend).
// Session: database-backed via Supabase Postgres.

import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import Resend from 'next-auth/providers/resend'
import PostgresAdapter from '@auth/pg-adapter'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY!,
      from: process.env.AUTH_EMAIL_FROM ?? 'PadelNachos <noreply@padelnachos.com>',
    }),
  ],
  session: {
    strategy: 'database',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    // Keep using our custom login sheet — don't redirect to Auth.js default pages
    signIn: '/home',
    error: '/home',
  },
  callbacks: {
    async session({ session, user }) {
      // Inject the database user ID into the session so API routes can use it
      if (session.user) {
        session.user.id = user.id
      }
      return session
    },
  },
  // Auth.js uses AUTH_SECRET env var automatically for cookie encryption
})
```

- [ ] **Step 2: Create the Auth.js API route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
// src/app/api/auth/[...nextauth]/route.ts
// Auth.js catch-all API route — handles login, callback, signout, session.

import { handlers } from '@/auth'

export const { GET, POST } = handlers
```

- [ ] **Step 3: Verify the build compiles**

```bash
npx next build 2>&1 | head -30
```

Expected: no import errors. (Auth flow won't work yet — we haven't set env vars or wired up the UI.)

- [ ] **Step 4: Commit**

```bash
git add src/auth.ts src/app/api/auth/\[...nextauth\]/route.ts
git commit -m "feat(auth): add Auth.js config with Google + Resend providers"
```

---

## Task 3: Simplify Supabase client

**Files:**
- Rewrite: `src/lib/supabase.ts`

- [ ] **Step 1: Rewrite supabase.ts — strip all auth complexity**

Replace the entire contents of `src/lib/supabase.ts` with:

```ts
// src/lib/supabase.ts
// Supabase client helpers — browser (anon, no auth) and server (service role).
// Auth is handled by Auth.js, not Supabase. The browser client is used only
// for public data queries (matches, tournaments, players, articles, highlights).

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

// Browser client — anon key only, no auth, no locks, no recovery.
// Used for public data that doesn't require user identity.
// Guard: during Next.js build, env vars may not be available in worker
// processes — use placeholder values to prevent the module from crashing.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
)

// Server client — uses service key, bypasses RLS.
// Only use in API routes and server components.
export function createServiceClient() {
  const url = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? ''
  if (!url || !serviceKey) {
    throw new Error(
      'createServiceClient requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY'
    )
  }
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

// Legacy alias — keep existing server-side call sites working
export { createServiceClient as createServerClient }
```

- [ ] **Step 2: Verify build compiles**

```bash
npx next build 2>&1 | tail -5
```

This will fail with import errors from files that import deleted exports (`cookieAuthEnabled`, `siteUrl`). That's expected — we fix those in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "refactor(auth): simplify Supabase client — strip auth config, locks, recovery"
```

---

## Task 4: Rewrite AuthProvider

**Files:**
- Rewrite: `src/components/AuthProvider.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Rewrite AuthProvider as thin Auth.js wrapper**

Replace the entire contents of `src/components/AuthProvider.tsx` with:

```tsx
'use client'
// src/components/AuthProvider.tsx
// Thin wrapper around Auth.js SessionProvider.
// Provides useAuth() hook for components that need user identity.

import { SessionProvider, useSession } from 'next-auth/react'
import { createContext, useContext, useCallback, type ReactNode } from 'react'

interface Profile {
  id: string
  display_name: string | null
  avatar_url: string | null
  preferred_country: string | null
}

interface AuthContextType {
  user: { id: string; name?: string | null; email?: string | null; image?: string | null } | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

function AuthInner({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()

  const user = session?.user
    ? {
        id: session.user.id!,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }
    : null

  const signOut = useCallback(async () => {
    const { signOut: doSignOut } = await import('next-auth/react')
    await doSignOut({ redirect: false })
  }, [])

  return (
    <AuthContext.Provider value={{ user, profile: null, loading: status === 'loading', signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AuthInner>{children}</AuthInner>
    </SessionProvider>
  )
}
```

Note: `profile` is set to `null` for now — profile data will be fetched lazily by components that need it (Task 7). The `useAuth()` hook interface stays the same (`user`, `profile`, `loading`, `signOut`) so existing consumers keep working.

- [ ] **Step 2: Simplify layout.tsx — remove session prop complexity**

In `src/app/layout.tsx`, the `<AuthProvider>` usage stays the same (no props needed):

```tsx
<AuthProvider>
  {children}
</AuthProvider>
```

No changes needed to layout.tsx — it already uses AuthProvider without props.

- [ ] **Step 3: Commit**

```bash
git add src/components/AuthProvider.tsx
git commit -m "refactor(auth): rewrite AuthProvider as thin Auth.js SessionProvider wrapper"
```

---

## Task 5: Delete old auth machinery

**Files:**
- Delete: `src/lib/supabase-health.ts`
- Delete: `src/hooks/useWakeRefresh.ts`
- Delete: `src/app/auth/callback/page.tsx`
- Delete: `src/lib/badge-check-inline.ts`
- Delete: `src/lib/badge-eval.ts`
- Delete: `src/lib/supabase-server-cookie.ts` (if exists)

- [ ] **Step 1: Delete the files**

```bash
rm -f src/lib/supabase-health.ts \
      src/hooks/useWakeRefresh.ts \
      src/app/auth/callback/page.tsx \
      src/lib/badge-check-inline.ts \
      src/lib/badge-eval.ts \
      src/lib/supabase-server-cookie.ts
```

- [ ] **Step 2: Remove all imports of deleted modules from page files**

In `src/app/[locale]/(app)/home/page.tsx`:
- Remove: `import { reportBatchFailures } from '@/lib/supabase-health'`
- Remove: `import { useWakeRefresh } from '@/hooks/useWakeRefresh'`
- Remove the `useWakeRefresh(fetchData)` call
- Remove the `void reportBatchFailures(failureCount, results.length, 'V3 Home')` call

In `src/app/[locale]/(app)/matches/page.tsx`:
- Remove: `import { useWakeRefresh } from '@/hooks/useWakeRefresh'`
- Remove: `import { reportBatchFailures } from '@/lib/supabase-health'`
- Remove the `useWakeRefresh(fetchData)` call
- Remove the `void reportBatchFailures(...)` call

In `src/app/[locale]/(app)/profile/page.tsx`:
- Remove: `import { useWakeRefresh } from '@/hooks/useWakeRefresh'`
- Remove the `useWakeRefresh(...)` call

In `src/app/[locale]/(app)/feed/page.tsx`:
- Remove: `import { checkBadgeInline } from '@/lib/badge-check-inline'`
- Remove: `import { useWakeRefresh } from '@/hooks/useWakeRefresh'`
- Remove the `useWakeRefresh(...)` call
- Remove any `checkBadgeInline(...)` calls (badge checks move to server-side API)

In `src/components/BadgeToast.tsx`:
- Remove: `import { BADGE_UNLOCK_EVENT } from '@/lib/badge-check-inline'`
- Define the constant locally: `const BADGE_UNLOCK_EVENT = 'pn-badge-unlock'`

- [ ] **Step 3: Verify build compiles**

```bash
npx next build 2>&1 | grep -i error | head -20
```

Fix any remaining broken imports.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(auth): delete Supabase auth recovery machinery (~820 lines)"
```

---

## Task 6: Clean up proxy.ts

**Files:**
- Modify: `src/proxy.ts`

- [ ] **Step 1: Remove Supabase cookie auth block from proxy**

In `src/proxy.ts`:

1. Remove the import: `import { createServerClient } from '@supabase/ssr'`
2. Remove the `cookieAuthEnabled` constant (line 14)
3. Remove the entire Supabase cookie refresh block (lines 104-146):
   ```ts
   // ── Supabase cookie refresh ─────
   // ... everything through the cookieAuthEnabled block
   ```
   Replace with just:
   ```ts
   // ── Run next-intl locale routing ───────────────────────────────
   const response = handleI18nRouting(request)
   ```
4. Remove the Supabase cookie merge block (lines 138-146):
   ```ts
   if (cookieAuthEnabled) {
     supabaseResponse.headers.getSetCookie()...
   }
   ```

The proxy should now only handle: auth param rescue, legacy redirects, ops auth, i18n routing, geo-cookies, and invite ref.

- [ ] **Step 2: Verify proxy still handles i18n + geo cookies**

```bash
npx next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/proxy.ts
git commit -m "refactor(auth): strip Supabase cookie auth from proxy"
```

---

## Task 7: User data API routes

**Files:**
- Create: `src/app/api/user/profile/route.ts`
- Create: `src/app/api/user/bookmarks/route.ts`
- Create: `src/app/api/user/badges/route.ts`
- Create: `src/app/api/user/ratings/route.ts`
- Create: `src/app/api/user/streak/route.ts`
- Create: `src/app/api/user/activity/route.ts`

- [ ] **Step 1: Create shared auth helper**

All routes share the same pattern. Create `src/app/api/user/_auth.ts`:

```ts
// src/app/api/user/_auth.ts
// Shared auth check for /api/user/* routes.

import { auth } from '@/auth'
import { createServiceClient } from '@/lib/supabase'

export async function getUserOrFail() {
  const session = await auth()
  if (!session?.user?.id) {
    return { user: null, supabase: null, error: Response.json({ error: 'unauthorized' }, { status: 401 }) }
  }
  return { user: session.user, supabase: createServiceClient(), error: null }
}
```

- [ ] **Step 2: Create profile route**

Create `src/app/api/user/profile/route.ts`:

```ts
import { getUserOrFail } from '../_auth'

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data } = await supabase!
    .from('profiles')
    .select('id, display_name, avatar_url, preferred_country')
    .eq('id', user!.id)
    .single()

  return Response.json(data)
}

export async function PATCH(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const body = await req.json()
  const allowed = ['display_name', 'avatar_url', 'preferred_country']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error: dbErr } = await supabase!
    .from('profiles')
    .update(updates)
    .eq('id', user!.id)
    .select('id, display_name, avatar_url, preferred_country')
    .single()

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json(data)
}
```

- [ ] **Step 3: Create bookmarks route**

Create `src/app/api/user/bookmarks/route.ts`:

```ts
import { getUserOrFail } from '../_auth'

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data } = await supabase!
    .from('user_bookmarks')
    .select('bookmark_type, target_id')
    .eq('user_id', user!.id)

  return Response.json(data ?? [])
}

export async function POST(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { bookmark_type, target_id } = await req.json()
  if (!bookmark_type || !target_id) {
    return Response.json({ error: 'Missing bookmark_type or target_id' }, { status: 400 })
  }

  const { error: dbErr } = await supabase!
    .from('user_bookmarks')
    .upsert(
      { user_id: user!.id, bookmark_type, target_id },
      { onConflict: 'user_id,bookmark_type,target_id' }
    )

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { bookmark_type, target_id } = await req.json()
  if (!bookmark_type || !target_id) {
    return Response.json({ error: 'Missing bookmark_type or target_id' }, { status: 400 })
  }

  await supabase!
    .from('user_bookmarks')
    .delete()
    .eq('user_id', user!.id)
    .eq('bookmark_type', bookmark_type)
    .eq('target_id', target_id)

  return Response.json({ ok: true })
}
```

- [ ] **Step 4: Create badges route**

Create `src/app/api/user/badges/route.ts`:

```ts
import { getUserOrFail } from '../_auth'
import { BADGE_CATALOG, BADGE_MAP, OG_FAN_CUTOFF, type BadgeDefinition } from '@/lib/badges'

// Server-side badge count evaluator (moved from badge-eval.ts)
async function getBadgeCount(
  supabase: ReturnType<typeof import('@/lib/supabase').createServiceClient>,
  userId: string,
  badge: BadgeDefinition
): Promise<number> {
  switch (badge.evalType) {
    case 'bookmark_count': {
      const { count } = await supabase
        .from('user_bookmarks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('bookmark_type', badge.evalParam ?? '')
      return count ?? 0
    }
    case 'rating_count': {
      const { count } = await supabase
        .from('match_ratings')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      return count ?? 0
    }
    case 'activity_count': {
      const { count } = await supabase
        .from('user_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('action', badge.evalParam ?? '')
      return count ?? 0
    }
    case 'login_streak': {
      const { data } = await supabase.from('profiles').select('login_streak').eq('id', userId).single()
      return data?.login_streak ?? 0
    }
    case 'longest_streak': {
      const { data } = await supabase.from('profiles').select('longest_streak').eq('id', userId).single()
      return data?.longest_streak ?? 0
    }
    case 'referral_count': {
      const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', userId)
      return count ?? 0
    }
    case 'profile_complete':
      return 1
    case 'early_adopter': {
      const { data } = await supabase.from('profiles').select('created_at').eq('id', userId).single()
      if (!data?.created_at) return 0
      return new Date(data.created_at) < OG_FAN_CUTOFF ? 1 : 0
    }
    case 'feature_interest': {
      const { count } = await supabase.from('feature_interest').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('feature_key', badge.evalParam ?? '')
      return (count ?? 0) > 0 ? 1 : 0
    }
    case 'push_enabled': {
      const { count } = await supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', userId)
      return (count ?? 0) > 0 ? 1 : 0
    }
    default:
      return 0
  }
}

export async function GET(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const url = new URL(req.url)
  const checkUnlocks = url.searchParams.get('check_unlocks') === 'true'

  // Fetch existing badges
  const { data: badges } = await supabase!
    .from('user_badges')
    .select('badge_id, tier, unlocked_at')
    .eq('user_id', user!.id)

  if (!checkUnlocks) {
    return Response.json(badges ?? [])
  }

  // Check for newly unlocked badges
  const earned = new Map<string, Set<number>>()
  for (const b of badges ?? []) {
    if (!earned.has(b.badge_id)) earned.set(b.badge_id, new Set())
    earned.get(b.badge_id)!.add(b.tier)
  }

  const newBadges: { badge_id: string; tier: number }[] = []

  for (const badge of BADGE_CATALOG) {
    const count = await getBadgeCount(supabase!, user!.id, badge)
    const alreadyEarned = earned.get(badge.id) ?? new Set()

    if (badge.isSingleTier) {
      if (count >= 1 && !alreadyEarned.has(1)) {
        await supabase!.from('user_badges').insert({ user_id: user!.id, badge_id: badge.id, tier: 1 })
        newBadges.push({ badge_id: badge.id, tier: 1 })
      }
    } else {
      for (const t of badge.tiers) {
        if (count >= t.threshold && !alreadyEarned.has(t.tier)) {
          await supabase!.from('user_badges').insert({ user_id: user!.id, badge_id: badge.id, tier: t.tier })
          newBadges.push({ badge_id: badge.id, tier: t.tier })
        }
      }
    }
  }

  // Refetch to include newly earned
  const { data: allBadges } = await supabase!
    .from('user_badges')
    .select('badge_id, tier, unlocked_at')
    .eq('user_id', user!.id)

  return Response.json({ badges: allBadges ?? [], newBadges })
}
```

- [ ] **Step 5: Create streak route**

Create `src/app/api/user/streak/route.ts`:

```ts
import { getUserOrFail } from '../_auth'

export async function POST() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data: profile } = await supabase!
    .from('profiles')
    .select('last_active_at, login_streak, longest_streak')
    .eq('id', user!.id)
    .single()

  if (!profile) return Response.json({ error: 'profile not found' }, { status: 404 })

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const lastActive = profile.last_active_at
    ? new Date(profile.last_active_at).toISOString().slice(0, 10)
    : null

  if (lastActive === today) {
    return Response.json({ streak: profile.login_streak, longest: profile.longest_streak, already_updated: true })
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)

  const newStreak = lastActive === yesterdayStr
    ? (profile.login_streak ?? 0) + 1
    : 1
  const newLongest = Math.max(newStreak, profile.longest_streak ?? 0)

  await supabase!
    .from('profiles')
    .update({ last_active_at: now.toISOString(), login_streak: newStreak, longest_streak: newLongest })
    .eq('id', user!.id)

  return Response.json({ streak: newStreak, longest: newLongest })
}
```

- [ ] **Step 6: Create activity route**

Create `src/app/api/user/activity/route.ts`:

```ts
import { getUserOrFail } from '../_auth'

export async function POST(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { action, target_id, metadata } = await req.json()
  if (!action) return Response.json({ error: 'Missing action' }, { status: 400 })

  await supabase!.from('user_activity_log').insert({
    user_id: user!.id,
    action,
    target_id: target_id ?? null,
    metadata: metadata ?? null,
  })

  return Response.json({ ok: true })
}
```

- [ ] **Step 7: Create ratings route**

Create `src/app/api/user/ratings/route.ts`:

```ts
import { getUserOrFail } from '../_auth'

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data } = await supabase!
    .from('match_ratings')
    .select('match_id, rating, updated_at')
    .eq('user_id', user!.id)

  return Response.json(data ?? [])
}

export async function POST(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { matchId, rating } = await req.json()
  if (!matchId || !rating) return Response.json({ error: 'Missing matchId or rating' }, { status: 400 })

  const ratingNum = Number(rating)
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return Response.json({ error: 'Rating must be 1-5' }, { status: 400 })
  }

  const { error: dbErr } = await supabase!
    .from('match_ratings')
    .upsert(
      { match_id: matchId, user_id: user!.id, rating: ratingNum, updated_at: new Date().toISOString() },
      { onConflict: 'match_id,user_id' }
    )

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

  // Return updated aggregate
  const { data: agg } = await supabase!
    .from('match_ratings')
    .select('rating')
    .eq('match_id', matchId)

  const ratings = (agg ?? []).map(r => r.rating)
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null

  return Response.json({ avg_rating: avg, rating_count: ratings.length })
}
```

- [ ] **Step 8: Create push subscriptions route**

Create `src/app/api/user/push-subscriptions/route.ts`:

```ts
import { getUserOrFail } from '../_auth'

export async function POST(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { endpoint, keys, expirationTime } = await req.json()
  if (!endpoint || !keys) return Response.json({ error: 'Missing endpoint or keys' }, { status: 400 })

  const { error: dbErr } = await supabase!
    .from('push_subscriptions')
    .upsert(
      { user_id: user!.id, endpoint, keys, expiration_time: expirationTime ?? null },
      { onConflict: 'user_id,endpoint' }
    )

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { endpoint } = await req.json()
  if (!endpoint) return Response.json({ error: 'Missing endpoint' }, { status: 400 })

  await supabase!
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user!.id)
    .eq('endpoint', endpoint)

  return Response.json({ ok: true })
}
```

- [ ] **Step 9: Commit**

```bash
git add src/app/api/user/
git commit -m "feat(auth): add user data API routes (profile, bookmarks, badges, ratings, streak, activity, push)"
```

---

## Task 8: Rewrite client hooks to use API routes

**Files:**
- Rewrite: `src/hooks/useFollowing.ts`
- Rewrite: `src/hooks/useBadges.ts`
- Rewrite: `src/hooks/useMatchRating.ts`
- Rewrite: `src/lib/activity-log.ts`
- Modify: `src/hooks/useInvite.ts`

- [ ] **Step 1: Rewrite useFollowing**

In `src/hooks/useFollowing.ts`:

1. Remove: `import { supabase } from '@/lib/supabase'`
2. Remove: `import { checkBadgeInline } from '@/lib/badge-check-inline'`
3. Replace the Supabase query in `load()` (lines 98-113) with:
   ```ts
   const res = await fetch('/api/user/bookmarks')
   if (res.ok) {
     const data: { bookmark_type: string; target_id: string }[] = await res.json()
     // ... same Set-building logic
   }
   ```
4. Replace the Supabase insert/delete in `toggle()` (lines 173-194) with:
   ```ts
   if (isCurrently) {
     await fetch('/api/user/bookmarks', {
       method: 'DELETE',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ bookmark_type: typeToDbType(type), target_id: targetId }),
     })
   } else {
     await fetch('/api/user/bookmarks', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ bookmark_type: typeToDbType(type), target_id: targetId }),
     })
   }
   ```
5. Remove the `checkBadgeInline` call — badge checks happen server-side now.

- [ ] **Step 2: Rewrite useBadges**

Replace the entire contents of `src/hooks/useBadges.ts` with:

```ts
'use client'
// src/hooks/useBadges.ts
// Badge state hook — fetches earned badges via API route.

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'

export interface EarnedBadge {
  badge_id: string
  tier: number
  unlocked_at: string
}

export interface UseBadgesResult {
  badges: EarnedBadge[]
  loading: boolean
  checkAndAward: (badgeId: string) => Promise<EarnedBadge[]>
  evaluateAll: () => Promise<EarnedBadge[]>
  refresh: () => Promise<void>
}

export function useBadges(): UseBadgesResult {
  const { user, loading: authLoading } = useAuth()
  const [badges, setBadges] = useState<EarnedBadge[]>([])
  const [loading, setLoading] = useState(true)

  const fetchBadges = useCallback(async (checkUnlocks = false) => {
    if (!user) { setBadges([]); setLoading(false); return [] }
    const url = checkUnlocks ? '/api/user/badges?check_unlocks=true' : '/api/user/badges'
    const res = await fetch(url)
    if (!res.ok) { setLoading(false); return [] }
    const data = await res.json()
    const list = checkUnlocks ? data.badges : data
    setBadges(list ?? [])
    setLoading(false)
    return checkUnlocks ? (data.newBadges ?? []) : []
  }, [user])

  useEffect(() => {
    if (authLoading) return
    void fetchBadges()
  }, [authLoading, fetchBadges])

  const checkAndAward = useCallback(async (_badgeId: string): Promise<EarnedBadge[]> => {
    // Individual badge check not needed — evaluateAll handles all
    return fetchBadges(true)
  }, [fetchBadges])

  const evaluateAll = useCallback(async (): Promise<EarnedBadge[]> => {
    return fetchBadges(true)
  }, [fetchBadges])

  return { badges, loading, checkAndAward, evaluateAll, refresh: () => fetchBadges() }
}
```

- [ ] **Step 3: Rewrite useMatchRating**

In `src/hooks/useMatchRating.ts`:

1. Remove: `import { supabase } from '@/lib/supabase'`
2. Remove: `import { checkBadgeInline } from '@/lib/badge-check-inline'`
3. In `setRating` callback, replace the `supabase.auth.getSession()` + Bearer token logic (lines 71-86) with a simple fetch:
   ```ts
   const res = await fetch('/api/match-rating', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ matchId, rating: n, deviceId }),
   })
   if (res.ok) {
     const data = await res.json()
     setAvgRating(data.avg_rating ?? null)
     setRatingCount(data.rating_count ?? 0)
   }
   ```
4. Remove the `checkBadgeInline` call.

- [ ] **Step 4: Rewrite activity-log.ts**

Replace the entire contents of `src/lib/activity-log.ts` with:

```ts
// src/lib/activity-log.ts
// Fire-and-forget event logger via API route.

export async function logActivity(
  _userId: string,
  action: string,
  targetId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await fetch('/api/user/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, target_id: targetId, metadata }),
    })
  } catch {
    // Silent — never block UI for logging
  }
}
```

Note: `userId` param kept for API compatibility but ignored — the API route reads the user from the session cookie.

- [ ] **Step 5: Update useInvite.ts**

In `src/hooks/useInvite.ts`:
1. Remove: `import { checkBadgeInline } from '@/lib/badge-check-inline'`
2. Remove the two `checkBadgeInline(user.id, 'share_app')` calls (lines 84, 95) — badge evaluation happens lazily via the badges API.

- [ ] **Step 6: Update usePushNotifications.ts**

In `src/hooks/usePushNotifications.ts`:
1. Remove: `import { supabase } from '@/lib/supabase'`
2. Replace the `supabase.from('push_subscriptions').upsert(...)` call with:
   ```ts
   await fetch('/api/user/push-subscriptions', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys, expirationTime: sub.expirationTime }),
   })
   ```
3. Replace the `supabase.from('push_subscriptions').delete()...` call with:
   ```ts
   await fetch('/api/user/push-subscriptions', {
     method: 'DELETE',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ endpoint: sub.endpoint }),
   })
   ```

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useFollowing.ts src/hooks/useBadges.ts src/hooks/useMatchRating.ts src/lib/activity-log.ts src/hooks/useInvite.ts src/hooks/usePushNotifications.ts
git commit -m "refactor(auth): rewrite client hooks to use API routes instead of direct Supabase"
```

---

## Task 9: Update LoginSheet + existing API routes

**Files:**
- Modify: `src/components/LoginSheet.tsx`
- Modify: `src/app/api/match-rating/route.ts`
- Modify: `src/app/api/racket-click/route.ts`

- [ ] **Step 1: Update LoginSheet to use Auth.js signIn**

In `src/components/LoginSheet.tsx`:

1. Remove: `import { supabase, siteUrl } from '@/lib/supabase'`
2. Add: `import { signIn } from 'next-auth/react'`
3. Replace `handleGoogle` (lines 56-63):
   ```ts
   const handleGoogle = async () => {
     await signIn('google', { callbackUrl: '/home' })
   }
   ```
4. Replace `handleMagicLink` (lines 66-83):
   ```ts
   const handleMagicLink = async () => {
     if (!email.trim()) return
     setSending(true)
     setError(null)
     try {
       await signIn('resend', { email: email.trim(), redirect: false })
       setSent(true)
     } catch {
       setError('Failed to send link, please try again')
     }
     setSending(false)
   }
   ```

- [ ] **Step 2: Update match-rating API route**

In `src/app/api/match-rating/route.ts`:

1. Remove: `import { createClient } from '@supabase/supabase-js'`
2. Add: `import { auth } from '@/auth'`
3. Replace the Bearer token user lookup (lines 24-34) with:
   ```ts
   let userId: string | null = null
   const session = await auth()
   if (session?.user?.id) {
     userId = session.user.id
   }
   ```

- [ ] **Step 3: Update racket-click API route**

In `src/app/api/racket-click/route.ts`:

1. Add: `import { auth } from '@/auth'`
2. Replace the `supabase.auth.getSession()` call (line 30) with:
   ```ts
   const session = await auth()
   const userId = session?.user?.id ?? null
   ```

- [ ] **Step 4: Commit**

```bash
git add src/components/LoginSheet.tsx src/app/api/match-rating/route.ts src/app/api/racket-click/route.ts
git commit -m "refactor(auth): update LoginSheet + API routes to use Auth.js"
```

---

## Task 10: Uninstall @supabase/ssr + final cleanup

**Files:**
- Modify: `package.json`
- Verify: all remaining imports

- [ ] **Step 1: Uninstall @supabase/ssr**

```bash
npm uninstall @supabase/ssr
```

- [ ] **Step 2: Search for any remaining references to deleted modules**

```bash
grep -r "supabase-health\|useWakeRefresh\|badge-check-inline\|badge-eval\|supabase-server-cookie\|cookieAuthEnabled\|@supabase/ssr" src/ --include="*.ts" --include="*.tsx" -l
```

Expected: no results. Fix any stragglers.

- [ ] **Step 3: Search for remaining supabase.auth calls**

```bash
grep -r "supabase\.auth\." src/ --include="*.ts" --include="*.tsx" -l
```

Expected: only `src/lib/supabase.ts` (the disabled auth config). Any other file is a missed migration — fix it.

- [ ] **Step 4: Full build verification**

```bash
npm run build
```

Expected: successful build with no import errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(auth): uninstall @supabase/ssr + final cleanup"
```

---

## Task 11: Environment variables + local testing

**Files:**
- Modify: `.env.local` (or Vercel dashboard)

- [ ] **Step 1: Generate AUTH_SECRET**

```bash
npx auth secret
```

This outputs a random secret. Add it to `.env.local`:

```
AUTH_SECRET=<generated-secret>
```

- [ ] **Step 2: Configure Google OAuth**

Get Google OAuth credentials from Google Cloud Console (or reuse existing ones from Supabase config). Add to `.env.local`:

```
AUTH_GOOGLE_ID=<your-google-client-id>
AUTH_GOOGLE_SECRET=<your-google-client-secret>
```

Update the Google OAuth authorized redirect URI to include: `http://localhost:3002/api/auth/callback/google` (dev) and `https://padelnachos.com/api/auth/callback/google` (prod).

- [ ] **Step 3: Configure Resend**

Sign up at resend.com, create an API key. Add to `.env.local`:

```
RESEND_API_KEY=<your-resend-api-key>
AUTH_EMAIL_FROM=PadelNachos <noreply@padelnachos.com>
```

- [ ] **Step 4: Configure DATABASE_URL**

Get the direct Postgres connection string from Supabase dashboard (Settings → Database → Connection string → URI). Add to `.env.local`:

```
DATABASE_URL=postgresql://postgres:<password>@<host>:5432/postgres
```

- [ ] **Step 5: Test locally**

```bash
npm run dev
```

1. Open `http://localhost:3002/home`
2. Verify page loads without auth-related console errors
3. Click sign-in → test Google OAuth flow
4. Verify session cookie is set after sign-in
5. Verify sign-out works
6. Check browser network tab — zero Supabase auth calls

- [ ] **Step 6: Add env vars to Vercel**

Add `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `DATABASE_URL` to Vercel environment variables.

- [ ] **Step 7: Commit any local config changes**

```bash
git add -A
git commit -m "docs(auth): document required env vars for Auth.js"
```

---

## Task 12: User ID migration script (post-deploy)

**Files:**
- Create: `scripts/migrate-authjs-users.ts`

This runs AFTER the 3 users have signed in via Auth.js and have new user IDs.

- [ ] **Step 1: Create migration script**

Create `scripts/migrate-authjs-users.ts`:

```ts
// scripts/migrate-authjs-users.ts
// One-time migration: map old Supabase auth user IDs to new Auth.js user IDs.
// Run after all 3 users have signed in via Auth.js.
//
// Usage:
//   npx tsx scripts/migrate-authjs-users.ts --dry-run
//   npx tsx scripts/migrate-authjs-users.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const DRY_RUN = process.argv.includes('--dry-run')

// Tables with user_id FK columns
const USER_TABLES = [
  'user_bookmarks',
  'user_badges',
  'match_ratings',
  'user_activity_log',
  'feature_interest',
  'push_subscriptions',
  'social_posts',
] as const

async function main() {
  // Get Auth.js users (matched by email)
  const { data: authjsUsers } = await supabase
    .from('users')
    .select('id, email')

  if (!authjsUsers?.length) {
    console.log('No Auth.js users found. Have users signed in yet?')
    return
  }

  // Get old profiles (with old Supabase auth IDs)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name')

  // Match by looking up the old auth.users email
  // We need to query auth.users via the management API or a direct SQL query
  const { data: oldAuthUsers } = await supabase.rpc('get_auth_users_for_migration')

  // If the RPC doesn't exist, use a manual mapping
  console.log('Auth.js users:', authjsUsers.map(u => `${u.email} -> ${u.id}`))
  console.log('Existing profiles:', profiles?.map(p => `${p.id} -> ${p.display_name}`))
  console.log('')
  console.log('Please provide the mapping manually:')
  console.log('Edit this script with the OLD_TO_NEW map and re-run.')
  console.log('')

  // MANUAL MAPPING — fill in after checking the IDs above
  const OLD_TO_NEW: Record<string, string> = {
    // 'old-supabase-auth-user-id': 'new-authjs-user-id',
  }

  if (Object.keys(OLD_TO_NEW).length === 0) {
    console.log('No mappings defined. Exiting.')
    return
  }

  for (const [oldId, newId] of Object.entries(OLD_TO_NEW)) {
    console.log(`\nMigrating ${oldId} -> ${newId}`)

    // Update profiles.id
    if (DRY_RUN) {
      console.log(`  [DRY] Would update profiles SET id=${newId} WHERE id=${oldId}`)
    } else {
      const { error } = await supabase.rpc('migrate_user_id', { old_id: oldId, new_id: newId })
      if (error) console.error(`  profiles error:`, error.message)
      else console.log(`  profiles: ok`)
    }

    // Update user_id in all related tables
    for (const table of USER_TABLES) {
      const { count } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', oldId)

      if ((count ?? 0) > 0) {
        if (DRY_RUN) {
          console.log(`  [DRY] Would update ${count} rows in ${table}`)
        } else {
          const { error } = await supabase
            .from(table)
            .update({ user_id: newId })
            .eq('user_id', oldId)
          if (error) console.error(`  ${table} error:`, error.message)
          else console.log(`  ${table}: updated ${count} rows`)
        }
      }
    }
  }

  console.log('\nMigration complete.')
}

main().catch(console.error)
```

- [ ] **Step 2: Commit**

```bash
git add scripts/migrate-authjs-users.ts
git commit -m "feat(auth): add user ID migration script for 3 existing users"
```

---

## Summary

| Task | Description | Est. |
|------|-------------|------|
| 1 | Dependencies + DB migration | 5 min |
| 2 | Auth.js config + API route | 5 min |
| 3 | Simplify Supabase client | 3 min |
| 4 | Rewrite AuthProvider | 5 min |
| 5 | Delete old auth machinery | 10 min |
| 6 | Clean up proxy.ts | 5 min |
| 7 | User data API routes | 15 min |
| 8 | Rewrite client hooks | 15 min |
| 9 | Update LoginSheet + API routes | 10 min |
| 10 | Uninstall @supabase/ssr + cleanup | 5 min |
| 11 | Env vars + local testing | 10 min |
| 12 | User ID migration (post-deploy) | 5 min |
