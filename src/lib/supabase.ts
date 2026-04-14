// src/lib/supabase.ts
// Supabase client helpers — browser (anon) and server (service role)

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

// Canonical site URL — uses env var in production, falls back to window.location.origin for local dev
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  || (typeof window !== 'undefined' ? window.location.origin : '')

// ── Custom auth lock ─────────────────────────────────────────────────
//
// History: Supabase's default `navigator.locks`-based lock was timing out
// at 5s on slow DB responses (commit df59f6a April 2). The original fix
// replaced it with a pure pass-through, which eliminated the timeout but
// also eliminated the serialization. That allowed multiple concurrent
// `getSession()` / token refresh calls to race each other — and since
// refresh tokens are single-use, one of the racing refreshes would fail
// and leave the client in a wedged state where every subsequent query
// would hang waiting for state that never arrives.
//
// This implementation is an in-memory serializing lock with NO timeout:
// - Per-name promise chains so distinct locks don't block each other
// - Failed predecessors don't poison successors (we catch errors in the
//   chain so the next waiter still runs)
// - No reliance on navigator.locks (which has the 5s issue)
// - No cross-tab coordination (we have a single AuthProvider; cross-tab
//   sync is handled via supabase.auth.onAuthStateChange's `storage` events)
const lockChains = new Map<string, Promise<unknown>>()

async function serializingLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>
): Promise<R> {
  const previous = lockChains.get(name) ?? Promise.resolve()
  // Wait for the previous holder to finish — BUT with a timeout.
  // If the predecessor hangs (network stall, browser throttle, stale
  // PKCE exchange), we proceed after acquireTimeout ms instead of
  // waiting forever. Worst case: two auth ops run concurrently and one
  // fails due to the single-use refresh token. A failed-then-retried
  // refresh is infinitely better than a permanently wedged client.
  const waitForPrevious = Promise.race([
    previous.catch(() => undefined),
    new Promise<void>(resolve => setTimeout(resolve, acquireTimeout || 5000)),
  ])
  const tail: Promise<R> = waitForPrevious.then(() => fn())
  // Store a swallowed version so that if our `fn` throws, the next waiter
  // still gets a clean signal to start.
  lockChains.set(name, tail.catch(() => undefined))
  return tail
}

// Browser client — uses anon key, respects RLS.
// Auth options:
// - detectSessionInUrl: pick up tokens from OAuth/magic-link redirects
// - flowType: 'pkce'
// - autoRefreshToken: FALSE — we refresh manually on a controlled schedule
//   (see startSessionKeepalive and useWakeRefresh) to avoid auto-refresh
//   racing with in-flight queries
// - persistSession: keep the session in localStorage across reloads
// - lock: our serializing in-memory lock (see comment above)
//
// Guard: during Next.js build ("Collecting page data" phase), NEXT_PUBLIC_*
// env vars may not be available in worker processes. Server-side code that
// only needs createServerClient() also triggers this module evaluation, so
// we use placeholder values to prevent the module from crashing. The
// placeholder client is never used — real env vars are always baked into
// the client-side JS bundle at build time and available on the server at runtime.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      detectSessionInUrl: true,
      flowType: 'pkce',
      autoRefreshToken: false,
      persistSession: true,
      lock: serializingLock,
    },
  },
)

// Expose the client on window for debugging — only in the browser, never SSR.
// Lets you paste diagnostic scripts into the console that touch supabase.*
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__pn_supabase = supabase
}

// Server client — uses service key, bypasses RLS.
// Only use in API routes and server components.
// Auth is disabled: no session persistence, no token refresh, no URL detection —
// none of these make sense for a service-key client running on the server.
export function createServerClient() {
  const url = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? ''
  if (!url || !serviceKey) {
    throw new Error(
      'createServerClient requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY'
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
