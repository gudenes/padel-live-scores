// Tournament tier classification.
//
// `isPremierTier` answers "is this the Premier Padel circuit?" — the
// circuit-identity predicate used for notification icons + league badge
// styling. Premier Padel and the FIP Tour are different circuits; even
// FIP Platinum (where Crionet covers PBP/stats) is a FIP-circuit event.
//
// `isPresenceOnlyLive` is a separate question: "does this match have
// point-by-point data we can render?" Padelgod's Crionet live-poller
// covers both Premier Padel AND fip_platinum — see `isPremierLevel` in
// tournament-labels.ts which is the canonical PBP-coverage predicate.
// Lower FIP tiers (Bronze/Silver/Gold) sit at the live status until
// fip-results-writer posts a final, sometimes hours after play ends —
// those are the genuinely "presence-only" matches.
//
// Used by:
//   - notification-icon.ts (picks Premier vs Cupra FIP icon)
//   - PresenceOnlyHint and the surfaces that render it (MatchCard,
//     MatchesTournamentGroup, match detail hero, LiveMatchCard)

import { isPremierLevel } from './tournament-labels'

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
// see isPresenceOnlyLive for the no-PBP carve-out.
export function isLiveStatus(status: string): boolean {
  return status === 'live' || status === 'on_court'
}

// True when the match is flagged live in the DB but the integration will
// never deliver point-by-point data. Premier Padel + fip_platinum get
// PBP via Crionet (padelgod's live-poller); lower FIP tiers don't.
// Treat unknown tiers (null level) as presence-only — the calmer default
// is correct when we don't know better.
export function isPresenceOnlyLive(
  match: { status: string },
  tournament: { level: string | null },
): boolean {
  if (!isLiveStatus(match.status)) return false
  return !isPremierLevel(tournament.level)
}
