// apps/ops/src/app/api/internal/feature-flags/route.ts
// List all feature flags for the ops dashboard.
// Auth: Auth.js session with isOperator flag.
// Ported from src/app/api/ops/feature-flags/route.ts (Plan 3b-extra Task 1).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('feature_flags')
    .select('key, enabled, enabled_local, label, description, updated_at, updated_by')
    .order('key', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ flags: data ?? [] })
}
