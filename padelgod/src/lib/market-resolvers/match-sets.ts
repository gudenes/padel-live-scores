// Shared reading of `public.sets` for the SET-SHAPE resolvers — the markets
// that ask about the shape of the scoreline rather than about who won.
//
// ── Why `sets` and never `games` ────────────────────────────────────────
//
// `games.is_tiebreak` and the per-game `points[]` array only exist for Premier
// point-by-point matches: 385 rows out of ~12,000 finished matches in the last
// twelve months carry them. A resolver built on game-level data would answer
// "no" for every FIP-tier match and be wrong almost always. `sets` is written
// for every match — by fip-results-writer, the static reconciler and the live
// poller — and is the only reliable source for this class of question.
//
// ── The truncation rule, stated once and applied by both resolvers ──────
//
// A set-shape question is ASYMMETRIC in a way "who won this match" is not.
// YES can be established by something that already happened and cannot be
// undone. NO can only be established by a match that was allowed to finish: a
// retirement at 6-1 3-0 never gave the remaining sets the chance to produce a
// 6-0 or a third set, so settling NO there would hand NO-holders a win the
// match never actually tested. Hence, for both resolvers:
//
//   event already observed         → decided YES (even on a retirement)
//   match completed, no event      → decided NO
//   match cut short, no event      → VOID (refund every position)
//   anything else                  → undecided, retried later
//
// `walkover` and `cancelled` are the extreme case of "cut short" — nobody
// played at all — and void by the same rule, which is also what
// match.winner_is_pair does with them.

import type { ResolverContext } from './types.js'

/**
 * The match played to its natural end. This is the ONLY status from which a
 * "the event did not happen" answer may be asserted.
 */
const COMPLETED_STATUSES = new Set(['finished'])

/**
 * Terminal, but the match stopped before all of its sets could be played.
 * `status` is preserved verbatim from upstream and is never coerced to
 * 'finished', so these arrive as themselves.
 */
const TRUNCATED_STATUSES = new Set(['retired', 'walkover', 'cancelled'])

export type MatchOutcomeShape = 'completed' | 'truncated' | 'in_progress'

export function classifyStatus(status: string | null): MatchOutcomeShape {
  if (status && COMPLETED_STATUSES.has(status)) return 'completed'
  if (status && TRUNCATED_STATUSES.has(status)) return 'truncated'
  return 'in_progress'
}

/** One row of `public.sets`, normalised to the two game counts. */
export interface SetView {
  setNumber: number
  pair1Games: number | null
  pair2Games: number | null
}

/**
 * A completed set's canonical score string, as written by
 * `parseSetScores` / `consolidatePriorSets`: "6-4", "7-6(3)", "6(5)-7".
 */
const SET_SCORE_RE = /^(\d+)(?:\((\d+)\))?-(\d+)(?:\((\d+)\))?$/

/** PostgREST may hand back an integer column as a string. */
function games(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * Every set on the match, ordered by set number.
 *
 * `set_score` is read FIRST and `pair*_games` only as a fallback. The text
 * column is the authoritative final for a completed set (owned by closeMatch,
 * consolidatePriorSets and fip-results-writer), whereas `pair*_games` is
 * whatever the last live tick captured — and the live poller is documented to
 * lose the closing tick, leaving a real 6-0 stored as 5-0. Reading the games
 * columns first would answer "no bagel" on a match that had one.
 */
export async function loadSets(ctx: ResolverContext, resolverKey: string): Promise<SetView[]> {
  const { data, error } = await ctx.supabase
    .from('sets')
    .select('set_number, pair1_games, pair2_games, set_score')
    .eq('match_id', ctx.matchId)
    .order('set_number', { ascending: true })

  if (error) throw new Error(`${resolverKey}: ${error.message}`)

  const out: SetView[] = []
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const setNumber = games(raw.set_number)
    if (setNumber === null || setNumber < 1) continue

    let pair1Games = games(raw.pair1_games)
    let pair2Games = games(raw.pair2_games)

    const score = typeof raw.set_score === 'string' ? raw.set_score.trim() : ''
    const m = score ? SET_SCORE_RE.exec(score) : null
    if (m) {
      pair1Games = Number(m[1])
      pair2Games = Number(m[3])
    }

    out.push({ setNumber, pair1Games, pair2Games })
  }
  return out
}

/** The two game counts high-first, or null when either side is unknown. */
function spread(s: SetView): { hi: number; lo: number } | null {
  if (s.pair1Games === null || s.pair2Games === null) return null
  return {
    hi: Math.max(s.pair1Games, s.pair2Games),
    lo: Math.min(s.pair1Games, s.pair2Games),
  }
}

/**
 * Did this set END?
 *
 * A padel set finishes 6-0…6-4, 7-5 or 7-6. Anything else is a set still in
 * progress (the live poller upserts the current set from 0-0 upwards) or one
 * abandoned mid-way by a retirement. An unrecognised shape reads as NOT
 * complete, which pushes the caller towards `undecided` rather than towards a
 * wrong answer — the safe direction for a market that pays out.
 */
export function isSetComplete(s: SetView): boolean {
  const sp = spread(s)
  if (!sp) return false
  if (sp.hi === 6) return sp.lo <= 4
  if (sp.hi === 7) return sp.lo === 5 || sp.lo === 6
  return false
}

/**
 * A set that finished with one pair on zero games — a bagel.
 *
 * Gated on `isSetComplete` deliberately: a 0-0 row is the live poller's
 * placeholder for a set about to be played, and a 3-0 is a set abandoned by a
 * retirement. Neither is a set that "finished 6-0".
 */
export function isBagel(s: SetView): boolean {
  if (!isSetComplete(s)) return false
  return s.pair1Games === 0 || s.pair2Games === 0
}

/**
 * Did this set get under way? Distinguishes a real third set from the 0-0
 * placeholder row the live poller writes the instant a set becomes current.
 */
export function wasSetPlayed(s: SetView): boolean {
  return (s.pair1Games ?? 0) + (s.pair2Games ?? 0) > 0
}

/** Which pair took a completed set, or null if it is not complete. */
function setWinner(s: SetView): 1 | 2 | null {
  if (!isSetComplete(s)) return null
  if (s.pair1Games === null || s.pair2Games === null) return null
  return s.pair1Games > s.pair2Games ? 1 : 2
}

/**
 * Does the recorded scoreline describe a WHOLE best-of-three match?
 *
 * The results writers fill `sets` AFTER `matches.status` flips to finished, so
 * a finished match can be read mid-write. Asserting "the event did not happen"
 * from a half-written scoreline is precisely how a market settles wrong, so
 * both set-shape resolvers require this before they will answer NO:
 *
 *   - at least two completed sets, since best-of-three cannot end sooner; and
 *   - one pair holding two of them. A 1-1 split with no third set row means
 *     the third set is missing from the TABLE, not from the match.
 */
export function scorelineLooksComplete(sets: SetView[]): boolean {
  let pair1 = 0
  let pair2 = 0
  for (const s of sets) {
    const w = setWinner(s)
    if (w === 1) pair1 += 1
    else if (w === 2) pair2 += 1
  }
  if (pair1 + pair2 < 2) return false
  return pair1 >= 2 || pair2 >= 2
}

/** Compact, operator-readable rendering of the sets a decision was made on. */
export function setsEvidence(sets: SetView[]): string[] {
  return sets.map((s) => `${s.setNumber}:${s.pair1Games ?? '?'}-${s.pair2Games ?? '?'}`)
}
