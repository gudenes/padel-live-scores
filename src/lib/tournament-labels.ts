// Shared tournament display helpers. Extracted from matches/page.tsx so
// multiple pages (player profile Matches tab, /matches page) render
// level + round labels consistently.

export function levelLabel(level: string | null): string {
  const map: Record<string, string> = {
    finals: 'Finals',
    major: 'Major',
    p1: 'P1',
    p2: 'P2',
    fip_platinum: 'FIP Platinum',
    fip_gold: 'FIP Gold',
    fip_silver: 'FIP Silver',
    fip_bronze: 'FIP Bronze',
    fip_star: 'FIP Star',
    fip_rise: 'FIP Rise',
    fip_promotion: 'FIP Promotion',
    fip_finals: 'FIP Finals',
    fip_promises: 'FIP Promises',
    fip_beyond: 'FIP Beyond',
    fip_hexagon: 'Hexagon Cup',
    fip_championship: 'FIP Championship',
    fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}

// Levels with full point-by-point + match-stats coverage. Used to gate
// UI surfaces that only make sense for that data shape (Score Recap,
// Live Feed) and to bucket the matches-page tournament list.
//
// Membership: Premier Padel (Major / Finals / P1 / P2 — padelapi feed)
// + fip_platinum (top FIP Tour tier — padelgod's Crionet live-poller
// + match-stats-fetcher cover it). Lower FIP tiers (Gold / Silver /
// Bronze) don't get PBP from any source and stay excluded.
const PREMIER_LEVELS = new Set([
  'major',
  'finals',
  'p1',
  'p2',
  'fip_platinum',
  'wpt_final',
  'wpt_1000',
  'wpt_master',
  'wpt_500',
])

export function isPremierLevel(level: string | null | undefined): boolean {
  return !!level && PREMIER_LEVELS.has(level.toLowerCase())
}

// Tier weight for sorting/spotlight selection. Lower number = higher tier.
// Premier > Platinum > Gold > Hexagon/Championship (one-off marquee events)
// > Silver > Bronze > Promises > Beyond > everything else.
//
// Used by the home Tournaments view + spotlight picker so the surface
// stays headlined by marquee events even though padelgod now ingests
// every FIP category (Bronze + Promises alone account for hundreds of
// events per year).
export function levelTierWeight(level: string | null): number {
  if (!level) return 99
  const map: Record<string, number> = {
    finals: 0,
    major: 1,
    p1: 2,
    p2: 3,
    fip_platinum: 4,
    fip_gold: 5,
    fip_hexagon: 6,
    fip_championship: 7,
    fip_finals: 8,
    fip_silver: 10,
    fip_bronze: 12,
    fip_star: 14,
    fip_rise: 15,
    fip_promotion: 16,
    fip_promises: 20,
    fip_beyond: 22,
    fip_other: 25,
  }
  return map[level] ?? 50
}

// Listed most-advanced → least-advanced. Used to find the highest round
// the player reached in a given tournament.
export const ROUND_ORDER = [
  'F', 'Final',
  'SF', 'Semi-final',
  'QF', 'Quarter-final',
  'R16', 'R32', 'R64', 'R128',
]

export const ROUND_LABELS: Record<string, string> = {
  F: 'Final',
  Final: 'Final',
  SF: 'Semis',
  'Semi-final': 'Semis',
  QF: 'Quarters',
  'Quarter-final': 'Quarters',
  R16: 'R16',
  R32: 'R32',
  R64: 'R64',
  R128: 'R128',
}

// Lower number = more advanced. Used to compare tournament progression
// across the matches-day groups (the most-advanced round visible today
// determines a tournament's stage chip + secondary sort weight).
//
// Main draw is sorted from Final (most-advanced) to R128. Qualifying
// rounds rank below the main draw, with Q3 closer to main-draw entry
// (more advanced) than Q1.
const ROUND_RANK_TABLE: Record<string, number> = {
  // Main draw — most advanced first
  final: 0, finals: 0, f: 0,
  semifinals: 1, semifinal: 1, 'semi-final': 1, 'semi-finals': 1,
    sf: 1, semi: 1, semis: 1,
  quarterfinals: 2, quarterfinal: 2, 'quarter-final': 2, 'quarter-finals': 2,
    qf: 2, quarter: 2, quarters: 2,
  r16: 3, 'round of 16': 3, '1/8': 3,
  r32: 4, 'round of 32': 4, '1/16': 4,
  r64: 5, 'round of 64': 5,
  r128: 6, 'round of 128': 6,
  // Qualifying — Q3 is the last qualifying round (closest to main draw)
  q3: 7,
  q2: 8,
  q1: 9,
}

/**
 * Lower = more advanced. Returns 99 for unknown / null inputs so they
 * sort to the bottom (least advanced) under ascending comparators.
 */
export function roundRank(round: string | null | undefined): number {
  if (!round) return 99
  return ROUND_RANK_TABLE[round.trim().toLowerCase()] ?? 99
}

/**
 * The most-advanced round (lowest rank) seen across a tournament's
 * matches today. Returns the raw round string + its rank so callers
 * can both render a chip (via stageChipKey) and sort by rank.
 *
 * Distinct from `mostAdvancedRound` above which returns a (localised)
 * display label — that one is consumed by the player profile page;
 * this one is consumed by the matches-day group sort + chip.
 */
export function mostAdvancedRoundEntry(
  matches: Array<{ round: string | null }>,
): { round: string | null; rank: number } {
  let bestRank = 99
  let bestRound: string | null = null
  for (const m of matches) {
    const r = roundRank(m.round)
    if (r < bestRank) {
      bestRank = r
      bestRound = m.round
    }
  }
  return { round: bestRound, rank: bestRank }
}

/**
 * Maps a raw round string into a stable i18n key for the stage chip
 * displayed on the matches-day tournament header. Groups all
 * qualifying rounds (Q1/Q2/Q3) under a single 'qualifying' key —
 * the user doesn't need to know which specific Q round is on today.
 */
export function stageChipKey(round: string | null | undefined): string | null {
  if (!round) return null
  const k = round.trim().toLowerCase()
  if (['final', 'finals', 'f'].includes(k)) return 'final'
  if (['semifinals', 'semifinal', 'semi-final', 'semi-finals', 'sf', 'semi', 'semis'].includes(k)) return 'semifinals'
  if (['quarterfinals', 'quarterfinal', 'quarter-final', 'quarter-finals', 'qf', 'quarter', 'quarters'].includes(k)) return 'quarterfinals'
  if (['r16', 'round of 16', '1/8'].includes(k)) return 'r16'
  if (['r32', 'round of 32', '1/16'].includes(k)) return 'r32'
  if (['r64', 'round of 64'].includes(k)) return 'r64'
  if (['r128', 'round of 128'].includes(k)) return 'r128'
  if (['q1', 'q2', 'q3'].includes(k)) return 'qualifying'
  return null
}

/**
 * Given a list of matches from the same tournament, returns the stage-badge
 * label for the most-advanced round reached. Matches the prefix-insensitive
 * logic used at matches/page.tsx:474-480.
 * Returns null if no recognized round is present.
 */
export function mostAdvancedRound(
  matches: { round: string | null }[],
): string | null {
  let bestIdx = ROUND_ORDER.length
  for (const m of matches) {
    const r = m.round ?? ''
    const idx = ROUND_ORDER.findIndex(
      x => r.toLowerCase().startsWith(x.toLowerCase()),
    )
    if (idx >= 0 && idx < bestIdx) bestIdx = idx
  }
  if (bestIdx >= ROUND_ORDER.length) return null
  const code = ROUND_ORDER[bestIdx]
  return ROUND_LABELS[code] ?? code
}
