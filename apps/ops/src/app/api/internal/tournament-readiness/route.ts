// apps/ops/src/app/api/internal/tournament-readiness/route.ts
//
// Backing API for the Data Readiness view. For every in-scope 2026
// main-tier tournament it assembles a per-tournament rollup from set-based
// queries, then runs the pure readiness engine. Auth: isOperator.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { paginatedSelect } from '@/lib/db-paginate'
import {
  computeReadiness, IN_SCOPE_TIERS,
  type TournamentRollup, type ReadinessResult,
} from '@/lib/readiness'

export const dynamic = 'force-dynamic'

const FROM = '2026-01-01'
const TO = '2026-12-31'

export interface ReadinessRow extends ReadinessResult {
  id: string
  name: string
  level: string | null
  startsAt: string | null
  endsAt: string | null
  matchCount: number
}

function isFinalRound(round: string | null): boolean {
  if (!round) return false
  const r = (round.trim().split(/\s+/).pop() ?? '').toLowerCase()
  return r === 'f' || r === 'final' || r === 'finals'
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const today = new Date().toISOString().slice(0, 10)

  // 1) In-scope tournaments: 2026 window × main tiers.
  const { data: tData, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, level, source, status, starts_at, ends_at, registration_status, entry_list_status')
    .in('level', IN_SCOPE_TIERS as unknown as string[])
    .or(`and(starts_at.gte.${FROM},starts_at.lte.${TO}),and(ends_at.gte.${FROM},ends_at.lte.${TO})`)
    .order('starts_at', { ascending: true, nullsFirst: false })
    .limit(1000)
  if (tErr) return NextResponse.json({ error: `tournaments: ${tErr.message}` }, { status: 500 })

  const tournaments = (tData ?? []) as Array<{
    id: string; name: string | null; level: string | null; source: string | null
    status: string | null; starts_at: string | null; ends_at: string | null
    registration_status: string | null; entry_list_status: string | null
  }>
  const ids = tournaments.map(t => t.id)
  if (ids.length === 0) return NextResponse.json({ rows: [] as ReadinessRow[] })

  // 2) Matches rollup (paginated — can approach the 10k cap).
  const matchRows = await paginatedSelect<{
    id: string; tournament_id: string | null; status: string | null; round: string | null
    winner_pair: number | null; court: string | null; scheduled_at: string | null
    pair1_player1_id: string | null; pair1_player2_id: string | null
    pair2_player1_id: string | null; pair2_player2_id: string | null
  }>(
    (start, end) => supabase
      .from('matches')
      .select('id, tournament_id, status, round, winner_pair, court, scheduled_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
      .in('tournament_id', ids)
      .range(start, end),
    { what: 'readiness matches rollup' },
  )

  interface Agg {
    matchCount: number; liveOrScheduledCount: number; finishedCount: number; finishedWithWinner: number
    playerSlotsTotal: number; playerSlotsResolved: number; oopPopulated: number; finalPlayed: boolean
  }
  const agg = new Map<string, Agg>()
  const blank = (): Agg => ({ matchCount: 0, liveOrScheduledCount: 0, finishedCount: 0, finishedWithWinner: 0, playerSlotsTotal: 0, playerSlotsResolved: 0, oopPopulated: 0, finalPlayed: false })
  const ACTIVE = new Set(['live', 'scheduled', 'ended', 'finished'])
  for (const m of matchRows) {
    if (!m.tournament_id) continue
    const a = agg.get(m.tournament_id) ?? blank()
    a.matchCount += 1
    if (m.status && ACTIVE.has(m.status)) a.liveOrScheduledCount += 1
    if (m.status === 'finished' || m.status === 'retired' || m.status === 'walkover') {
      a.finishedCount += 1
      if (m.winner_pair !== null) a.finishedWithWinner += 1
    }
    if (isFinalRound(m.round) && m.winner_pair !== null) a.finalPlayed = true
    const slots = [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id]
    a.playerSlotsTotal += 4
    a.playerSlotsResolved += slots.filter(Boolean).length
    if (m.court || m.scheduled_at) a.oopPopulated += 1
    agg.set(m.tournament_id, a)
  }

  // 3) Presence flags per tournament via the readiness_presence RPC —
  //    indexed EXISTS over the snapshot / draw / stream / match_stats tables.
  //    One query, one row per tournament, immune to PostgREST's 10k-row cap.
  //    (Fetching rows app-side to de-dupe dropped snapshot-heavy tournaments
  //    like FIP Bronze Ijuí — ~10k snapshot rows — defeating divergence
  //    detection, which is the whole point of this view.)
  interface Presence {
    tournament_id: string
    has_draw_snap: boolean; has_oop_snap: boolean; has_results_snap: boolean; has_entry_snap: boolean
    has_draws: boolean; has_streams: boolean; has_stats: boolean
  }
  const { data: presData, error: presErr } = await supabase.rpc('readiness_presence', { ids })
  if (presErr) return NextResponse.json({ error: `presence: ${presErr.message}` }, { status: 500 })
  const presence = new Map<string, Presence>()
  for (const p of (presData ?? []) as Presence[]) presence.set(p.tournament_id, p)

  // 5) Build rollups and run the engine.
  const rows: ReadinessRow[] = tournaments.map(t => {
    const a = agg.get(t.id) ?? blank()
    const rollup: TournamentRollup = {
      id: t.id,
      level: t.level,
      startsAt: t.starts_at,
      endsAt: t.ends_at,
      registrationStatus: t.registration_status,
      finalPlayed: a.finalPlayed,
      matchCount: a.matchCount,
      liveOrScheduledCount: a.liveOrScheduledCount,
      finishedCount: a.finishedCount,
      finishedWithWinner: a.finishedWithWinner,
      playerSlotsTotal: a.playerSlotsTotal,
      playerSlotsResolved: a.playerSlotsResolved,
      oopPopulated: a.oopPopulated,
      hasMatchStats: presence.get(t.id)?.has_stats ?? false,
      entryListResolved: !!(presence.get(t.id)?.has_draws || presence.get(t.id)?.has_entry_snap),
      hasStreams: presence.get(t.id)?.has_streams ?? false,
      drawSnapshotAt: presence.get(t.id)?.has_draw_snap ? 'present' : null,
      oopSnapshotAt: presence.get(t.id)?.has_oop_snap ? 'present' : null,
      resultsSnapshotAt: presence.get(t.id)?.has_results_snap ? 'present' : null,
    }
    const result = computeReadiness(rollup, today)
    return { id: t.id, name: t.name ?? '(unnamed)', level: t.level, startsAt: t.starts_at, endsAt: t.ends_at, matchCount: a.matchCount, ...result }
  })

  return NextResponse.json({ rows })
}
