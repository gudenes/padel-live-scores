// apps/ops/src/app/api/internal/play-templates/route.ts
// List Play prediction-market templates for the ops dashboard.
// Auth: Auth.js session with isOperator flag.
// Spec: docs/superpowers/specs/2026-09-23-prediction-market-design.md

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const { data: templates, error } = await supabase
    .from('market_templates')
    .select(
      'id, key, question_i18n, horizon, trigger, lock_rule, resolver_key, seed_source, max_loss_guacas, params, gates, enabled, updated_at',
    )
    .order('horizon', { ascending: true })
    .order('key', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // The active season and global limits give the numbers meaning — a
  // template's subsidy is only legible against the budget it draws from.
  const [{ data: season }, { data: limits }, { data: marketRows }] = await Promise.all([
    supabase
      .from('market_seasons')
      .select('name, status, starts_at, ends_at')
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('market_limits')
      .select('max_open_markets, max_new_per_day, max_subsidy_per_day')
      .maybeSingle(),
    supabase.from('markets').select('template_id'),
  ])

  // How many markets each template has actually produced. Zero everywhere
  // until the generator runs for real — which is the honest answer, not a bug.
  const producedByTemplateId: Record<string, number> = {}
  for (const m of marketRows ?? []) {
    const id = m.template_id as string
    producedByTemplateId[id] = (producedByTemplateId[id] ?? 0) + 1
  }

  const withCounts = (templates ?? []).map((t) => ({
    ...t,
    produced: producedByTemplateId[t.id as string] ?? 0,
  }))

  return Response.json({
    templates: withCounts,
    season: season ?? null,
    limits: limits ?? null,
  })
}
