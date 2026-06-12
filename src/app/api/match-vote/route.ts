// src/app/api/match-vote/route.ts
// One-tap "who will win" fan vote. Per-match pair tally, revealed only after
// the voter has cast a vote on THIS match. Voting locks once the match leaves
// 'scheduled'. All access via service-role (RLS-locked table).
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import type { SupabaseClient } from '@supabase/supabase-js'

// A small model-derived prior so a brand-new poll never reads 100/0 with a
// single vote (or "no one voted"). The raw counts stay honest in match_votes —
// only the SURFACED split is seeded with PRIOR_VOTES virtual votes distributed
// by the model's win probability. The fixed prior's weight naturally fades as
// real votes accumulate.
const PRIOR_VOTES = 12

async function matchTally(supabase: SupabaseClient, matchId: string): Promise<{ pair1: number; pair2: number; total: number; real: number }> {
  const [p1, p2, m] = await Promise.all([
    supabase.from('match_votes').select('*', { count: 'exact', head: true }).eq('match_id', matchId).eq('pair', 1),
    supabase.from('match_votes').select('*', { count: 'exact', head: true }).eq('match_id', matchId).eq('pair', 2),
    supabase.from('matches').select('pred_pair1_prob').eq('id', matchId).maybeSingle(),
  ])
  const realP1 = p1.count ?? 0
  const realP2 = p2.count ?? 0
  // Clamp the prior probability so even a lopsided model never seeds 100/0.
  const rawProb = m.data?.pred_pair1_prob != null ? Number(m.data.pred_pair1_prob) : 0.5
  const prob = Number.isNaN(rawProb) ? 0.5 : Math.min(0.9, Math.max(0.1, rawProb))
  const priorP1 = Math.round(PRIOR_VOTES * prob)
  const priorP2 = PRIOR_VOTES - priorP1
  const pair1 = realP1 + priorP1
  const pair2 = realP2 + priorP2
  // `real` is the genuine vote count (no prior) — used so a locked match that
  // nobody actually voted on doesn't surface a seeded community split.
  return { pair1, pair2, total: pair1 + pair2, real: realP1 + realP2 }
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
