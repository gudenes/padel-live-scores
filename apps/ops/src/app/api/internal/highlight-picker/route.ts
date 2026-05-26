// apps/ops/src/app/api/internal/highlight-picker/route.ts
//
// Returns upcoming matches (next 72h) scored by matchQualityScore,
// sorted by score desc. Backs the ops Highlight Picker tab.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { matchQualityBreakdown } from '@/lib/match-quality'

export const dynamic = 'force-dynamic'

interface RowOut {
  matchId: string
  score: number
  breakdown: ReturnType<typeof matchQualityBreakdown>
  round: string | null
  category: string | null
  scheduledAt: string | null
  court: string | null
  tournament: { id: string; name: string; level: string | null; country: string | null }
  pair1: { name: string | null; ranking: number | null }[]
  pair2: { name: string | null; ranking: number | null }[]
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Query params: window=24|48|72 (hours, default 24), tier=p1,p2,... (comma list), category=men|women|all
  const url = new URL(req.url)
  const windowHours = Number.parseInt(url.searchParams.get('window') ?? '24', 10)
  const tierFilterRaw = url.searchParams.get('tier')
  const tierFilter = tierFilterRaw ? tierFilterRaw.split(',').map(s => s.trim().toLowerCase()) : null
  const categoryFilter = url.searchParams.get('category')
  const minScore = Number.parseInt(url.searchParams.get('minScore') ?? '0', 10)

  const supabase = serviceClient()

  const nowIso = new Date().toISOString()
  const endIso = new Date(Date.now() + windowHours * 60 * 60 * 1000).toISOString()

  let q = supabase
    .from('matches')
    .select(`
      id, round, category, status, scheduled_at, court,
      tournament:tournaments(id, name, level, country),
      pair1_player1:players!matches_pair1_player1_id_fkey(name, ranking),
      pair1_player2:players!matches_pair1_player2_id_fkey(name, ranking),
      pair2_player1:players!matches_pair2_player1_id_fkey(name, ranking),
      pair2_player2:players!matches_pair2_player2_id_fkey(name, ranking)
    `)
    .in('status', ['scheduled', 'upcoming'])
    .gte('scheduled_at', nowIso)
    .lt('scheduled_at', endIso)

  if (categoryFilter && categoryFilter !== 'all') {
    q = q.eq('category', categoryFilter)
  }

  const { data, error } = await q.order('scheduled_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Supabase typegen widens single-FK joins to arrays (`{ ... }[]`) even
  // though the actual return is one object — defeat through `unknown`.
  type TournamentRel = { id: string; name: string; level: string | null; country: string | null } | null
  type PlayerRel = { name: string | null; ranking: number | null } | null
  const EMPTY_PLAYER = { name: null, ranking: null }

  const rows: RowOut[] = []
  for (const m of data ?? []) {
    const t = m.tournament as unknown as TournamentRel
    if (!t) continue
    if (tierFilter && (!t.level || !tierFilter.includes(t.level.toLowerCase()))) continue

    const p1a = m.pair1_player1 as unknown as PlayerRel
    const p1b = m.pair1_player2 as unknown as PlayerRel
    const p2a = m.pair2_player1 as unknown as PlayerRel
    const p2b = m.pair2_player2 as unknown as PlayerRel

    const breakdown = matchQualityBreakdown({
      pair1Rankings: [p1a?.ranking ?? null, p1b?.ranking ?? null],
      pair2Rankings: [p2a?.ranking ?? null, p2b?.ranking ?? null],
      tournamentLevel: t.level,
      round: m.round,
    })
    if (breakdown.score < minScore) continue

    rows.push({
      matchId: m.id,
      score: breakdown.score,
      breakdown,
      round: m.round,
      category: m.category,
      scheduledAt: m.scheduled_at,
      court: m.court,
      tournament: t,
      pair1: [p1a ?? EMPTY_PLAYER, p1b ?? EMPTY_PLAYER],
      pair2: [p2a ?? EMPTY_PLAYER, p2b ?? EMPTY_PLAYER],
    })
  }

  rows.sort((a, b) => b.score - a.score)
  return NextResponse.json({ items: rows, generatedAt: new Date().toISOString() })
}
