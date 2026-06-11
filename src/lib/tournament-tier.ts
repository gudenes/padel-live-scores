// Tournament tier classification.
//
// `isPremierTier` answers "is this the Premier Padel circuit?" — the
// circuit-identity predicate used for notification icons + league badge
// styling. Premier Padel and the FIP Tour are different circuits; even
// FIP Platinum (where Crionet covers PBP/stats) is a FIP-circuit event.
//
// `isPresenceOnlyLive` is a separate question: "does this match have
// point-by-point data we can render?" Premier Padel AND fip_platinum are
// always covered by Padelgod's Crionet live-poller — see `isPremierLevel`
// in tournament-labels.ts. For any other tier the answer is data-driven:
// `hasLivePointByPoint` checks the loaded games for real PBP evidence, so a
// lower FIP tier (e.g. fip_gold) that Crionet actually feeds graduates to
// full live treatment as soon as point data lands. A live FIP match with no
// point data yet stays "presence-only" — it sits at the live status until
// fip-results-writer posts a final, sometimes hours after play ends.
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

// Minimal structural shape of the loaded set→game data we inspect for
// point-by-point evidence. Compatible with both the full `Match['sets']`
// type and the daily-page `MatchesDaySet[]` shape.
type SetWithGames = {
  games?: ReadonlyArray<{
    server_player_id?: string | null
    points?: readonly unknown[] | null
  }> | null
}

// True when any loaded game carries point-by-point evidence — a server
// assignment or a non-empty points array. Both fields are only ever
// populated by padelgod's Crionet live-poller, so their presence means
// real PBP is flowing for this match, regardless of tournament tier.
export function hasLivePointByPoint(
  sets: ReadonlyArray<SetWithGames> | null | undefined,
): boolean {
  if (!sets) return false
  return sets.some((s) =>
    s.games?.some(
      (g) => g.server_player_id != null || (g.points?.length ?? 0) > 0,
    ) ?? false,
  )
}

// True when the match is flagged live in the DB but we have no point-by-point
// data to render. Premier Padel + fip_platinum get PBP via Crionet and are
// never presence-only. For any other tier the decision is data-driven: as soon
// as real PBP data lands (hasLivePointByPoint), the match graduates to the full
// live treatment. Treat unknown tiers (null level) as presence-only until PBP
// data proves otherwise — the calmer default is correct when we don't know.
export function isPresenceOnlyLive(
  match: { status: string; sets?: ReadonlyArray<SetWithGames> | null },
  tournament: { level: string | null },
): boolean {
  if (!isLiveStatus(match.status)) return false
  if (isPremierLevel(tournament.level)) return false
  return !hasLivePointByPoint(match.sets)
}
