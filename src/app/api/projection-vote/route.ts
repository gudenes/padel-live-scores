// src/app/api/projection-vote/route.ts
// Agree/disagree votes on a pair's projected finish. Stores pair context but
// surfaces a GLOBAL agree/disagree tally. Reveal-after-vote is enforced here:
// the global tally is only returned once the voter has cast any vote.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import type { SupabaseClient } from '@supabase/supabase-js'

type Vote = 'agree' | 'disagree'

async function globalTally(supabase: SupabaseClient): Promise<{ agree: number; disagree: number }> {
  const [a, d] = await Promise.all([
    supabase.from('projection_votes').select('*', { count: 'exact', head: true }).eq('vote', 'agree'),
    supabase.from('projection_votes').select('*', { count: 'exact', head: true }).eq('vote', 'disagree'),
  ])
  return { agree: a.count ?? 0, disagree: d.count ?? 0 }
}

async function resolveVoterId(bodyOrParamDeviceId: string | null): Promise<string | null> {
  const session = await auth().catch(() => null)
  if (session?.user?.id) return session.user.id
  return bodyOrParamDeviceId || null
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const tournamentId = sp.get('tournamentId')
  const category = sp.get('category')
  const pairKey = sp.get('pairKey')
  const voterId = await resolveVoterId(sp.get('deviceId'))
  if (!tournamentId || !category || !pairKey || !voterId) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }
  const supabase = createServerClient()

  const { data: mine } = await supabase
    .from('projection_votes')
    .select('vote')
    .eq('tournament_id', tournamentId).eq('category', category).eq('pair_key', pairKey).eq('voter_id', voterId)
    .maybeSingle()

  const { count: everCount } = await supabase
    .from('projection_votes').select('*', { count: 'exact', head: true }).eq('voter_id', voterId)
  const hasVotedEver = (everCount ?? 0) > 0

  return NextResponse.json({
    yourVote: (mine?.vote as Vote | undefined) ?? null,
    hasVotedEver,
    global: hasVotedEver ? await globalTally(supabase) : null,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const tournamentId: string | undefined = body?.tournamentId
  const category: string | undefined = body?.category
  const pairKey: string | undefined = body?.pairKey
  const vote: string | undefined = body?.vote
  if (!tournamentId || !category || (category !== 'men' && category !== 'women') || !pairKey || (vote !== 'agree' && vote !== 'disagree')) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const voterId = await resolveVoterId(body?.deviceId ?? null)
  if (!voterId) return NextResponse.json({ error: 'Must provide deviceId or auth' }, { status: 400 })

  const supabase = createServerClient()
  const { error } = await supabase.from('projection_votes').upsert(
    { tournament_id: tournamentId, category, pair_key: pairKey, voter_id: voterId, vote, updated_at: new Date().toISOString() },
    { onConflict: 'tournament_id,category,pair_key,voter_id' },
  )
  if (error) {
    console.error('[projection-vote] upsert error:', error)
    return NextResponse.json({ error: 'Failed to save vote' }, { status: 500 })
  }
  return NextResponse.json({ yourVote: vote, global: await globalTally(supabase) })
}
