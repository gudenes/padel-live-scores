// src/lib/match-day-bucket.ts
//
// Pure partition + sort for the day's matches inside a tournament group.
// Used by MatchesTournamentGroup on /matches/[date]. Splits into:
//   - active:   live + upcoming, sorted by scheduled_at asc (nulls last)
//   - finished: finished/retired/walkover, sorted by finished_at desc
//
// Active tiebreaks (when scheduled_at ties):
//   1. court_order asc, nulls last — defensive; in current padelgod data
//      this column is per-court time-slot (1st match on Court X = 1, 2nd = 2),
//      so all matches at the same time slot share the same value and this
//      is usually a no-op. Kept in case a tournament backfills distinct
//      per-court priorities.
//   2. courtRank asc — Center/Central/Stadium/Main → 0; numbered courts
//      ("Court 2", "Pista 3") → the number; everything else → +Infinity.
//      This matches user expectation that the headline court appears
//      first when multiple courts run simultaneously.
//   3. Court name (case-insensitive) asc as final fallback.
//
// Finished tiebreaks: scheduled_at desc → id asc (deterministic for tests).

export interface DayMatch {
  id: string
  status: string
  scheduled_at: string | null
  finished_at: string | null
  court: string | null
  court_order: number | null
}

export type StatusBucket = 'live' | 'upcoming' | 'finished'

export function bucketStatus(s: string): StatusBucket | null {
  if (s === 'live' || s === 'on_court' || s === 'ended') return 'live'
  if (s === 'scheduled' || s === 'warming_up') return 'upcoming'
  if (s === 'finished' || s === 'retired' || s === 'walkover') return 'finished'
  return null
}

// Court-priority rank used as a tiebreak when multiple matches share the
// same scheduled_at. Centre/Central/Stadium/Main → 0; numbered courts
// ("Court 2", "Pista 3", "Cancha 4") → the integer; unrecognised names
// → +Infinity (which then falls to alphabetical on the surrounding sort).
const CENTER_COURT_TOKENS = new Set([
  'central', 'center', 'centre', 'centro', 'centrale', 'stadium', 'main',
])

export function courtRank(name: string | null | undefined): number {
  if (!name) return Number.POSITIVE_INFINITY
  const tokens = name.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.some(t => CENTER_COURT_TOKENS.has(t))) return 0
  for (const t of tokens) {
    if (/^\d+$/.test(t)) return parseInt(t, 10)
  }
  return Number.POSITIVE_INFINITY
}

export interface BucketedDayMatches<T extends DayMatch> {
  active: T[]
  finished: T[]
}

export function bucketDayMatches<T extends DayMatch>(matches: T[]): BucketedDayMatches<T> {
  const active: T[] = []
  const finished: T[] = []
  for (const m of matches) {
    const b = bucketStatus(m.status)
    if (b === 'finished') finished.push(m)
    else if (b === 'live' || b === 'upcoming') active.push(m)
    // null bucket → drop (unknown status, defensive)
  }

  active.sort((a, b) => {
    // scheduled_at asc, nulls last
    const aT = a.scheduled_at ?? ''
    const bT = b.scheduled_at ?? ''
    if (aT && bT && aT !== bT) return aT < bT ? -1 : 1
    if (aT && !bT) return -1
    if (!aT && bT) return 1
    // tiebreak: court_order asc (nulls last)
    const aO = a.court_order ?? Number.POSITIVE_INFINITY
    const bO = b.court_order ?? Number.POSITIVE_INFINITY
    if (aO !== bO) return aO - bO
    // tiebreak: court priority (Center → 0, Court 2 → 2, etc.)
    const aR = courtRank(a.court)
    const bR = courtRank(b.court)
    if (aR !== bR) return aR - bR
    // tiebreak: court name asc
    const aC = (a.court ?? '').toLowerCase()
    const bC = (b.court ?? '').toLowerCase()
    if (aC && bC && aC !== bC) return aC < bC ? -1 : 1
    return 0
  })

  finished.sort((a, b) => {
    const aT = a.finished_at ?? ''
    const bT = b.finished_at ?? ''
    if (aT && bT && aT !== bT) return aT < bT ? 1 : -1   // desc
    if (aT && !bT) return -1
    if (!aT && bT) return 1
    const aS = a.scheduled_at ?? ''
    const bS = b.scheduled_at ?? ''
    if (aS && bS && aS !== bS) return aS < bS ? 1 : -1   // desc
    return a.id.localeCompare(b.id)
  })

  return { active, finished }
}
