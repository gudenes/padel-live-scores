/**
 * pickCurrentTournamentMatch — "Tier-0" selection for the player profile's
 * next-match card. Returns the player's most immediate non-finished match in a
 * tournament that is happening RIGHT NOW (started, not yet ended), even when the
 * match has no scheduled time yet.
 *
 * Rationale: a player still alive in an in-progress event whose next match isn't
 * scheduled would otherwise fall through every tier (Tier-1 needs a future time;
 * Tier-2/3 exclude already-started tournaments) and the card would leapfrog to
 * the player's next FUTURE enrollment. An eliminated player's last match is
 * `finished` (a loss), so this returns null for them and the caller falls
 * through to the future enrollment as before.
 *
 * Pure. Generic over a minimal structural shape so it stays decoupled from the
 * page's MatchRow type (mirrors resolveMatchRoles in match-roles.ts).
 */
export interface CurrentMatchCandidate {
  status: string
  scheduled_at: string | null
  tournament: { starts_at: string | null; ends_at: string | null } | null
}

export function pickCurrentTournamentMatch<M extends CurrentMatchCandidate>(
  matches: M[],
  now: Date,
): M | null {
  const nowMs = now.getTime()

  const inProgress = matches.filter((m) => {
    if (m.status !== 'scheduled' && m.status !== 'live' && m.status !== 'on_court') return false
    const t = m.tournament
    if (!t || !t.starts_at) return false
    if (new Date(t.starts_at).getTime() > nowMs) return false
    if (t.ends_at && new Date(t.ends_at).getTime() <= nowMs) return false
    return true
  })
  if (inProgress.length === 0) return null

  const statusRank = (s: string) => (s === 'live' || s === 'on_court' ? 0 : 1) // in-play before scheduled
  const timeMs = (s: string | null) => (s ? new Date(s).getTime() : Infinity) // null time last

  return [...inProgress].sort(
    (a, b) =>
      statusRank(a.status) - statusRank(b.status) ||
      timeMs(a.scheduled_at) - timeMs(b.scheduled_at),
  )[0]
}
