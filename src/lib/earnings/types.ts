/**
 * Shared types for src/lib/earnings/* modules.
 *
 * RoundCode is reused from src/lib/round-canonical.ts (Phase 1 helper)
 * so we don't have two definitions to keep in sync.
 */

import type { RoundCode } from '../round-canonical'

export type Category = 'men' | 'women'

// Premier Padel tiers. 'major_ii' is women-only (men have only one Major).
// 'finals' (year-end Finals) is grouped with Major in our DB but uses a
// separate prize structure — for now we'll alias it to major_i.
export type PremierTier = 'major_i' | 'major_ii' | 'p1' | 'p2'

export type FipTourTier = 'fip_bronze' | 'fip_silver' | 'fip_gold' | 'fip_platinum'

export type Tier = PremierTier | FipTourTier

// Provenance tag carried into the persisted row in PR 2B
export type EarningSource =
  | 'premier_rulebook'      // Premier table absolute lookup
  | 'fip_breakdown_scraped' // tournaments.prize_breakdown jsonb
  | 'fip_tour_rulebook_pct' // Cupra rulebook % × prize_money_eur
  | 'manual'                // ops UI override (out of scope this PR)

export type EarningRow = {
  player_id: string
  tournament_id: string
  category: Category
  round_eliminated: RoundCode
  per_player_eur: number
  source: EarningSource
  earned_at: string  // ISO 8601 — tournament.ends_at (match.finished_at is unreliable)
}

// Plain shape mirroring public.matches columns we read.
// Keep this loose (string for round_canonical, number|null for winner_pair)
// so the engine doesn't pull in the full DB row type.
export type MatchInput = {
  id: string
  category: Category
  round_canonical: RoundCode | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
  winner_pair: 1 | 2 | null
  finished_at: string | null
}

// Plain shape mirroring public.tournaments columns we read.
export type TournamentInput = {
  id: string
  level: string                                       // raw DB value, mapped to Tier inside the engine
  prize_money_eur: number | null
  // Scraped per-round amounts from FIP enricher (Phase 1).
  // Keys are lower-case canonical round labels: 'winner', 'finalist', 'sf',
  // 'qf', 'r16', 'r32', 'r64', 'q1', 'q2', 'q3'. Values are EUR per player.
  prize_breakdown: Record<string, number | string> | null
  ends_at: string | null  // ISO 8601. Used as canonical earned_at — match.finished_at is unreliable.
}

// Map from DB tournaments.level → our Tier union.
// Returns null for tiers that don't earn (fip_beyond, fip_promises, fip_other,
// unknown). The engine will skip computing earnings for those.
export function tierFromLevel(level: string | null, category: Category): Tier | null {
  if (level == null) return null
  switch (level) {
    case 'major':
    case 'finals':
      // For Phase 2 v1 we treat year-end Finals like a Major. If Finals
      // turns out to use a different prize table the engine can branch later.
      return category === 'women' ? 'major_i' : 'major_i'
    case 'p1': return 'p1'
    case 'p2': return 'p2'
    case 'fip_bronze': return 'fip_bronze'
    case 'fip_silver': return 'fip_silver'
    case 'fip_gold': return 'fip_gold'
    case 'fip_platinum': return 'fip_platinum'
    default: return null  // fip_beyond, fip_promises, fip_other, unknown
  }
}
