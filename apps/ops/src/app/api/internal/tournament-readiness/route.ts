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
  computeReadiness, isPremierTier, IN_SCOPE_TIERS,
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
    matchIds: string[]
  }
  const agg = new Map<string, Agg>()
  const blank = (): Agg => ({ matchCount: 0, liveOrScheduledCount: 0, finishedCount: 0, finishedWithWinner: 0, playerSlotsTotal: 0, playerSlotsResolved: 0, oopPopulated: 0, finalPlayed: false, matchIds: [] })
  const ACTIVE = new Set(['live', 'scheduled', 'ended', 'finished'])
  for (const m of matchRows) {
    if (!m.tournament_id) continue
    const a = agg.get(m.tournament_id) ?? blank()
    a.matchCount += 1
    a.matchIds.push(m.id)
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

  // 3) match_stats presence per tournament (Premier only — bounded set).
  const premierMatchIds = tournaments
    .filter(t => isPremierTier(t.level))
    .flatMap(t => agg.get(t.id)?.matchIds ?? [])
  const statsTournamentIds = new Set<string>()
  if (premierMatchIds.length > 0) {
    const statsRows = await paginatedSelect<{ match_id: string }>(
      (start, end) => supabase.from('match_stats').select('match_id').in('match_id', premierMatchIds).range(start, end),
      { what: 'readiness match_stats' },
    )
    const matchToTournament = new Map<string, string>()
    for (const t of tournaments) for (const mid of agg.get(t.id)?.matchIds ?? []) matchToTournament.set(mid, t.id)
    for (const s of statsRows) {
      const tid = matchToTournament.get(s.match_id)
      if (tid) statsTournamentIds.add(tid)
    }
  }

  // 4) entry/draw presence + snapshot freshness + streams presence.
  const [drawsRes, streamsRes, entrySnapRes, drawSnapRes, oopSnapRes, resultsSnapRes] = await Promise.all([
    supabase.from('tournament_draws').select('tournament_id').in('tournament_id', ids),
    supabase.from('fip_court_streams').select('tournament_id').in('tournament_id', ids),
    supabase.schema('padelgod').from('entry_list_snapshots').select('tournament_id, captured_at').in('tournament_id', ids).order('captured_at', { ascending: false }),
    supabase.schema('padelgod').from('draw_snapshots').select('tournament_id, captured_at').in('tournament_id', ids).order('captured_at', { ascending: false }),
    supabase.schema('padelgod').from('oop_snapshots').select('tournament_id, captured_at').in('tournament_id', ids).order('captured_at', { ascending: false }),
    supabase.schema('padelgod').from('results_snapshots').select('tournament_id, captured_at').in('tournament_id', ids).order('captured_at', { ascending: false }),
  ])

  const setOf = (rows: Array<{ tournament_id: string }> | null) => new Set((rows ?? []).map(r => r.tournament_id))
  const latest = (rows: Array<{ tournament_id: string; captured_at: string }> | null) => {
    const m = new Map<string, string>()
    for (const r of rows ?? []) if (!m.has(r.tournament_id)) m.set(r.tournament_id, r.captured_at)
    return m
  }
  const hasDraws = setOf(drawsRes.data as Array<{ tournament_id: string }> | null)
  const hasStreams = setOf(streamsRes.data as Array<{ tournament_id: string }> | null)
  const entrySnap = latest(entrySnapRes.data as Array<{ tournament_id: string; captured_at: string }> | null)
  const drawSnap = latest(drawSnapRes.data as Array<{ tournament_id: string; captured_at: string }> | null)
  const oopSnap = latest(oopSnapRes.data as Array<{ tournament_id: string; captured_at: string }> | null)
  const resultsSnap = latest(resultsSnapRes.data as Array<{ tournament_id: string; captured_at: string }> | null)

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
      hasMatchStats: statsTournamentIds.has(t.id),
      entryListResolved: hasDraws.has(t.id) || entrySnap.has(t.id),
      hasStreams: hasStreams.has(t.id),
      drawSnapshotAt: drawSnap.get(t.id) ?? null,
      oopSnapshotAt: oopSnap.get(t.id) ?? null,
      resultsSnapshotAt: resultsSnap.get(t.id) ?? null,
    }
    const result = computeReadiness(rollup, today)
    return { id: t.id, name: t.name ?? '(unnamed)', level: t.level, startsAt: t.starts_at, endsAt: t.ends_at, matchCount: a.matchCount, ...result }
  })

  return NextResponse.json({ rows })
}
