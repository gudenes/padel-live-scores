// apps/ops/src/app/api/internal/padelgod-shadow/enroll/route.ts
// POST endpoint to enroll / unenroll / cutover a tournament for Padelgod Shadow Mode.
// Body: { tournament_id: string, action: 'enroll' | 'unenroll' | 'cutover' }
//
// Auth: Auth.js session — isOperator required (rule 1).
// Supabase: serviceClient() (rule 2).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

type Action = 'enroll' | 'unenroll' | 'cutover'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  let body: { tournament_id?: string; action?: Action }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const tournamentId = body.tournament_id
  const action = body.action

  if (!tournamentId || typeof tournamentId !== 'string') {
    return NextResponse.json({ error: 'tournament_id required' }, { status: 400 })
  }
  if (action !== 'enroll' && action !== 'unenroll' && action !== 'cutover') {
    return NextResponse.json(
      { error: "action must be 'enroll' | 'unenroll' | 'cutover'" },
      { status: 400 }
    )
  }

  const nowIso = new Date().toISOString()
  let update: Record<string, unknown>
  if (action === 'enroll') {
    update = { shadow_enabled: true, updated_at: nowIso }
  } else if (action === 'unenroll') {
    update = { shadow_enabled: false, updated_at: nowIso }
  } else {
    // cutover: atomic single UPDATE
    update = { live_source: 'padelgod', shadow_enabled: false, updated_at: nowIso }
  }

  const { data, error } = await supabase
    .from('tournaments')
    .update(update)
    .eq('id', tournamentId)
    .select('id, live_source, shadow_enabled')
    .single()

  if (error) {
    console.error('[Shadow Enroll] update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    live_source: data.live_source,
    shadow_enabled: data.shadow_enabled,
  })
}
