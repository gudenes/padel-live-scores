// src/app/api/ops/player-suggestions/[id]/route.ts
// Ops actions on a single suggestion:
//   { action: 'apply', field, value }  → write one whitelisted column on players
//   { action: 'reject', review_note? } → mark rejected
//   { action: 'resolve', review_note? }→ mark applied (operator handled it)
//
// 'apply' writes the value verbatim to players (human override = source of
// truth) and does NOT auto-change the suggestion status — the operator
// resolves the item once every field has been handled.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { checkOpsAuth } from '@/lib/ops-auth'
import { isSuggestableField, columnForField } from '@/lib/player-suggestion-fields'
import { normalizeCountry } from '@/lib/country'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    field?: string
    value?: string
    review_note?: string
  }

  const supabase = createServerClient()

  const { data: suggestion, error: fetchErr } = await supabase
    .from('player_suggestions')
    .select('id, player_id, status')
    .eq('id', id)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!suggestion) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (body.action === 'apply') {
    const field = body.field ?? ''
    if (!isSuggestableField(field)) {
      return NextResponse.json({ error: 'invalid_field' }, { status: 400 })
    }
    const column = columnForField(field)
    const rawValue = typeof body.value === 'string' ? body.value.trim() : ''
    if (!rawValue) return NextResponse.json({ error: 'empty_value' }, { status: 400 })

    // A human override is the source of truth, but the value must still match
    // the column's canonical format — don't let free-text input corrupt a
    // normalized column (alpha-2 country, numeric height, date birthdate).
    let value: string | number = rawValue
    if (column === 'height') {
      value = Number(rawValue)
      if (!Number.isFinite(value)) {
        return NextResponse.json({ error: 'invalid_height' }, { status: 400 })
      }
    } else if (column === 'country') {
      // players.country is a canonical alpha-2 code rendered as a flag.
      const code = normalizeCountry(rawValue)
      if (!code) return NextResponse.json({ error: 'invalid_country' }, { status: 400 })
      value = code
    } else if (column === 'birthdate') {
      // players.birthdate is a date column — reject unparseable input rather
      // than leaking a raw Postgres error to the operator's alert().
      if (Number.isNaN(Date.parse(rawValue))) {
        return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
      }
      value = rawValue
    }

    const { error: updateErr } = await supabase
      .from('players')
      .update({ [column]: value })
      .eq('id', suggestion.player_id)
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, applied: { field, column, value } })
  }

  if (body.action === 'reject' || body.action === 'resolve') {
    const status = body.action === 'reject' ? 'rejected' : 'applied'
    const { error: updErr } = await supabase
      .from('player_suggestions')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: 'ops',
        review_note: body.review_note ?? null,
      })
      .eq('id', id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, status })
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
