// src/lib/supabase.ts
// Supabase client helpers — browser (anon) and server (service role)

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Browser client — uses anon key, respects RLS
// Auth options enable PKCE flow and session detection from OAuth/magic-link redirects
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    detectSessionInUrl: true,
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<unknown>) => fn(),
  },
})

// Server client — uses service key, bypasses RLS
// Only use in API routes and server components
export function createServerClient() {
  return createClient(supabaseUrl, process.env.SUPABASE_SERVICE_KEY!)
}
