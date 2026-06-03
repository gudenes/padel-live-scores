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

  // 3) match_stats presence per tournament (Premier only). Query in chunks
  //    of match_ids — a single .in() over every Premier match overflows the
  //    PostgREST request URL (→ 400 Bad Request).
  const premierMatchIds = tournaments
    .filter(t => isPremierTier(t.level))
    .flatMap(t => agg.get(t.id)?.matchIds ?? [])
  const statsTournamentIds = new Set<string>()
  if (premierMatchIds.length > 0) {
    const matchToTournament = new Map<string, string>()
    for (const t of tournaments) for (const mid of agg.get(t.id)?.matchIds ?? []) matchToTournament.set(mid, t.id)
    const CHUNK = 200
    for (let i = 0; i < premierMatchIds.length; i += CHUNK) {
      const batch = premierMatchIds.slice(i, i + CHUNK)
      const { data, error } = await supabase.from('match_stats').select('match_id').in('match_id', batch)
      if (error) return NextResponse.json({ error: `match_stats: ${error.message}` }, { status: 500 })
      for (const s of (data ?? []) as Array<{ match_id: string }>) {
        const tid = matchToTournament.get(s.match_id)
        if (tid) statsTournamentIds.add(tid)
      }
    }
  }

  // 4) Presence flags. The engine treats every snapshot field as a presence
  //    boolean (it never compares timestamps), and the response exposes no
  //    snapshot times — so we select only tournament_id with NO ORDER BY.
  //    An ORDER BY captured_at over the append-only snapshot tables times
  //    out. We still chunk by small tournament-id batches so a single
  //    response can't hit the 10k row cap and silently drop tournaments.
  const CHUNK_T = 10
  const idBatches: string[][] = []
  for (let i = 0; i < ids.length; i += CHUNK_T) idBatches.push(ids.slice(i, i + CHUNK_T))

  type IdRow = { tournament_id: string }

  async function collectIds(
    run: (batch: string[]) => PromiseLike<{ data: IdRow[] | null; error: { message: string } | null }>,
    what: string,
  ): Promise<Set<string>> {
    const set = new Set<string>()
    for (const b of idBatches) {
      const { data, error } = await run(b)
      if (error) throw new Error(`${what}: ${error.message}`)
      for (const r of data ?? []) set.add(r.tournament_id)
    }
    return set
  }

  let hasDraws: Set<string>, hasStreams: Set<string>
  let entrySnapSet: Set<string>, drawSnapSet: Set<string>, oopSnapSet: Set<string>, resultsSnapSet: Set<string>
  try {
    [hasDraws, hasStreams, entrySnapSet, drawSnapSet, oopSnapSet, resultsSnapSet] = await Promise.all([
      collectIds(b => supabase.from('tournament_draws').select('tournament_id').in('tournament_id', b), 'tournament_draws'),
      collectIds(b => supabase.from('fip_court_streams').select('tournament_id').in('tournament_id', b), 'fip_court_streams'),
      collectIds(b => supabase.schema('padelgod').from('entry_list_snapshots').select('tournament_id').in('tournament_id', b), 'entry_list_snapshots'),
      collectIds(b => supabase.schema('padelgod').from('draw_snapshots').select('tournament_id').in('tournament_id', b), 'draw_snapshots'),
      collectIds(b => supabase.schema('padelgod').from('oop_snapshots').select('tournament_id').in('tournament_id', b), 'oop_snapshots'),
      collectIds(b => supabase.schema('padelgod').from('results_snapshots').select('tournament_id').in('tournament_id', b), 'results_snapshots'),
    ])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'snapshot read failed' }, { status: 500 })
  }

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
      entryListResolved: hasDraws.has(t.id) || entrySnapSet.has(t.id),
      hasStreams: hasStreams.has(t.id),
      drawSnapshotAt: drawSnapSet.has(t.id) ? 'present' : null,
      oopSnapshotAt: oopSnapSet.has(t.id) ? 'present' : null,
      resultsSnapshotAt: resultsSnapSet.has(t.id) ? 'present' : null,
    }
    const result = computeReadiness(rollup, today)
    return { id: t.id, name: t.name ?? '(unnamed)', level: t.level, startsAt: t.starts_at, endsAt: t.ends_at, matchCount: a.matchCount, ...result }
  })

  return NextResponse.json({ rows })
}
