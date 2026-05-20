// src/app/api/ops/feature-flags/[key]/route.ts
// Toggle a single feature flag's production OR local switch.
// Auth: ops_token cookie. Service-key write bypasses RLS.

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

type RouteContext = { params: Promise<{ key: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { key } = await ctx.params
  if (!key) return Response.json({ error: 'missing_key' }, { status: 400 })

  let body: { enabled?: unknown; enabled_local?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const update: { enabled?: boolean; enabled_local?: boolean; updated_by: string } = {
    updated_by: 'ops',
  }
  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      return Response.json({ error: 'enabled_must_be_boolean' }, { status: 400 })
    }
    update.enabled = body.enabled
  }
  if ('enabled_local' in body) {
    if (typeof body.enabled_local !== 'boolean') {
      return Response.json({ error: 'enabled_local_must_be_boolean' }, { status: 400 })
    }
    update.enabled_local = body.enabled_local
  }
  if (update.enabled === undefined && update.enabled_local === undefined) {
    return Response.json(
      { error: 'must_provide_enabled_or_enabled_local' },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from('feature_flags')
    .update(update)
    .eq('key', key)
    .select('key, enabled, enabled_local, label, description, updated_at, updated_by')
    .maybeSingle()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return Response.json({ flag: data })
}
