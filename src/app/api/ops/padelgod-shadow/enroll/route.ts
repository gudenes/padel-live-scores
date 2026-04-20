// src/app/api/ops/padelgod-shadow/enroll/route.ts
// POST endpoint to enroll / unenroll / cutover a tournament for Padelgod Shadow Mode.
// Body: { tournament_id: string, action: 'enroll' | 'unenroll' | 'cutover' }

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

type Action = 'enroll' | 'unenroll' | 'cutover'

export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  let body: { tournament_id?: string; action?: Action }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const tournamentId = body.tournament_id
  const action = body.action

  if (!tournamentId || typeof tournamentId !== 'string') {
    return Response.json({ error: 'tournament_id required' }, { status: 400 })
  }
  if (action !== 'enroll' && action !== 'unenroll' && action !== 'cutover') {
    return Response.json(
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
    return Response.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return Response.json({ error: 'Tournament not found' }, { status: 404 })
  }

  return Response.json({
    ok: true,
    live_source: data.live_source,
    shadow_enabled: data.shadow_enabled,
  })
}
