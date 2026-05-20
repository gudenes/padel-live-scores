// src/app/api/ops/feature-flags/route.ts
// List all feature flags for the ops dashboard. Auth: ops_token cookie.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function GET() {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { data, error } = await supabase
    .from('feature_flags')
    .select('key, enabled, label, description, updated_at, updated_by')
    .order('key', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ flags: data ?? [] })
}
