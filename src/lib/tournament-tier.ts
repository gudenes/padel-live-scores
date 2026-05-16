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
