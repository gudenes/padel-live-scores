// apps/ops/src/app/api/internal/tier-visibility/[level]/route.ts
// Set a tier's show_on_matches switch. Upserts, so an unconfigured
// (newly-invented) level can be toggled straight from the admin.
// Auth: Auth.js session with isOperator flag. Service-key write bypasses RLS.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

type RouteContext = { params: Promise<{ level: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { level } = await ctx.params
  if (!level) return Response.json({ error: 'missing_level' }, { status: 400 })
  if (!/^[a-z0-9_]+$/.test(level)) return Response.json({ error: 'invalid_level' }, { status: 400 })

  let body: { show_on_matches?: unknown; label?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body.show_on_matches !== 'boolean') {
    return Response.json({ error: 'show_on_matches_must_be_boolean' }, { status: 400 })
  }

  const row = {
    level,
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : level,
    show_on_matches: body.show_on_matches,
    updated_by: 'ops',
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('tier_visibility')
    .upsert(row, { onConflict: 'level' })
    .select('level, label, show_on_matches, sort_order, updated_at, updated_by')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ tier: data })
}
