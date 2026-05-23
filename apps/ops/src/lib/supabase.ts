// apps/ops/src/lib/supabase.ts
// Service-role Supabase client for admin-app server routes that need to
// bypass RLS (most of the lifted /api/internal/* routes). Mirrors the
// pattern the main app uses in its /api/ops/* routes — same library,
// same service key, just centralized so we can swap or instrument later.

import { createClient } from '@supabase/supabase-js'

export function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
