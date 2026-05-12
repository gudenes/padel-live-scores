// src/app/api/ops/highlight-picker/route.ts
//
// Returns upcoming matches (next 72h) scored by matchQualityScore,
// sorted by score desc. Backs the ops Highlight Picker tab.

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
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
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'server_misconfigured' }, { status: 401 })
  }
  const cookie = (await cookies()).get('ops_token')?.value
  if (cookie !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'token_mismatch' }, { status: 401 })
  }

  // Query params: window=24|48|72 (hours, default 24), tier=p1,p2,... (comma list), category=men|women|all
  const url = new URL(req.url)
  const windowHours = Number.parseInt(url.searchParams.get('window') ?? '24', 10)
  const tierFilterRaw = url.searchParams.get('tier')
  const tierFilter = tierFilterRaw ? tierFilterRaw.split(',').map(s => s.trim().toLowerCase()) : null
  const categoryFilter = url.searchParams.get('category')
  const minScore = Number.parseInt(url.searchParams.get('minScore') ?? '0', 10)

  const supabase = createServerClient()

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

  const rows: RowOut[] = []
  for (const m of data ?? []) {
    const t = m.tournament as { id: string; name: string; level: string | null; country: string | null } | null
    if (!t) continue
    if (tierFilter && (!t.level || !tierFilter.includes(t.level.toLowerCase()))) continue

    const breakdown = matchQualityBreakdown({
      pair1Rankings: [
        (m.pair1_player1 as { ranking: number | null } | null)?.ranking ?? null,
        (m.pair1_player2 as { ranking: number | null } | null)?.ranking ?? null,
      ],
      pair2Rankings: [
        (m.pair2_player1 as { ranking: number | null } | null)?.ranking ?? null,
        (m.pair2_player2 as { ranking: number | null } | null)?.ranking ?? null,
      ],
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
      pair1: [
        m.pair1_player1 as { name: string | null; ranking: number | null } ?? { name: null, ranking: null },
        m.pair1_player2 as { name: string | null; ranking: number | null } ?? { name: null, ranking: null },
      ],
      pair2: [
        m.pair2_player1 as { name: string | null; ranking: number | null } ?? { name: null, ranking: null },
        m.pair2_player2 as { name: string | null; ranking: number | null } ?? { name: null, ranking: null },
      ],
    })
  }

  rows.sort((a, b) => b.score - a.score)
  return NextResponse.json({ items: rows, generatedAt: new Date().toISOString() })
}
