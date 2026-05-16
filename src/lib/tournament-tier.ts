// Tournament tier classification — the single source of truth for whether
// a tournament belongs to the Premier circuit (P1/P2/Major/Premier_Mens/
// Premier_Womens, where Crionet exposes live point-by-point) or to the
// FIP circuit (Bronze/Silver/Gold, where it does not).
//
// Used by:
//   - notification-icon.ts (picks Premier vs Cupra FIP icon)
//   - PresenceOnlyHint and the surfaces that render it (MatchCard,
//     MatchesTournamentGroup, match detail hero, LiveMatchCard)
//
// Keep this list in sync if a new Premier-tier label ever ships.

export function isPremierTier(level: string | null | undefined): boolean {
  if (!level) return false
  const n = level.toLowerCase()
  return (
    n.startsWith('p1') ||
    n.startsWith('p2') ||
    n.startsWith('major') ||
    n.startsWith('premier')
  )
}

// Statuses that the data layer flags as "currently being played". The UI
// historically renders these with red LIVE pulse + amber ON COURT badge —
// see isPresenceOnlyLive for the FIP-tier carve-out.
export function isLiveStatus(status: string): boolean {
  return status === 'live' || status === 'on_court'
}

// True when the match is flagged live in the DB but the integration will
// never deliver point-by-point data. Crionet only exposes per-match score
// endpoints for Premier-tier — FIP-tier matches (Bronze/Silver/Gold) sit
// at the live status until fip-results-writer posts a final, sometimes
// hours after play ends. Treat unknown tiers (null level) as presence-only
// — the calmer default is correct when we don't know better.
export function isPresenceOnlyLive(
  match: { status: string },
  tournament: { level: string | null },
): boolean {
  if (!isLiveStatus(match.status)) return false
  return !isPremierTier(tournament.level)
}
