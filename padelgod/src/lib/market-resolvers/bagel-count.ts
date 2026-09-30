// tournament.bagel_count_at_least_v1 — "Will the {category} main draw at
// {tournament} have {line} or more 6-0 sets?"
//
// A LINE market, not a yes/no on "any bagel": measured 2025-01 → 2026-09, every
// Major draw and ~80% of P1 draws produced at least one 6-0, so "any bagel in
// this draw" is a foregone YES. The line is set per level × category in the
// template params so the market opens near 50/50 — see
// padelgod/src/lib/bagel-line.ts.
//
// COUNTING RULE
// - Main draw only: `round_canonical` present and not a Q-round. A row with no
//   canonical round is skipped rather than guessed into the main draw.
// - Every set that finished 6-0, either side, counts — two in one match are two.
// - Only matches that are OVER count. A 6-0 already on the board of a live
//   match is almost certainly final, but the reconciler can still rewrite the
//   scoreline and settlement would then pay on a phantom set.
// - A retired match counts the sets it did play; the sets it never played
//   simply are not in the count. Unlike the per-match bagel market this does
//   not void: the question is about the draw, and the draw still finishes.
//
// YES the moment the count reaches the line.
//
// NO once the draw's single final is over — NOT once every row is over. Measured
// on 2026 events: finished draws routinely keep rows stuck at 'scheduled'
// forever, of two kinds:
//   - empty slots (no player on either side — byes): ignored outright;
//   - real matches whose result the Crionet feed skipped (Paris Major women,
//     4 R32 rows). One of those may have been a 6-0, so NO would be a guess.
//     They get RESULTS_GRACE_MS after the final for the results writers to
//     catch up, and then the market VOIDS (refund) instead of settling NO.

import type { Resolver } from './types.js'
import { classifyStatus, isBagel, scorelineLooksComplete, toSetViews } from './match-sets.js'

const KEY = 'tournament.bagel_count_at_least_v1'

/** How long after the final a missing main-draw result is waited for. */
export const RESULTS_GRACE_MS = 48 * 3600_000

interface DrawRow {
  id: string
  status: string | null
  round_canonical: string | null
  scheduled_at: string | null
  pair1_player1_id: string | null
  pair2_player1_id: string | null
  sets: Record<string, unknown>[] | null
}

export function isMainDrawRound(round: string | null | undefined): boolean {
  return typeof round === 'string' && round.trim() !== '' && !/^Q/i.test(round.trim())
}

export const tournamentBagelCountAtLeast: Resolver = async (ctx, params) => {
  const line = Number(params.line)
  if (!Number.isInteger(line) || line < 1) {
    throw new Error(`${KEY}: params.line must be a positive integer`)
  }

  const { data, error } = await ctx.supabase
    .from('matches')
    .select('id, status, round_canonical, scheduled_at, pair1_player1_id, pair2_player1_id, sets(set_number, pair1_games, pair2_games, set_score)')
    .eq('tournament_id', ctx.tournamentId)
    .eq('category', ctx.category)

  if (error) throw new Error(`${KEY}: ${error.message}`)

  const draw = ((data ?? []) as DrawRow[]).filter((r) => isMainDrawRound(r.round_canonical))
  if (draw.length === 0) return { state: 'undecided' }

  let count = 0
  const bagels: { match_id: string; set: number }[] = []
  const unresolved: string[] = []
  let scorelinesPending = 0

  for (const row of draw) {
    const shape = classifyStatus(row.status)
    if (shape === 'in_progress') {
      // An empty slot is a bye, not a match that might still produce a 6-0.
      if (row.pair1_player1_id || row.pair2_player1_id) unresolved.push(row.id)
      continue
    }

    const sets = toSetViews(row.sets ?? [])
    for (const set of sets.filter(isBagel)) {
      count += 1
      bagels.push({ match_id: row.id, set: set.setNumber })
    }
    // A finished match with no full scoreline yet: results writers fill
    // `sets` after the match row closes. Retired/walkover rows are exempt —
    // their record is legitimately short.
    if (shape === 'completed' && !scorelineLooksComplete(sets)) scorelinesPending += 1
  }

  const evidence = { line, bagel_count: count, bagels, main_draw_rows: draw.length }

  if (count >= line) return { state: 'decided', outcome: true, evidence }

  const finals = draw.filter((r) => r.round_canonical?.trim().toUpperCase() === 'F')
  if (finals.length > 1) {
    return { state: 'void', reason: `${finals.length} main-draw rows labelled F — ambiguous draw` }
  }
  // Later rounds are inserted as the draw advances; no final row yet, or a
  // final not yet over, means the draw is still being played.
  const final = finals[0]
  if (!final || classifyStatus(final.status) === 'in_progress') return { state: 'undecided' }

  if (unresolved.length > 0) {
    const finalAt = final.scheduled_at ? new Date(final.scheduled_at).getTime() : NaN
    if (!Number.isFinite(finalAt) || ctx.now.getTime() < finalAt + RESULTS_GRACE_MS) {
      return { state: 'undecided' }
    }
    return {
      state: 'void',
      reason: `${unresolved.length} main-draw result(s) never landed — a missing match could hold a 6-0, so NO cannot be asserted`,
    }
  }
  if (scorelinesPending > 0) return { state: 'undecided' }

  return { state: 'decided', outcome: false, evidence }
}
