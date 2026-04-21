// src/lib/padelgod-live-cards.ts
// Pure types + helpers for the Padelgod shadow-mode live UI.
// No I/O. All Supabase interaction lives in the route file.

// Shared polling interval for the ops tab + hidden preview page clients.
export const LIVE_CARDS_POLL_MS = 5_000

export type PlayerLite = { name: string; country: string | null } | null

/**
 * Side identifier used throughout the live-card payload.
 * String enum chosen over numeric `1 | 2` for self-documenting logs and to
 * match the tennis-industry convention (Sportradar, ITF, etc. reference a
 * side by name rather than positional index). See
 * docs/superpowers/specs/2026-04-21-padelgod-live-ui-design.md §Payload.
 */
export type Side = 'pair1' | 'pair2'

export type PointEntry = {
  set: number
  game: number
  pt: number
  server: Side | null
  score: string
  winner: Side
  isGoldenPoint: boolean
  at: string
}

export type SetEntry = {
  setNumber: number
  pair1Games: number
  pair2Games: number
  /** Winning side once the set is over; null while it's still being played. */
  winner: Side | null
  isCurrent: boolean
  // TODO(follow-up): tiebreak: { pair1: number; pair2: number } | null
}

export type CurrentGame = {
  pair1Score: string
  pair2Score: string
  isGoldenPoint: boolean
  /** Serving side for the point that's currently being played. Null when the
   *  match isn't live or we couldn't determine it from the shadow feed. */
  server: Side | null
}

export type LiveCard = {
  id: string
  tournamentId: string
  tournamentName: string
  status: 'live' | 'scheduled' | 'finished'
  court: string | null
  round: string | null
  scheduledAt: string | null
  /** ISO timestamp of the first captured point (null if match hasn't started). */
  startedAt: string | null
  /** Elapsed seconds since startedAt (live) or total match duration (finished).
   *  Null if no points have been captured yet. */
  durationSec: number | null
  pair1: { player1: PlayerLite; player2: PlayerLite }
  pair2: { player1: PlayerLite; player2: PlayerLite }
  sets: SetEntry[]
  currentGame: CurrentGame
  points: PointEntry[]
}

export type LiveCardsResponse = {
  observedAt: string
  matches: LiveCard[]
}

// Raw row shapes coming out of Supabase (mirror the DB columns we read)
export type ShadowSetRow = {
  match_id: string
  set_number: number
  pair1_games: number | null
  pair2_games: number | null
  updated_at: string | null
}

export type ShadowPointRow = {
  match_id: string
  set_number: number
  game_number: number
  point_number: number
  winner_pair: 1 | 2
  score_after: string | null
  server_team: 1 | 2 | null
  is_golden_point: boolean
  created_at: string
}

export type MatchRow = {
  id: string
  tournament_id: string
  status: string
  court: string | null
  round: string | null
  scheduled_at: string | null
  pair1_player1: { name: string; country: string | null } | null
  pair1_player2: { name: string; country: string | null } | null
  pair2_player1: { name: string; country: string | null } | null
  pair2_player2: { name: string; country: string | null } | null
}

// ---------------------------------------------------------------------------
// toSide — normalise raw DB pair index (1|2|null) to the Side string enum
//   Used at the boundary where ShadowPointRow (DB) → PointEntry (payload).
// ---------------------------------------------------------------------------
function toSide(n: 1 | 2): Side
function toSide(n: 1 | 2 | null): Side | null
function toSide(n: 1 | 2 | null): Side | null {
  if (n === 1) return 'pair1'
  if (n === 2) return 'pair2'
  return null
}

// ---------------------------------------------------------------------------
// parseScoreAfter — split "40-30" into { pair1Score, pair2Score }
// Returns { "0", "0" } for null or malformed input.
// ---------------------------------------------------------------------------
export function parseScoreAfter(score: string | null): {
  pair1Score: string
  pair2Score: string
} {
  if (!score) return { pair1Score: '0', pair2Score: '0' }
  const parts = score.split('-')
  if (parts.length !== 2) return { pair1Score: '0', pair2Score: '0' }
  const [a, b] = parts
  if (!a || !b) return { pair1Score: '0', pair2Score: '0' }
  return { pair1Score: a.trim(), pair2Score: b.trim() }
}

// ---------------------------------------------------------------------------
// deriveLiveState — from a flat list of shadow points, return the currentGame
// state (score + server + golden-point flag) for "right now".
// ---------------------------------------------------------------------------
export function deriveLiveState(points: ShadowPointRow[]): CurrentGame {
  if (points.length === 0) {
    return { pair1Score: '0', pair2Score: '0', isGoldenPoint: false, server: null }
  }
  // Find the latest by (set, game, pt)
  const latest = points.reduce((acc, cur) => {
    if (cur.set_number > acc.set_number) return cur
    if (cur.set_number < acc.set_number) return acc
    if (cur.game_number > acc.game_number) return cur
    if (cur.game_number < acc.game_number) return acc
    return cur.point_number > acc.point_number ? cur : acc
  }, points[0])

  const { pair1Score, pair2Score } = parseScoreAfter(latest.score_after)
  return {
    pair1Score,
    pair2Score,
    isGoldenPoint: latest.is_golden_point,
    server: toSide(latest.server_team),
  }
}

// ---------------------------------------------------------------------------
// derivedSetScores — the trustworthy source of set scores.
//
// padelgod.shadow_sets.pair*_games is point-reconstruction-based and can
// drift (observed in the wild: set ends 6-1 but shadow_sets still reads 5-1
// because the game-winning point wasn't captured). Counting game winners
// from shadow_match_points is more reliable: the winner of the LAST captured
// point in a game is whoever won the game, and the last (set, game) tuple
// overall is the one still in progress — don't count that one.
// ---------------------------------------------------------------------------
export function derivedSetScores(
  points: ShadowPointRow[],
): Map<number, { pair1Games: number; pair2Games: number; winner: Side | null }> {
  const perSet = new Map<number, { pair1Games: number; pair2Games: number; winner: Side | null }>()
  if (points.length === 0) return perSet

  // For each (set, game) find the LATEST captured point — its winner wins the game.
  type GameSummary = { set: number; game: number; winner: 1 | 2; lastPt: number }
  const games = new Map<string, GameSummary>()
  for (const p of points) {
    const key = `${p.set_number}:${p.game_number}`
    const prev = games.get(key)
    if (!prev || p.point_number > prev.lastPt) {
      games.set(key, {
        set: p.set_number,
        game: p.game_number,
        winner: p.winner_pair,
        lastPt: p.point_number,
      })
    }
  }

  // The globally-highest (set, game) is the in-progress game. Exclude it.
  let inProgressKey: string | null = null
  let maxSet = -Infinity
  let maxGame = -Infinity
  for (const [key, g] of games) {
    if (g.set > maxSet || (g.set === maxSet && g.game > maxGame)) {
      maxSet = g.set
      maxGame = g.game
      inProgressKey = key
    }
  }

  // Count completed-game wins per set
  for (const [key, g] of games) {
    if (key === inProgressKey) continue
    const entry = perSet.get(g.set) ?? { pair1Games: 0, pair2Games: 0, winner: null as Side | null }
    if (g.winner === 1) entry.pair1Games += 1
    else entry.pair2Games += 1
    perSet.set(g.set, entry)
  }

  // A set is "won" when a pair reaches ≥6 games with a 2-game lead, OR 7 games.
  // Simplification: tiebreaks at 6-6 aren't modelled yet. Good enough for
  // "is this set over": if the next set has any point, the previous set is
  // by definition over.
  const setsWithAnyPoint = new Set(Array.from(games.values()).map(g => g.set))
  const maxSetSeen = Math.max(...setsWithAnyPoint)
  for (const [setNum, entry] of perSet) {
    const setIsDone = setNum < maxSetSeen
    if (setIsDone) {
      entry.winner = entry.pair1Games > entry.pair2Games ? 'pair1' : 'pair2'
    }
  }
  return perSet
}

// ---------------------------------------------------------------------------
// composeSets — produce SetEntry[] by merging shadow_sets (primary) with
// points-derived counts (fallback). Priority:
//
//   1. shadow_sets.pair*_games wins when present. Padelgod sometimes drifts
//      by one game on set-closers (the final point of a set may not be
//      captured), but the running game count tracks reality far better than
//      our points-derived heuristic does — because many games have only 1-3
//      of their points captured, so "last captured point's winner = game
//      winner" is wrong ~50% of the time with sparse data.
//
//   2. When a set is missing from shadow_sets entirely, fall back to
//      derivedSetScores — better to show a rough count than nothing.
//
//   3. isCurrent = highest set_number across both sources.
//
//   4. winner derived locally: when a later set has points/data, the
//      earlier set is done → winner is whichever pair has more games.
// ---------------------------------------------------------------------------
export function composeSets(
  shadowSets: ShadowSetRow[],
  points: ShadowPointRow[],
): SetEntry[] {
  const derived = derivedSetScores(points)
  const setNumbers = new Set<number>()
  for (const s of shadowSets) setNumbers.add(s.set_number)
  for (const n of derived.keys()) setNumbers.add(n)
  // Include any set referenced by points, even if it has no completed games
  // yet — this is the IN-PROGRESS set and must appear in the output with
  // isCurrent=true so the UI renders it as the live set.
  for (const p of points) setNumbers.add(p.set_number)
  if (setNumbers.size === 0) return []

  const sorted = Array.from(setNumbers).sort((a, b) => a - b)
  const maxSetNum = sorted[sorted.length - 1]

  const shadowByNum = new Map(shadowSets.map(s => [s.set_number, s]))

  return sorted.map(setNum => {
    const s = shadowByNum.get(setNum)
    const d = derived.get(setNum)
    // Primary: shadow_sets; secondary: derived; last-resort: 0.
    let pair1Games = s?.pair1_games ?? d?.pair1Games ?? 0
    let pair2Games = s?.pair2_games ?? d?.pair2Games ?? 0
    const isCurrent = setNum === maxSetNum

    // Padelgod's live-poller sometimes misses the set-closing game. If a
    // done set ends 6-5 or 5-6, that's MATHEMATICALLY impossible in padel
    // (FIP rules: 2-game lead at 6, else tiebreak at 6-6 → 7-5 or 7-6).
    // Bump the leader by 1 to produce the correct 7-5. This catches the
    // single-game-missing case, which is what we see in the wild.
    // 6-6 without a recorded tiebreak result is left as-is; fix is to use
    // results_snapshots once populated (TODO follow-up).
    if (!isCurrent) {
      if (pair1Games === 6 && pair2Games === 5) pair1Games = 7
      else if (pair2Games === 6 && pair1Games === 5) pair2Games = 7
    }

    // Winner = whichever side has more games once the set is done.
    let winner: Side | null = null
    if (!isCurrent) {
      if (pair1Games > pair2Games) winner = 'pair1'
      else if (pair2Games > pair1Games) winner = 'pair2'
    }
    return { setNumber: setNum, pair1Games, pair2Games, winner, isCurrent }
  })
}

// ---------------------------------------------------------------------------
// computeMatchTiming — startedAt (first captured point) + durationSec
//   - durationSec against `nowMs` for live matches
//   - durationSec against the LAST point for finished matches (a "final" duration)
// ---------------------------------------------------------------------------
export function computeMatchTiming(
  points: ShadowPointRow[],
  nowMs: number,
  isLive: boolean,
): { startedAt: string | null; durationSec: number | null } {
  if (points.length === 0) return { startedAt: null, durationSec: null }
  let earliestMs = Infinity
  let latestMs = -Infinity
  let earliestIso = ''
  for (const p of points) {
    const t = Date.parse(p.created_at)
    if (!Number.isFinite(t)) continue
    if (t < earliestMs) {
      earliestMs = t
      earliestIso = p.created_at
    }
    if (t > latestMs) latestMs = t
  }
  if (!Number.isFinite(earliestMs)) return { startedAt: null, durationSec: null }
  const endMs = isLive ? nowMs : latestMs
  return {
    startedAt: earliestIso || null,
    durationSec: Math.max(0, Math.floor((endMs - earliestMs) / 1000)),
  }
}

// ---------------------------------------------------------------------------
// buildLiveCard — compose a LiveCard from a match row + its shadow sets + its
// shadow points. Points ordered oldest-first, capped at 50.
// ---------------------------------------------------------------------------

const MAX_POINTS = 50

// If a match has a shadow point captured within this window, padelgod
// considers it live — even if the canonical matches.status column hasn't
// caught up (common for qualifiers where padelapi.org has no data).
export const LIVE_ACTIVITY_WINDOW_MS = 5 * 60 * 1000

function normaliseStatus(raw: string): 'live' | 'scheduled' | 'finished' {
  if (raw === 'live') return 'live'
  if (raw === 'ended' || raw === 'finished' || raw === 'retired' || raw === 'walkover') return 'finished'
  return 'scheduled'
}

function comparePoints(a: ShadowPointRow, b: ShadowPointRow): number {
  if (a.set_number !== b.set_number) return a.set_number - b.set_number
  if (a.game_number !== b.game_number) return a.game_number - b.game_number
  return a.point_number - b.point_number
}

/**
 * Returns true if the most recent point in `points` was captured within
 * `windowMs` of `nowMs`. Used to decide whether padelgod should surface a
 * match as "live" regardless of the canonical matches.status value.
 */
export function isRecentlyActive(
  points: ShadowPointRow[],
  nowMs: number,
  windowMs: number = LIVE_ACTIVITY_WINDOW_MS,
): boolean {
  if (points.length === 0) return false
  const latestMs = points.reduce((max, p) => {
    const t = Date.parse(p.created_at)
    return Number.isFinite(t) && t > max ? t : max
  }, 0)
  if (latestMs === 0) return false
  return nowMs - latestMs <= windowMs
}

export function buildLiveCard(
  match: MatchRow,
  tournamentName: string,
  sets: ShadowSetRow[],
  points: ShadowPointRow[],
  nowMs: number = Date.now(),
): LiveCard {
  const canonicalStatus = normaliseStatus(match.status)
  const sortedPoints = [...points].sort(comparePoints)
  const cappedPoints = sortedPoints.slice(-MAX_POINTS)

  // Override to 'live' when padelgod is actively capturing points — unless
  // the canonical pipeline has already declared the match finished.
  const status: 'live' | 'scheduled' | 'finished' =
    canonicalStatus !== 'finished' && isRecentlyActive(sortedPoints, nowMs)
      ? 'live'
      : canonicalStatus

  const currentGame: CurrentGame = status === 'live'
    ? deriveLiveState(sortedPoints)
    : { pair1Score: '0', pair2Score: '0', isGoldenPoint: false, server: null as Side | null }

  // Timing: "live" → elapsed from first point to now; "finished" → total
  // elapsed from first point to last point. "scheduled" → null.
  const timing = status === 'scheduled'
    ? { startedAt: null, durationSec: null }
    : computeMatchTiming(sortedPoints, nowMs, status === 'live')

  return {
    id: match.id,
    tournamentId: match.tournament_id,
    tournamentName,
    status,
    court: match.court,
    round: match.round,
    scheduledAt: match.scheduled_at,
    startedAt: timing.startedAt,
    durationSec: timing.durationSec,
    pair1: {
      player1: match.pair1_player1,
      player2: match.pair1_player2,
    },
    pair2: {
      player1: match.pair2_player1,
      player2: match.pair2_player2,
    },
    sets: composeSets(sets, sortedPoints),
    currentGame,
    points: cappedPoints.map(p => ({
      set: p.set_number,
      game: p.game_number,
      pt: p.point_number,
      server: toSide(p.server_team),
      score: p.score_after ?? '0-0',
      winner: toSide(p.winner_pair),
      isGoldenPoint: p.is_golden_point,
      at: p.created_at,
    })),
  }
}
