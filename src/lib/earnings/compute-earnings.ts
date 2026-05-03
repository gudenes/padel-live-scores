/**
 * Orchestrate earnings computation for one tournament.
 *
 * Input:  tournament + the finished matches that belong to it
 * Output: one EarningRow per (player, category) — the player's terminal
 *         match drives the round and isWinner used for the lookup
 *
 * Source-priority chain per row:
 *   1. Premier tier         → premier-prize-table lookup       (source = 'premier_rulebook')
 *   2. FIP Tour with breakdown → tournament.prize_breakdown    (source = 'fip_breakdown_scraped')
 *   3. FIP Tour with total only → fip-tour-prize-table % × total (source = 'fip_tour_rulebook_pct')
 *   4. else → drop the row (no earnings persisted)
 */

import type {
  Category, EarningRow, FipTourTier, MatchInput, PremierTier, Tier, TournamentInput,
} from './types'
import { tierFromLevel } from './types'
import type { RoundCode } from '../round-canonical'
import { lookupPremierPrize } from './premier-prize-table'
import { computeFipTourPerPlayer } from './fip-tour-prize-table'

// Round depth — higher = later in the bracket. Used to find each player's
// terminal (deepest) match.
const ROUND_DEPTH: Record<RoundCode, number> = {
  F: 100, SF: 90, QF: 80, R16: 70, R32: 60, R64: 50,
  Q3: 30, Q2: 20, Q1: 10,
}

const PREMIER_TIERS = new Set<Tier>(['major_i', 'major_ii', 'p1', 'p2'])
const FIP_TIERS = new Set<Tier>(['fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum'])

function isPremier(t: Tier): t is PremierTier {
  return PREMIER_TIERS.has(t)
}
function isFipTour(t: Tier): t is FipTourTier {
  return FIP_TIERS.has(t)
}

// Lower-cased canonical round → key in scraped prize_breakdown JSONB
const BREAKDOWN_KEY: Record<RoundCode, string> = {
  F: 'winner', SF: 'sf', QF: 'qf', R16: 'r16', R32: 'r32', R64: 'r64',
  Q1: 'q1', Q2: 'q2', Q3: 'q3',
}

function lookupBreakdown(
  bd: Record<string, number | string> | null,
  round: RoundCode,
  isWinner: boolean,
): number | null {
  if (!bd) return null
  // Final has two keys: 'winner' and 'finalist'
  const key = round === 'F' ? (isWinner ? 'winner' : 'finalist') : BREAKDOWN_KEY[round]
  const raw = bd[key]
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  // Scraped FIP breakdowns sometimes carry fractional cents
  // (Bronze QF = €111.56). per_player_eur is INTEGER in the DB, so round here.
  return Math.round(n)
}

type PlayerTerminus = {
  player_id: string
  category: Category
  terminal_round: RoundCode
  is_winner: boolean
  earned_at: string  // from match.finished_at
}

/**
 * For each player who appears in any of the matches, find their terminal
 * (deepest) match and return whether they won or lost it.
 *
 * Players with NULL round_canonical matches are skipped entirely (group
 * stage / unmappable rounds — Phase 1 left these unset by design).
 *
 * Players whose ID columns are NULL across all their matches are skipped.
 */
export function findPlayerTermini(matches: MatchInput[]): PlayerTerminus[] {
  type Best = { round: RoundCode; depth: number; isWinner: boolean; earned_at: string; category: Category }
  const best = new Map<string, Best>()

  for (const m of matches) {
    if (m.round_canonical == null) continue
    if (m.winner_pair == null) continue
    const depth = ROUND_DEPTH[m.round_canonical]

    const slots: { id: string | null; pair: 1 | 2 }[] = [
      { id: m.pair1_player1_id, pair: 1 },
      { id: m.pair1_player2_id, pair: 1 },
      { id: m.pair2_player1_id, pair: 2 },
      { id: m.pair2_player2_id, pair: 2 },
    ]

    for (const { id, pair } of slots) {
      if (!id) continue
      const isWinner = pair === m.winner_pair
      const cur = best.get(id)
      // Pick the deepest match. Tie-break: the most recent finished_at.
      if (!cur ||
          depth > cur.depth ||
          (depth === cur.depth && (m.finished_at ?? '') > cur.earned_at)) {
        best.set(id, {
          round: m.round_canonical,
          depth,
          isWinner,
          earned_at: m.finished_at ?? '',
          category: m.category,
        })
      }
    }
  }

  return [...best.entries()].map(([player_id, b]) => ({
    player_id,
    category: b.category,
    terminal_round: b.round,
    is_winner: b.isWinner,
    earned_at: b.earned_at,
  }))
}

/**
 * Resolve a per-player EUR amount + provenance for one terminal record.
 * Returns null when none of the source-priority steps produces a value.
 */
function resolvePerPlayer(
  tier: Tier,
  category: Category,
  round: RoundCode,
  isWinner: boolean,
  tournament: TournamentInput,
): { per_player_eur: number; source: EarningRow['source'] } | null {
  // 1. Premier rulebook
  if (isPremier(tier)) {
    const v = lookupPremierPrize({ tier, category, round, isWinner })
    if (v != null) return { per_player_eur: v, source: 'premier_rulebook' }
    return null  // Premier never falls back — if rulebook says null, the round was unpaid (e.g. early Q)
  }

  // 2. FIP Tour: scraped breakdown first
  if (isFipTour(tier)) {
    const scraped = lookupBreakdown(tournament.prize_breakdown, round, isWinner)
    if (scraped != null) return { per_player_eur: scraped, source: 'fip_breakdown_scraped' }

    // 3. FIP Tour: rulebook percentage × total
    const computed = computeFipTourPerPlayer({
      tier, totalPrizeEur: tournament.prize_money_eur, round, isWinner,
    })
    if (computed != null) return { per_player_eur: computed, source: 'fip_tour_rulebook_pct' }
  }

  return null
}

export function computeEarningsForTournament(
  tournament: TournamentInput,
  matches: MatchInput[],
): EarningRow[] {
  const rows: EarningRow[] = []

  // Determine tier from level + category. Skip the entire tournament if the
  // tier is out of scope (fip_beyond, fip_promises, fip_other, unknown).
  // We pick the first match's category to derive tier — but for tournaments
  // that have BOTH men's and women's draws, we need to compute per-category.
  // Group matches by category and process each separately.
  const byCategory = new Map<Category, MatchInput[]>()
  for (const m of matches) {
    const list = byCategory.get(m.category) ?? []
    list.push(m)
    byCategory.set(m.category, list)
  }

  for (const [category, catMatches] of byCategory) {
    const tier = tierFromLevel(tournament.level, category)
    if (tier == null) continue  // out-of-scope tier

    const termini = findPlayerTermini(catMatches)
    for (const t of termini) {
      if (!t.earned_at) continue  // skip rows without a finished_at
      const resolved = resolvePerPlayer(tier, t.category, t.terminal_round, t.is_winner, tournament)
      if (!resolved) continue

      rows.push({
        player_id: t.player_id,
        tournament_id: tournament.id,
        category: t.category,
        round_eliminated: t.terminal_round,
        per_player_eur: resolved.per_player_eur,
        source: resolved.source,
        earned_at: t.earned_at,
      })
    }
  }

  return rows
}
