/**
 * Official FIP Tour (Cupra) prize money percentages.
 *
 * Source: https://www.padelfip.com/wp-content/uploads/2025/03/Cupra-FIP-Tour-Rulebook-11_03_25_EN.pdf
 *         §8.2 PRIZE MONEY DISTRIBUTION (MEN'S & WOMEN'S — equal pay across genders), page 70
 *
 * Percentages are ROUND-COLLECTIVE allocations of the total prize pool (sum
 * to 100% per tier), NOT per-player. The rulebook footnote "(*) % per player"
 * is misleading — verified empirically by Mendoza FIP Silver: scraped winner
 * = €1,600 / player = 19.97% × €16,024 / 2 players ✓.
 *
 * Per-player formula: per_player_eur = round_pct × total_eur / players_in_round
 *
 * Tier total prize money RANGES (rulebook):
 *   Bronze    €7,000 – €10,000
 *   Silver    €15,000 – €30,000
 *   Gold      €50,000 – €80,000
 *   Platinum  €120,000 – €150,000
 * Out-of-range events use a Premier-Padel-approved breakdown (manual override).
 */

import type { FipTourTier } from './types'
import type { RoundCode } from '../round-canonical'

export const RULEBOOK_VERSION = 'cupra-2025-03'

// Number of players in each round (= 2 × pairs in that round).
// Used to convert "% of total → per-player EUR".
//
// NOTE this is the standard draw structure. Some events use a smaller
// draw (e.g. Bronze typically R16 + onwards, no R32). The engine handles
// missing rounds because the percentage table itself omits them per tier.
export const PLAYERS_IN_ROUND: Record<RoundCode, number> = {
  F:   2,    // 1 pair, applies to BOTH winner and finalist (engine splits)
  SF:  4,
  QF:  8,
  R16: 16,
  R32: 32,
  R64: 64,
  Q1:  16,   // assumes 8 pairs — varies but only "Last Q" earns in FIP Tour
  Q2:  16,
  Q3:  16,
}

// Round-collective % of total prize money.
// 'F' here represents the FINAL ROUND collectively (winner + finalist share
// it). The engine uses winnerShareOfFinal() below to split.
type FipTourTable = Partial<Record<RoundCode, number>>

const TABLES: Record<FipTourTier, FipTourTable> = {
  fip_platinum: {
    F:   0.20,   // Winner allocation (rulebook lists Winner % only — finalist split derived)
    SF:  0.12,
    QF:  0.16,
    R16: 0.19,
    R32: 0.19,
    Q3:  0.03,
    // Note: rulebook lists separate Winner (20%) and Finalist (11%) amounts.
    // We pack both into 'F' total (31%) and split via winnerShareOfFinal().
  },
  fip_gold: {
    F:   0.20,
    SF:  0.13,
    QF:  0.16,
    R16: 0.18,
    R32: 0.23,
  },
  fip_silver: {
    F:   0.1997,
    SF:  0.1296,
    QF:  0.1589,
    R16: 0.1813,
    R32: 0.2305,
  },
  fip_bronze: {
    F:   0.1998,
    SF:  0.2001,
    QF:  0.1995,
    R16: 0.2506,
    // No R32 in Bronze
  },
}

// Finalist share of the total final-round allocation. Both Premier and FIP Tour
// rulebooks consistently put the finalist at ~half the winner's amount, so the
// finalist gets ~33% and the winner ~67% of the F slot. Verified per tier:
//   Platinum: Winner 20% / Finalist 11% → finalist = 11/(11+20) = 0.355
//   Gold:     Winner 20% / Finalist 10% → finalist = 10/(10+20) = 0.333
//   Silver:   Winner 19.97% / Finalist 10% → finalist = 10/(10+19.97) ≈ 0.334
//   Bronze:   Winner 19.98% / Finalist 14.99% → finalist = 14.99/(14.99+19.98) ≈ 0.429
const FINALIST_SHARE: Record<FipTourTier, number> = {
  fip_platinum: 11 / (11 + 20),
  fip_gold:     10 / (10 + 20),
  fip_silver:   10 / (10 + 19.97),
  fip_bronze:   14.99 / (14.99 + 19.98),
}

// Re-pack the rulebook 'F' as the SUM of winner + finalist allocations
// (the table above stores only the winner allocation; we add the finalist
// portion here so 'F' is the round-collective allocation).
const F_TOTAL: Record<FipTourTier, number> = {
  fip_platinum: 0.20 + 0.11,
  fip_gold:     0.20 + 0.10,
  fip_silver:   0.1997 + 0.10,
  fip_bronze:   0.1998 + 0.1499,
}

/**
 * Per-player EUR for a player who stopped at `round` in `tier`, given the
 * tournament's total prize money. Returns null if:
 *   - the round isn't paid in this tier (e.g. R32 in Bronze)
 *   - totalPrizeEur is null/zero/non-finite
 */
export function computeFipTourPerPlayer(args: {
  tier: FipTourTier
  totalPrizeEur: number | null
  round: RoundCode
  isWinner: boolean
}): number | null {
  if (args.totalPrizeEur == null || !Number.isFinite(args.totalPrizeEur) || args.totalPrizeEur <= 0) {
    return null
  }

  if (args.round === 'F') {
    // Use the round-collective F total, then split between winner and finalist
    const fTotal = F_TOTAL[args.tier] * args.totalPrizeEur
    if (args.isWinner) {
      const winnerShare = 1 - FINALIST_SHARE[args.tier]
      return Math.round(fTotal * winnerShare / 2)  // 2 winners
    } else {
      return Math.round(fTotal * FINALIST_SHARE[args.tier] / 2)  // 2 finalists
    }
  }

  const pct = TABLES[args.tier][args.round]
  if (pct == null) return null

  const players = PLAYERS_IN_ROUND[args.round]
  return Math.round((pct * args.totalPrizeEur) / players)
}
