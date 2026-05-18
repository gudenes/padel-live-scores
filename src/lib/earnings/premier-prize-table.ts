/**
 * Official Premier Padel prize money distribution.
 *
 * Source (verbatim, 2026 edition):
 *   Men's:   https://www.padelfip.com/wp-content/uploads/2025/03/Premier-Padel-Rulebook-Men%C2%B4s_EN.pdf
 *            §8.2 PRIZE MONEY DISTRIBUTION MEN'S, page 98
 *   Women's: https://www.padelfip.com/wp-content/uploads/2025/03/Premier-Padel-Rulebook-Women%C2%B4s_EN.pdf
 *            §8.2 PRIZE MONEY DISTRIBUTION WOMEN'S, page 98
 *
 * Amounts are EUR per player. Verified by reconstruction:
 *   Brussels P2 2026 published total = €264,534
 *   = sum(men's P2 round amounts × players_per_round)
 *   + sum(women's P2 round amounts × players_per_round)
 *   = €154,534 + €110,000 = €264,534 ✓
 */

import type { Category, PremierTier } from './types'
import type { RoundCode } from '../round-canonical'

export const RULEBOOK_VERSION = '2026'

// Round in the lookup table is the round at which the player STOPPED:
// - 'F' with isWinner=true  → won the tournament
// - 'F' with isWinner=false → finalist (lost the final)
// - 'SF'/'QF'/'R16'/'R32'/'R64' → lost in that round
// - 'Q1'/'Q2'/'Q3' → lost in that qualifying round
//
// The Premier rulebook only pays for the LAST qualifying round of each
// tournament (its "Last Round Q" entry). Earlier qualifier losses earn 0.
// The engine resolves which round is "last Q" per-tournament based on the
// highest Q round actually played in the tournament's matches.

type PrizeTable = Partial<Record<RoundCode | 'F_WINNER', number>>

// Men's Premier — from §8.2 men's rulebook
const MEN: Record<PremierTier, PrizeTable> = {
  // Men's Major (single tier)
  major_i: {
    F_WINNER: 48_700,
    F:         24_350,  // Runner-Up
    SF:        13_525,
    QF:         8_790,
    R16:        5_409,
    R32:        3_460,
    R64:        1_965,
    Q3:         1_274,  // "Last Round Q" — engine maps the actual highest-Q round to this slot
  },
  // Men have no Major II
  major_ii: {},
  // Men's P1
  p1: {
    F_WINNER: 26_270,
    F:         13_917,
    SF:         7_340,
    QF:         4_630,
    R16:        2_705,
    R32:        1_980,
    R64:        1_305,
    Q3:           870,
  },
  // Men's P2
  p2: {
    F_WINNER: 13_960,
    F:         8_205,
    SF:        4_515,
    QF:        2_875,
    R16:       1_950,
    R32:       1_305,
    Q3:          828,
  },
}

// Women's Premier — from §8.2 women's rulebook
const WOMEN: Record<PremierTier, PrizeTable> = {
  // Women's Major I (the men-equivalent tier — pay is equal at this level)
  major_i: {
    F_WINNER: 48_700,
    F:         24_350,
    SF:        13_525,
    QF:         8_790,
    R16:        5_409,
    R32:        3_460,
    R64:        1_965,
    Q3:         1_274,
    Q1:           407,  // Women's Major I has a Q1 stage — men's doesn't
  },
  // Women-only secondary Major tier
  major_ii: {
    F_WINNER: 24_750,
    F:        12_375,
    SF:        6_875,
    QF:        4_813,
    R16:       3_059,
    R32:       1_730,
    R64:       1_352,
    Q3:          791,
    Q1:          344,
  },
  // Women's P1 (NOT equal to men's P1)
  p1: {
    F_WINNER: 17_000,
    F:         9_350,
    SF:        5_100,
    QF:        3_506,
    R16:       2_125,
    R32:       1_105,
    Q3:          723,
    Q1:          160,
  },
  // Women's P2 (NOT equal to men's P2)
  p2: {
    F_WINNER: 11_000,
    F:         6_050,
    SF:        3_300,
    QF:        2_310,
    R16:       1_430,
    R32:         963,
    Q3:          509,
    Q1:          117,
  },
}

const TABLES: Record<Category, Record<PremierTier, PrizeTable>> = {
  men: MEN,
  women: WOMEN,
}

/**
 * Look up the per-player EUR amount a player earned for stopping at `round`
 * in `tier` of `category`. Returns null when:
 *   - the (tier, category) combination has no rulebook entry (e.g. Major II
 *     in the men's table)
 *   - the round isn't paid in this tier (e.g. Q1 loss in men's, which earns 0)
 */
export function lookupPremierPrize(args: {
  tier: PremierTier
  category: Category
  round: RoundCode
  isWinner: boolean
}): number | null {
  const table = TABLES[args.category][args.tier]
  if (!table) return null

  // Final winner gets a different cell than the finalist
  const key: RoundCode | 'F_WINNER' = args.round === 'F' && args.isWinner ? 'F_WINNER' : args.round
  const v = table[key]
  return typeof v === 'number' ? v : null
}

/**
 * Build a `prize_breakdown`-shaped object from the Premier rulebook, used as
 * a fallback when FIP hasn't published a breakdown table on the event page.
 * Premier Majors (men's and women's Major I) have identical payouts in the
 * 2026 rulebook, so a single object covers both genders. For P1/P2, men's
 * and women's tables diverge — pick category explicitly.
 *
 * Returns null for levels with no rulebook entry (FIP-tier events, finals
 * already aliased to major_i, etc.). The shape matches what
 * `src/app/ops/TournamentExplorerTab.tsx` reads — keys are lower-case round
 * labels, values are EUR per player, plus a `source: 'rulebook'` provenance
 * tag.
 */
export function buildPremierBreakdownFromRulebook(
  level: string | null,
  category: Category = 'men',
): Record<string, number | string> | null {
  if (level == null) return null
  let tier: PremierTier | null = null
  switch (level) {
    case 'major':
    case 'finals':
      tier = 'major_i'
      break
    case 'p1': tier = 'p1'; break
    case 'p2': tier = 'p2'; break
    default: return null
  }

  const out: Record<string, number | string> = { source: 'rulebook' }
  const KEYS: Array<[RoundCode, string, boolean]> = [
    ['F',   'winner',   true],
    ['F',   'finalist', false],
    ['SF',  'sf',       false],
    ['QF',  'qf',       false],
    ['R16', 'r16',      false],
    ['R32', 'r32',      false],
    ['R64', 'r64',      false],
    ['Q3',  'q3',       false],
    ['Q1',  'q1',       false],
  ]
  for (const [round, key, isWinner] of KEYS) {
    const v = lookupPremierPrize({ tier, category, round, isWinner })
    if (v != null) out[key] = v
  }
  // Bail out if the table was empty (e.g. men's major_ii) — nothing to show.
  if (Object.keys(out).length === 1) return null
  return out
}
