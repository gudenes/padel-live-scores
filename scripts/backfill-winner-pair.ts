/**
 * One-shot backfill for `games.winner_pair` on completed games.
 *
 * Why: padelgod's canonical applyDiff didn't write `games.winner_pair`
 * until the 4bc076d fix landed, so every game in every live tournament
 * has it NULL. The momentum chart's BROKE badge depends on this column
 * — without it, break-of-serve detection is silently dead even though
 * the data needed to derive it is sitting right in `games.points[]`.
 *
 * Strategy: per-game, parse the LAST captured point in `games.points[]`
 * and use whichever side was ahead at that moment as the winner. This
 * mirrors `inferWinnerFromPoints` in MomentumChart.tsx — chart and
 * backfill agree on the same heuristic. Sanity check: per-set, the
 * inferred winners must SUM to (pair1_games, pair2_games) before we
 * commit anything for that set. A mismatch means our inference is
 * inconsistent with reality (e.g. heavy point-capture gaps), and we
 * leave the set's winner_pairs NULL rather than write garbage.
 *
 * Scope: only games that are NOT currently in progress
 * (is_current=false), and only sets whose tally we can verify. Games
 * with NULL points or already-set winner_pair are skipped.
 *
 * Usage:
 *   npx tsx scripts/backfill-winner-pair.ts             # dry run
 *   npx tsx scripts/backfill-winner-pair.ts --apply     # actually write
 *   npx tsx scripts/backfill-winner-pair.ts --apply --status=live  # live only
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// ── CLI ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const STATUS_FLAG = args.find((a) => a.startsWith('--status='))
const STATUS_FILTER = STATUS_FLAG ? STATUS_FLAG.replace('--status=', '') : null

// ── Inference (mirrors MomentumChart.tsx::inferWinnerFromPoints) ─────
const STD: Record<string, number> = {
  '0': 0,
  '15': 1,
  '30': 2,
  '40': 3,
  A: 4,
  AD: 4,
}

function inferWinnerFromPoints(points: string[] | null): 1 | 2 | null {
  if (!points) return null
  const pts = points.filter((p) => p !== '0:0' && p !== '0-0')
  if (pts.length === 0) return null
  const last = pts[pts.length - 1]
  const sep = last.includes(':') ? ':' : '-'
  const parts = last.split(sep)
  if (parts.length !== 2) return null
  const [raw1, raw2] = parts
  const v1 = STD[raw1]
  const v2 = STD[raw2]
  if (v1 !== undefined && v2 !== undefined) {
    return v1 !== v2 ? (v1 > v2 ? 1 : 2) : null
  }
  // Tiebreak fallback
  const n1 = parseInt(raw1, 10)
  const n2 = parseInt(raw2, 10)
  if (!Number.isNaN(n1) && !Number.isNaN(n2) && n1 !== n2) {
    return n1 > n2 ? 1 : 2
  }
  return null
}

// ── Types ────────────────────────────────────────────────────────────
interface SetRow {
  id: string
  set_number: number
  pair1_games: number | null
  pair2_games: number | null
}

interface GameRow {
  id: string
  set_id: string
  game_number: number
  is_current: boolean
  winner_pair: number | null
  points: string[] | null
}

interface MatchSummary {
  matchId: string
  status: string
  setsConsidered: number
  setsCommitted: number
  setsSkippedTallyMismatch: number
  setsSkippedNoTally: number
  gamesUpdated: number
  gamesAlreadySet: number
  gamesUnresolvable: number
}

// ── Per-match worker ────────────────────────────────────────────────
async function processMatch(matchId: string, status: string): Promise<MatchSummary> {
  const summary: MatchSummary = {
    matchId,
    status,
    setsConsidered: 0,
    setsCommitted: 0,
    setsSkippedTallyMismatch: 0,
    setsSkippedNoTally: 0,
    gamesUpdated: 0,
    gamesAlreadySet: 0,
    gamesUnresolvable: 0,
  }

  const { data: sets, error: setsErr } = await supabase
    .from('sets')
    .select('id, set_number, pair1_games, pair2_games')
    .eq('match_id', matchId)
    .order('set_number')
  if (setsErr || !sets) {
    console.error(`  ${matchId.substring(0, 8)} sets read failed:`, setsErr?.message)
    return summary
  }

  for (const set of sets as SetRow[]) {
    summary.setsConsidered += 1

    const { data: games, error: gamesErr } = await supabase
      .from('games')
      .select('id, set_id, game_number, is_current, winner_pair, points')
      .eq('set_id', set.id)
      .order('game_number')
    if (gamesErr || !games) {
      console.error(`  set ${set.set_number} games read failed:`, gamesErr?.message)
      continue
    }

    if (set.pair1_games == null || set.pair2_games == null) {
      summary.setsSkippedNoTally += 1
      continue
    }

    // Per-set inference of winner_pair for completed games. A game is
    // "completed" iff its game_number falls within the set tally
    // (game_number ≤ pair1_games + pair2_games). Anything beyond that
    // is still in progress regardless of is_current — the chart-marker
    // remediation cleared is_current on stale rows so we can't rely on
    // that flag alone to mean "finished".
    const completedGameCount = (set.pair1_games ?? 0) + (set.pair2_games ?? 0)
    const inferredByGameId = new Map<string, 1 | 2>()
    for (const g of games as GameRow[]) {
      if (g.is_current) continue
      if (g.game_number > completedGameCount) continue // still in progress
      if (g.winner_pair === 1 || g.winner_pair === 2) {
        summary.gamesAlreadySet += 1
        continue
      }
      const w = inferWinnerFromPoints(g.points)
      if (!w) {
        summary.gamesUnresolvable += 1
        continue
      }
      inferredByGameId.set(g.id, w)
    }

    // Tally check: combine "already set" + "inferred this run" against
    // the set's pair1_games / pair2_games. If a set's tally has games
    // that we can't account for (some games' winner_pair is NULL and
    // unresolvable), we still commit the resolvable ones IFF the count
    // we DO have agrees with the tally for the games we're touching.
    //
    // Concretely: count inferred wins per side, count already-set wins
    // per side, sum them, and require the sum to be ≤ the set tally on
    // each side. We allow ≤ (not strictly =) so a set with one
    // unresolvable game can still backfill its other games — the
    // unresolved one stays NULL and the chart silently degrades there.
    const alreadyP1 = (games as GameRow[]).filter((g) => g.winner_pair === 1).length
    const alreadyP2 = (games as GameRow[]).filter((g) => g.winner_pair === 2).length
    let inferP1 = 0
    let inferP2 = 0
    for (const w of inferredByGameId.values()) {
      if (w === 1) inferP1 += 1
      else inferP2 += 1
    }
    const totalP1 = alreadyP1 + inferP1
    const totalP2 = alreadyP2 + inferP2
    if (totalP1 > set.pair1_games || totalP2 > set.pair2_games) {
      summary.setsSkippedTallyMismatch += 1
      console.log(
        `  ${matchId.substring(0, 8)} set ${set.set_number}: tally mismatch — ` +
          `p1 inferred=${totalP1}/${set.pair1_games}, p2 inferred=${totalP2}/${set.pair2_games}; skipping`,
      )
      continue
    }

    if (inferredByGameId.size === 0) continue

    // Commit per-set updates in two batches (one per winner value) using
    // `.in('id', […])`. Per-game UPDATEs were too slow at 30k-game scale.
    if (APPLY) {
      const p1Ids: string[] = []
      const p2Ids: string[] = []
      for (const [gameId, winner] of inferredByGameId) {
        if (winner === 1) p1Ids.push(gameId)
        else p2Ids.push(gameId)
      }
      if (p1Ids.length > 0) {
        const { error } = await supabase
          .from('games')
          .update({ winner_pair: 1 })
          .in('id', p1Ids)
        if (error) console.error(`    set ${set.set_number} pair1 batch update failed:`, error.message)
        else summary.gamesUpdated += p1Ids.length
      }
      if (p2Ids.length > 0) {
        const { error } = await supabase
          .from('games')
          .update({ winner_pair: 2 })
          .in('id', p2Ids)
        if (error) console.error(`    set ${set.set_number} pair2 batch update failed:`, error.message)
        else summary.gamesUpdated += p2Ids.length
      }
    } else {
      summary.gamesUpdated += inferredByGameId.size
    }
    summary.setsCommitted += 1
  }

  return summary
}

// ── Driver ──────────────────────────────────────────────────────────
async function main() {
  console.log('backfill-winner-pair: mode=' + (APPLY ? 'APPLY' : 'DRY-RUN'))
  console.log('status filter:', STATUS_FILTER ?? '(all)')

  let q = supabase.from('matches').select('id, status').not('status', 'eq', 'scheduled')
  if (STATUS_FILTER) q = q.eq('status', STATUS_FILTER)
  const { data: matches, error } = await q
  if (error || !matches) {
    console.error('matches read failed:', error?.message)
    return
  }

  console.log('matches considered:', matches.length)

  const totals = {
    setsCommitted: 0,
    setsSkippedTallyMismatch: 0,
    gamesUpdated: 0,
    gamesAlreadySet: 0,
    gamesUnresolvable: 0,
  }

  let processed = 0
  for (const m of matches as { id: string; status: string }[]) {
    const s = await processMatch(m.id, m.status)
    totals.setsCommitted += s.setsCommitted
    totals.setsSkippedTallyMismatch += s.setsSkippedTallyMismatch
    totals.gamesUpdated += s.gamesUpdated
    totals.gamesAlreadySet += s.gamesAlreadySet
    totals.gamesUnresolvable += s.gamesUnresolvable
    processed += 1
    if (s.gamesUpdated > 0 || s.setsSkippedTallyMismatch > 0) {
      console.log(
        `  ${m.id.substring(0, 8)} (${m.status}): updated=${s.gamesUpdated} ` +
          `unresolvable=${s.gamesUnresolvable} setsCommitted=${s.setsCommitted} ` +
          `setsSkipped=${s.setsSkippedTallyMismatch}`,
      )
    }
  }

  console.log('\n=== TOTALS ===')
  console.log('matches processed:', processed)
  console.log('sets committed:', totals.setsCommitted)
  console.log('sets skipped (tally mismatch):', totals.setsSkippedTallyMismatch)
  console.log('games updated:', totals.gamesUpdated, APPLY ? '' : '(dry run)')
  console.log('games already set:', totals.gamesAlreadySet)
  console.log('games unresolvable (no point data, or tied last point):', totals.gamesUnresolvable)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
