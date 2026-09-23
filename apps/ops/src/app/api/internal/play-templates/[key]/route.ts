// apps/ops/src/app/api/internal/play-templates/[key]/route.ts
// Enable or disable a single Play market template.
// Auth: Auth.js session with isOperator flag. Service-key write bypasses RLS.
//
// Enabling a template is what lets the generator instantiate markets from it.
// It is deliberately the ONLY field editable here: question text, resolver,
// gates and subsidy are frozen onto every market at creation, so changing them
// from a toggle screen would be misleading — see the spec's "A market freezes
// its configuration at creation".

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

type RouteContext = { params: Promise<{ key: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { key } = await ctx.params
  if (!key) return Response.json({ error: 'missing_key' }, { status: 400 })

  let body: { enabled?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body.enabled !== 'boolean') {
    return Response.json({ error: 'enabled_must_be_boolean' }, { status: 400 })
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('market_templates')
    .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
    .eq('key', key)
    .select('key, enabled, updated_at')
    .maybeSingle()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return Response.json({ template: data })
}
