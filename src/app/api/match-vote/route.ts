// src/app/api/match-vote/route.ts
// One-tap "who will win" fan vote. Per-match pair tally, revealed only after
// the voter has cast a vote on THIS match. Voting locks once the match leaves
// 'scheduled'. All access via service-role (RLS-locked table).
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import type { SupabaseClient } from '@supabase/supabase-js'

async function matchTally(supabase: SupabaseClient, matchId: string): Promise<{ pair1: number; pair2: number; total: number }> {
  const [p1, p2] = await Promise.all([
    supabase.from('match_votes').select('*', { count: 'exact', head: true }).eq('match_id', matchId).eq('pair', 1),
    supabase.from('match_votes').select('*', { count: 'exact', head: true }).eq('match_id', matchId).eq('pair', 2),
  ])
  const pair1 = p1.count ?? 0
  const pair2 = p2.count ?? 0
  return { pair1, pair2, total: pair1 + pair2 }
}

async function resolveVoterId(deviceId: string | null): Promise<string | null> {
  const session = await auth().catch(() => null)
  if (session?.user?.id) return session.user.id
  return deviceId || null
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const matchId = sp.get('matchId')
  const voterId = await resolveVoterId(sp.get('deviceId'))
  if (!matchId || !voterId) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }
  const supabase = createServerClient()
  const { data: mine } = await supabase
    .from('match_votes')
    .select('pair')
    .eq('match_id', matchId).eq('voter_id', voterId)
    .maybeSingle()
  const yourPick = (mine?.pair as 1 | 2 | undefined) ?? null
  // Reveal the community split once the user has voted OR the match has started
  // (post-match results are public; pre-match keeps reveal-after-vote).
  const { data: m } = await supabase.from('matches').select('status').eq('id', matchId).maybeSingle()
  const locked = !!m && m.status !== 'scheduled'
  const reveal = yourPick != null || locked
  return NextResponse.json({
    yourPick,
    aggregate: reveal ? await matchTally(supabase, matchId) : null,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const matchId: string | undefined = body?.matchId
  const pair = body?.pair
  if (!matchId || (pair !== 1 && pair !== 2)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const voterId = await resolveVoterId(body?.deviceId ?? null)
  if (!voterId) return NextResponse.json({ error: 'Must provide deviceId or auth' }, { status: 400 })

  const supabase = createServerClient()

  // Lock: only scheduled matches accept votes.
  const { data: m } = await supabase.from('matches').select('status').eq('id', matchId).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (m.status !== 'scheduled') {
    return NextResponse.json({ error: 'locked', locked: true }, { status: 409 })
  }

  const { error } = await supabase.from('match_votes').upsert(
    { match_id: matchId, pair, voter_id: voterId, updated_at: new Date().toISOString() },
    { onConflict: 'match_id,voter_id' },
  )
  if (error) {
    console.error('[match-vote] upsert error:', error)
    return NextResponse.json({ error: 'Failed to save vote' }, { status: 500 })
  }
  return NextResponse.json({ yourPick: pair, aggregate: await matchTally(supabase, matchId) })
}
