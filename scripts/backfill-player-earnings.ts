/**
 * Backfill player_tournament_earnings by running the src/lib/earnings/
 * computation engine over every finished match since 2024-01-01.
 *
 * Scope: matches with finished_at >= 2024-01-01.
 *
 * Per tournament (after dedup):
 *   1. Load all finished matches for that tournament
 *   2. Run computeEarningsForTournament(tournament, matches)
 *   3. Upsert the resulting rows into player_tournament_earnings
 *
 * Idempotent: ON CONFLICT (player_id, tournament_id, category) → DO UPDATE.
 *
 * Out of scope (per spec):
 *   - fip_beyond, fip_promises, fip_other (engine returns [] for these)
 *   - upcoming events
 *
 * Usage:
 *   npx tsx scripts/backfill-player-earnings.ts            # dry run (default)
 *   npx tsx scripts/backfill-player-earnings.ts --apply    # write
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { paginatedSelect } from '../src/lib/db-paginate'
import { dedupeTournaments, type DedupRow } from '../src/lib/earnings/dedupe-tournaments'
import { computeEarningsForTournament } from '../src/lib/earnings/compute-earnings'
import type { EarningRow, MatchInput, TournamentInput } from '../src/lib/earnings/types'

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
    }
  } catch { /* fine */ }
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
)

const APPLY = process.argv.includes('--apply')

// Tournament shape we read — includes the dedup fields plus everything the
// engine needs to compute earnings.
type TournamentRow = DedupRow & {
  level: string
}

type MatchRow = {
  id: string
  tournament_id: string
  category: string  // 'men' | 'women' | other (filtered)
  round_canonical: string | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
  winner_pair: number | null
  finished_at: string | null
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`)

  // 1. Load all candidate tournaments since 2024.
  const tournamentsRaw = await paginatedSelect<TournamentRow>(
    (start, end) =>
      supabase
        .from('tournaments')
        .select('id, name, starts_at, level, prize_money_eur, prize_breakdown, fip_id, padelapi_id')
        .gte('ends_at', '2024-01-01')
        .lt('ends_at', new Date().toISOString())
        .order('starts_at', { ascending: false })
        .range(start, end),
    { what: 'tournaments since 2024', maxRows: 5_000 },
  )
  console.log(`Loaded tournaments since 2024: ${tournamentsRaw.length}`)

  // 2. Dedupe Pattern-B multi-pipeline duplicates.
  const tournaments = dedupeTournaments(tournamentsRaw)
  const dropped = tournamentsRaw.length - tournaments.length
  console.log(`After dedup: ${tournaments.length} (dropped ${dropped} duplicate rows)`)

  if (tournaments.length === 0) {
    console.log('Nothing to backfill.')
    return
  }

  const tournamentIds = tournaments.map(t => t.id)

  // 3. Load all finished matches across the surviving tournaments.
  const matchesRaw = await paginatedSelect<MatchRow>(
    (start, end) =>
      supabase
        .from('matches')
        .select(
          'id, tournament_id, category, round_canonical, ' +
          'pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
          'winner_pair, finished_at'
        )
        .in('tournament_id', tournamentIds)
        .not('finished_at', 'is', null)
        .gte('finished_at', '2024-01-01')
        .range(start, end),
    { what: 'finished matches since 2024', maxRows: 200_000 },
  )
  console.log(`Loaded finished matches: ${matchesRaw.length}`)

  // 4. Group matches by tournament_id for fast per-tournament lookup.
  const matchesByTournament = new Map<string, MatchInput[]>()
  let dropMatchCount = 0
  for (const m of matchesRaw) {
    if (m.category !== 'men' && m.category !== 'women') {
      dropMatchCount++
      continue
    }
    const cast: MatchInput = {
      id: m.id,
      category: m.category,
      round_canonical: m.round_canonical as MatchInput['round_canonical'],
      pair1_player1_id: m.pair1_player1_id,
      pair1_player2_id: m.pair1_player2_id,
      pair2_player1_id: m.pair2_player1_id,
      pair2_player2_id: m.pair2_player2_id,
      winner_pair: m.winner_pair === 1 || m.winner_pair === 2 ? m.winner_pair : null,
      finished_at: m.finished_at,
    }
    const list = matchesByTournament.get(m.tournament_id) ?? []
    list.push(cast)
    matchesByTournament.set(m.tournament_id, list)
  }
  if (dropMatchCount > 0) {
    console.log(`Skipped ${dropMatchCount} matches with non-{men,women} category`)
  }

  // 5. Per surviving tournament, compute earning rows.
  const allEarnings: EarningRow[] = []
  const skippedTiers: Record<string, number> = {}
  let tournamentsWithEarnings = 0

  for (const t of tournaments) {
    const tournamentInput: TournamentInput = {
      id: t.id,
      level: t.level,
      prize_money_eur: t.prize_money_eur,
      prize_breakdown: t.prize_breakdown as TournamentInput['prize_breakdown'],
    }
    const matches = matchesByTournament.get(t.id) ?? []
    const earnings = computeEarningsForTournament(tournamentInput, matches)
    if (earnings.length > 0) {
      tournamentsWithEarnings++
      allEarnings.push(...earnings)
    } else {
      const lvl = t.level ?? 'unknown'
      skippedTiers[lvl] = (skippedTiers[lvl] ?? 0) + 1
    }
  }

  // 6. Report.
  const bySource: Record<string, number> = {}
  let totalEur = 0
  for (const r of allEarnings) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1
    totalEur += r.per_player_eur
  }

  console.log(`\nEarning rows computed: ${allEarnings.length}`)
  console.log(`  by source: ${JSON.stringify(bySource)}`)
  console.log(`Tournaments producing earnings: ${tournamentsWithEarnings} of ${tournaments.length}`)
  console.log(`Total EUR across all rows (sanity): €${totalEur.toLocaleString()}`)
  if (Object.keys(skippedTiers).length > 0) {
    console.log(`\nSkipped tournaments by tier (engine returned 0 rows):`)
    for (const [lvl, n] of Object.entries(skippedTiers).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(4)}  ${lvl}`)
    }
  }

  if (!APPLY) {
    console.log('\nDRY RUN. Re-run with --apply to write.')
    return
  }

  // 7. Upsert in chunks.
  const CHUNK = 500
  let written = 0
  for (let i = 0; i < allEarnings.length; i += CHUNK) {
    const chunk = allEarnings.slice(i, i + CHUNK).map(r => ({
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
      .upsert(chunk, { onConflict: 'player_id,tournament_id,category' })
    if (error) {
      console.error(`  WRITE FAIL chunk ${i}: ${error.message}`)
      continue
    }
    written += chunk.length
    console.log(`  wrote ${Math.min(i + CHUNK, allEarnings.length)} / ${allEarnings.length}`)
  }
  console.log(`\nWrote ${written} rows.`)
}

main().catch(e => { console.error(e); process.exit(1) })
