export interface PickDefaultRoundMatch {
  /** Round label, already normalized via the caller's normalizeRoundFull. */
  normalizedRound: string
  /** Match status (e.g. 'live', 'on_court', 'finished', 'scheduled'). */
  status: string
  /** YYYY-MM-DD slice of scheduled_at/started_at in the user's local tz, or null. */
  scheduledDateKey: string | null
  /** Tournament id, used when filtering to a single tournament in multi-tournament views. */
  tournamentId: string | null
}

export interface PickDefaultRoundOptions {
  /** Round labels in tournament progression order (Q1 → Final), already normalized. */
  availableRounds: string[]
  matches: PickDefaultRoundMatch[]
  /** When non-null, only matches with matching tournamentId are considered. */
  activeTournamentId: string | null
  /** Today's date key in the user's local timezone (YYYY-MM-DD). */
  todayKey: string
}

const isLive = (m: PickDefaultRoundMatch) =>
  m.status === 'live' || m.status === 'on_court'

const isFinished = (m: PickDefaultRoundMatch) => m.status === 'finished'

/**
 * Picks the default round to surface on the Matches tab.
 *
 * Priority (most → least preferred):
 *   1. Most-advanced round that has a live (or on_court) match
 *   2. Most-advanced round that has a match scheduled today
 *   3. Most-advanced round that has a finished match
 *   4. Fall back to availableRounds[0] (Q1) so a not-yet-started tournament shows its first round
 *
 * "Most-advanced" = the round nearest the end of `availableRounds`. Live wins over
 * more-advanced-but-finished so a fan opening the page sees the action.
 */
export function pickDefaultRound(opts: PickDefaultRoundOptions): string | null {
  const { availableRounds, matches, activeTournamentId, todayKey } = opts
  if (availableRounds.length === 0) return null

  const inScope = (m: PickDefaultRoundMatch) =>
    !activeTournamentId || m.tournamentId === activeTournamentId

  const reverseRounds = [...availableRounds].reverse()
  const findMostAdvanced = (pred: (m: PickDefaultRoundMatch) => boolean) =>
    reverseRounds.find(r =>
      matches.some(m => m.normalizedRound === r && inScope(m) && pred(m)),
    )

  const isToday = (m: PickDefaultRoundMatch) =>
    m.scheduledDateKey === todayKey

  return (
    findMostAdvanced(isLive)
    ?? findMostAdvanced(isToday)
    ?? findMostAdvanced(isFinished)
    ?? availableRounds[0]
    ?? null
  )
}
