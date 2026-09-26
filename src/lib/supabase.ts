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

/**
 * Server-side client with the ANON key — RLS applies exactly as it does for a
 * visitor's browser. Use this for server-rendered public pages.
 *
 * Deliberately not the service client: that one bypasses RLS, so the day a
 * policy is tightened (say, to respect players.hidden) a page built on it
 * would keep serving what the policy started protecting, with no signal.
 */
export function createAnonServerClient() {
  const url = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anon = supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !anon) {
    throw new Error(
      'createAnonServerClient requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY',
    )
  }
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

// Legacy alias — keep existing server-side call sites working
export { createServiceClient as createServerClient }
