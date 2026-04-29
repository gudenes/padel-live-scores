// Shared types + helpers for the /tournaments listing screen.
//
// Kept colocated with the route per the project's "no enterprise
// abstractions" preference — these don't need to live in src/types/.

/**
 * Short label for the tier badge on tournament cards. Drops the "FIP"
 * prefix (the badge is already small) and returns just the tier name —
 * "Beyond" / "Silver" / "P1". Mirrors the mockup labels.
 *
 * Different from src/components/home/shared.tsx#levelLabel, which
 * returns the longer "FIP Silver" form for spotlight / card body
 * contexts that have more space.
 */
export function tierShortLabel(level: string | null): string {
  if (!level) return ''
  const l = level.toLowerCase()
  switch (l) {
    case 'major': return 'Major'
    case 'p1': return 'P1'
    case 'p2': return 'P2'
    case 'finals': return 'Finals'
    case 'fip_platinum': return 'Platinum'
    case 'fip_gold': return 'Gold'
    case 'fip_silver': return 'Silver'
    case 'fip_bronze': return 'Bronze'
    case 'fip_beyond': return 'Beyond'
    case 'fip_promises': return 'Promises'
    case 'fip_hexagon': return 'Hexagon'
    case 'fip_championship': return 'Championship'
    case 'fip_other': return 'FIP'
    case 'fip_finals': return 'FIP Finals'
    case 'fip_star': return 'Star'
    case 'fip_rise': return 'Rise'
    case 'fip_promotion': return 'Promotion'
    default:
      // Unmapped — pretty up the raw slug (drop the leading fip_, title-case).
      return level.replace(/^fip_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
}


export type TournamentStatus = 'live' | 'upcoming' | 'completed'

export type TierBucket =
  | 'all'
  | 'premier'    // major / p1 / p2 / finals
  | 'fip_top'    // platinum / gold
  | 'fip_mid'    // silver / bronze
  | 'fip_base'   // beyond / promises / other / etc.
  | 'following'  // user's bookmarked tournaments — Phase 2

export interface ChampionPair {
  category: 'men' | 'women'
  rank: 1 | 2 // 1 = champion (gold), 2 = finalist (silver)
  player1Name: string
  player2Name: string
}

export interface TournamentSummary {
  id: string
  name: string
  slug: string | null
  country: string | null
  location: string | null
  level: string | null
  starts_at: string
  ends_at: string
  logo_url: string | null
  status: TournamentStatus
  /** For upcoming tournaments — `null` for live/completed. */
  daysUntilStart: number | null
  /** For completed tournaments — `null` while ongoing or upcoming.
   *  May contain men + women champion + men + women finalist (up to 4 rows). */
  champions: ChampionPair[] | null
  /** Bucket for tier filtering. Pre-computed server-side so the client
   *  doesn't need a level → bucket lookup. */
  tierBucket: Exclude<TierBucket, 'all' | 'following'>
}

export interface PremierSpotlightData {
  /** Most-recent completed Premier tournament with at least one champion
   *  — null if no recent Premier ended in the past 90 days. */
  lastChampion: TournamentSummary | null
  /** Next upcoming Premier tournament — null if no Premier in next 365d. */
  nextPremier: TournamentSummary | null
}

export interface EventosPageData {
  year: number
  spotlight: PremierSpotlightData
  tournaments: TournamentSummary[]
  /** Year-over-year breakdown for the archive footer (older years only). */
  archiveYears: Array<{ year: number; count: number }>
}
