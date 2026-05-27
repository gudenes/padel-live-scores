// apps/ops/src/lib/supabase.ts
// Service-role Supabase client for admin-app server components and API routes.
// Apps/ops also uses pg Pool (./db.ts) for arbitrary SQL — this helper is for
// code that prefers the PostgREST-style query builder (lifted /api/internal/*
// routes, /odds pages via odds-data, etc.).
//
// Mirrors the pattern the main app uses in its /api/ops/* routes — same library,
// same service key, just centralized so we can swap or instrument later.

import { createClient } from '@supabase/supabase-js'

// Canonical factory — validated env, full auth flags.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? ''
  if (!url || !serviceKey) {
    throw new Error(
      'createServiceClient requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY',
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

// Alias kept for callers landed in #463 (/api/internal/* routes).
export const serviceClient = createServiceClient
