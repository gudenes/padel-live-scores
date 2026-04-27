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
