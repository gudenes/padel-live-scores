// src/app/api/cron/recompute-earnings/route.ts
//
// Recomputes player_tournament_earnings rows for tournaments that have
// ended within the last 30 days. Mirrors scripts/backfill-player-earnings.ts
// but scoped to a recent window so a weekly cron stays cheap.
//
// Schedule: Monday 06:00 UTC (Sunday tournaments finish, Monday morning we
// recompute the previous week). 30-day window catches:
//   - Late prize_breakdown scrapes from fip-event-page-enricher
//   - Mid-week tournament finishes (rare but occur)
//   - Any rulebook constant tweaks landed in the past month
//
// Idempotent — uses ON CONFLICT (player_id, tournament_id, category) DO UPDATE,
// so a re-run only changes values that actually drift.
//
// To rebuild from scratch (e.g. after a rulebook change), run:
//   npx tsx scripts/backfill-player-earnings.ts --apply
// instead — it scans every tournament since 2024-01-01.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import { dedupeTournaments, type DedupRow } from '@/lib/earnings/dedupe-tournaments'
import { computeEarningsForTournament } from '@/lib/earnings/compute-earnings'
import type { EarningRow, MatchInput, TournamentInput } from '@/lib/earnings/types'

// 30-day window is plenty for the weekly cadence + late-arriving prize data.
// Operator can re-run the full backfill script for cross-year recomputes.
const LOOKBACK_DAYS = 30

// Vercel function timeout. Recent-window run typically processes ~50–150
// tournaments + a few thousand matches; well under 60s on warm cache.
export const maxDuration = 120

type TournamentRow = DedupRow & {
  level: string
  ends_at: string | null
}

type MatchRow = {
  id: string
  tournament_id: string
  category: string
  round_canonical: string | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
  winner_pair: number | null
  finished_at: string | null
}

export async function GET(req: NextRequest) {
  // Auth: same Bearer pattern other Vercel crons use.
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const meta = await logOpsEvent('cron:recompute-earnings', async () => {
      const supabase = createServerClient()

      const cutoffIso = new Date(
        Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString()
      const nowIso = new Date().toISOString()

      // 1. Tournaments that ended in the last 30 days. Must include `id` and
      //    everything dedupeTournaments + computeEarningsForTournament read.
      const { data: tournamentsRaw, error: tErr } = await supabase
        .from('tournaments')
        .select(
          'id, name, starts_at, ends_at, level, prize_money_eur, prize_breakdown, fip_id, padelapi_id',
        )
        .gte('ends_at', cutoffIso)
        .lt('ends_at', nowIso)
        .order('ends_at', { ascending: false })
      if (tErr) throw new Error(`tournaments fetch: ${tErr.message}`)

      const tournaments = dedupeTournaments(
        (tournamentsRaw ?? []) as TournamentRow[],
      )
      const droppedDupes = (tournamentsRaw?.length ?? 0) - tournaments.length

      if (tournaments.length === 0) {
        return {
          windowDays: LOOKBACK_DAYS,
          tournamentsConsidered: 0,
          tournamentsWithEarnings: 0,
          earningsRowsWritten: 0,
          earningsRowsByTier: {},
          totalEur: 0,
          droppedDupes,
        }
      }

      const tournamentIds = tournaments.map((t) => t.id)

      // 2. Finished matches across those tournaments. Don't bound by
      //    finished_at on the window edge — a match that finished BEFORE the
      //    30-day window in a tournament whose ends_at fell INTO the window
      //    (final on Sunday but earlier rounds on Friday/Saturday) still
      //    needs to be in the recompute. Tournament-level filter is enough.
      const { data: matchesRaw, error: mErr } = await supabase
        .from('matches')
        .select(
          'id, tournament_id, category, round_canonical, ' +
            'pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
            'winner_pair, finished_at',
        )
        .in('tournament_id', tournamentIds)
        .not('finished_at', 'is', null)
      if (mErr) throw new Error(`matches fetch: ${mErr.message}`)

      // 3. Group matches by tournament_id, casting category to the
      //    'men'|'women' shape the engine expects.
      const matchesByTournament = new Map<string, MatchInput[]>()
      for (const m of (matchesRaw ?? []) as unknown as MatchRow[]) {
        if (m.category !== 'men' && m.category !== 'women') continue
        const cast: MatchInput = {
          id: m.id,
          category: m.category,
          round_canonical: m.round_canonical as MatchInput['round_canonical'],
          pair1_player1_id: m.pair1_player1_id,
          pair1_player2_id: m.pair1_player2_id,
          pair2_player1_id: m.pair2_player1_id,
          pair2_player2_id: m.pair2_player2_id,
          winner_pair:
            m.winner_pair === 1 || m.winner_pair === 2 ? m.winner_pair : null,
          finished_at: m.finished_at,
        }
        const list = matchesByTournament.get(m.tournament_id) ?? []
        list.push(cast)
        matchesByTournament.set(m.tournament_id, list)
      }

      // 4. Per tournament, compute earnings.
      const allEarnings: EarningRow[] = []
      let tournamentsWithEarnings = 0
      const earningsRowsByTier: Record<string, number> = {}
      for (const t of tournaments) {
        const tournamentInput: TournamentInput = {
          id: t.id,
          level: t.level,
          prize_money_eur: t.prize_money_eur,
          prize_breakdown:
            t.prize_breakdown as TournamentInput['prize_breakdown'],
          ends_at: t.ends_at,
        }
        const matches = matchesByTournament.get(t.id) ?? []
        const earnings = computeEarningsForTournament(tournamentInput, matches)
        if (earnings.length > 0) {
          tournamentsWithEarnings++
          earningsRowsByTier[t.level] =
            (earningsRowsByTier[t.level] ?? 0) + earnings.length
          allEarnings.push(...earnings)
        }
      }

      // 5. Upsert in chunks of 500 (PostgREST request size).
      const CHUNK = 500
      let written = 0
      let totalEur = 0
      for (let i = 0; i < allEarnings.length; i += CHUNK) {
        const chunk = allEarnings.slice(i, i + CHUNK).map((r) => ({
          player_id: r.player_id,
          tournament_id: r.tournament_id,
          category: r.category,
          round_eliminated: r.round_eliminated,
          per_player_eur: r.per_player_eur,
          source: r.source,
          earned_at: r.earned_at,
        }))
        const { error } = await supabase
          .from('player_tournament_earnings')
          .upsert(chunk, {
            onConflict: 'player_id,tournament_id,category',
          })
        if (error) {
          throw new Error(
            `upsert failed at chunk ${i}-${i + chunk.length}: ${error.message}`,
          )
        }
        written += chunk.length
        for (const r of chunk) totalEur += r.per_player_eur
      }

      return {
        windowDays: LOOKBACK_DAYS,
        tournamentsConsidered: tournaments.length,
        tournamentsWithEarnings,
        earningsRowsWritten: written,
        earningsRowsByTier,
        totalEur,
        droppedDupes,
      }
    })

    return NextResponse.json({ ok: true, ...meta })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
