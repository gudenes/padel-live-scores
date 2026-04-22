/**
 * live-state — in-memory representation of one match's state at one poll,
 * plus a diff function that infers what changed between two consecutive polls.
 *
 * Why this module exists
 * ----------------------
 * A naive string-level diff of the two per-team score labels (e.g. "40" vs "AD")
 * gets deuce/advantage/golden-point transitions wrong in ways that silently
 * miscredit points. Example:
 *
 *   prev: team1="AD"  team2="40"
 *   curr: team1="40"  team2="40"
 *
 * A string diff would say "team1's label shrunk, therefore team2 won a point"
 * — which is correct in this case (break back to deuce), but the same pattern
 * also shows up when a game ends (AD → 0-0 after points++). Without modelling
 * the underlying states as a lattice, you can't tell those apart.
 *
 * We use an explicit PointState discriminated union so the comparator can
 * reason about every legal transition in standard tennis/padel scoring rules
 * (including golden-point tournaments, which replace the deuce/AD loop with
 * a single "GP" label).
 *
 * The module is intentionally pure — no Supabase, no logger bound at module
 * level. `diffLiveState` accepts an optional logger on every call so the caller
 * (tournamentlive parser / live worker) can inject its own bound logger.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Canonical point labels.
 *
 * In a standard game: 0 < 15 < 30 < 40 < AD.
 * - `regular` is the common case: both teams at a numeric score, no deuce yet.
 * - `deuce` is a distinct state (both at 40, rally ongoing before AD is
 *    assigned). The parser NEVER emits `regular {40,40}` — it collapses to
 *    deuce. The comparator still tolerates `regular {40,40}` defensively
 *    (treats deuce/{40,40} as equivalent), but production never produces it.
 * - `advantage` means one side has the AD.
 * - `golden_point` ("GP") is the deuce-decider label used when
 *    `tournaments.uses_golden_point = true`. It replaces the deuce/AD loop
 *    entirely: instead of needing to win two in a row from deuce, one point
 *    ends the game. Widgets sometimes flicker between `deuce` and `GP` as
 *    labels of the same state — see the comparator below.
 * - `tiebreak` numeric scores for points inside a tiebreak game.
 */
export type PointState =
  | { kind: 'regular'; team1: 0 | 15 | 30 | 40; team2: 0 | 15 | 30 | 40 }
  | { kind: 'deuce' }
  | { kind: 'advantage'; side: 1 | 2 }
  | { kind: 'golden_point' }
  | { kind: 'tiebreak'; team1: number; team2: number };

/**
 * Sets array entry: one set worth of games + (optional) tiebreak digit.
 * `null` means the set hasn't started. The array is indexed by set number - 1.
 */
export interface LiveSetEntry {
  games: number;
  tiebreak: number | null;
}

export interface LiveMatchState {
  matchWidgetId: string;
  /** Canonical PadelNachos UUID — resolved via match-identifier before constructing this. */
  matchId: string;
  pointState: PointState;
  team1Sets: Array<LiveSetEntry | null>;
  team2Sets: Array<LiveSetEntry | null>;
  servingTeam: 1 | 2 | null;
  /**
   * Match status as observed by the live widget.
   *
   * - `scheduled` — default for match rows created out-of-band. Not emitted
   *   by the tournamentlive parser directly.
   * - `on_court` — widget label is "On court" or "Warming up". Players on
   *   court, no first point scored. Fan-visible "about to start" signal.
   * - `live` — widget label is "Live match" (or any non-pre-match text).
   *   Match in progress.
   * - `finished` — widget emitted a terminal status. Rare (Crionet usually
   *   drops finished matches from the feed) but supported.
   */
  status: 'scheduled' | 'on_court' | 'live' | 'finished';
}

export interface LiveStateDiff {
  pointsAdded: Array<{ winnerTeam: 1 | 2 }>;
  /** A game just ended (a team's game count in the current set went up). */
  gameChanged: boolean;
  /** A new set started OR the active set index advanced. */
  setChanged: boolean;
  serverChanged: boolean;
  statusChanged: boolean;
  /** True when we can't explain the transition with a single point. */
  suspectedMissedPoints: boolean;
}

/**
 * Minimal logger shape. Matches pino.Logger enough that we don't need to
 * depend on pino here — any `{ warn(obj, msg) }` works, including a test spy.
 */
export interface DiffLogger {
  warn: (obj: unknown, msg: string) => void;
}

export interface DiffOptions {
  logger?: DiffLogger;
}

// ---------------------------------------------------------------------------
// Parser: parsePointState
// ---------------------------------------------------------------------------

/**
 * Normalise a raw score label from the widget — trim whitespace, uppercase.
 * The real Crionet widget emits "Ad" (mixed case) instead of "AD", so we MUST
 * be case-insensitive here or every advantage will fall through to the error
 * branch. Similarly we accept lowercase "gp" defensively.
 */
function normalizeRaw(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * Parse the two raw strings the widget gives us per team into a PointState.
 *
 * Parser contract (critical — the comparator depends on this):
 *   - Both raw values "40"                    → { kind: 'deuce' }
 *   - One raw "AD", other "40"                → { kind: 'advantage', side }
 *   - Either raw "GP"                         → { kind: 'golden_point' }
 *   - insideTiebreak=true                     → { kind: 'tiebreak', ... }
 *   - Otherwise                               → { kind: 'regular', team1, team2 }
 *
 * The parser is case-insensitive. It throws on anything it can't recognise
 * (rather than silently returning a regular state with zeros) so we catch
 * widget schema drift early.
 */
export function parsePointState(
  team1Raw: string,
  team2Raw: string,
  insideTiebreak: boolean,
): PointState {
  const a = normalizeRaw(team1Raw);
  const b = normalizeRaw(team2Raw);

  if (insideTiebreak) {
    const t1 = Number(a);
    const t2 = Number(b);
    if (!Number.isFinite(t1) || !Number.isFinite(t2) || t1 < 0 || t2 < 0) {
      throw new Error(
        `parsePointState: invalid tiebreak score (${team1Raw}, ${team2Raw})`,
      );
    }
    return { kind: 'tiebreak', team1: t1, team2: t2 };
  }

  // Golden point — either label is enough.
  if (a === 'GP' || b === 'GP') {
    return { kind: 'golden_point' };
  }

  // Advantage
  if (a === 'AD' && b === '40') return { kind: 'advantage', side: 1 };
  if (b === 'AD' && a === '40') return { kind: 'advantage', side: 2 };
  if (a === 'AD' || b === 'AD') {
    throw new Error(
      `parsePointState: AD without opposing 40 (${team1Raw}, ${team2Raw})`,
    );
  }

  // Regular numeric scores
  const num1 = toRegularPoint(a, team1Raw);
  const num2 = toRegularPoint(b, team2Raw);

  if (num1 === 40 && num2 === 40) {
    // Contract: both-40 raw ALWAYS collapses to deuce. The comparator depends
    // on this — it can then trust that seeing `regular {40, x≠40}` or
    // `regular {x≠40, 40}` means we were NOT in deuce.
    return { kind: 'deuce' };
  }

  return { kind: 'regular', team1: num1, team2: num2 };
}

function toRegularPoint(normalised: string, raw: string): 0 | 15 | 30 | 40 {
  switch (normalised) {
    case '0':
    case '00':
      return 0;
    case '15':
      return 15;
    case '30':
      return 30;
    case '40':
      return 40;
    default:
      throw new Error(`parsePointState: unrecognised score label "${raw}"`);
  }
}

// ---------------------------------------------------------------------------
// Helpers for comparator
// ---------------------------------------------------------------------------

function pointStatesEqual(a: PointState, b: PointState): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'regular':
      return (
        a.team1 === (b as typeof a).team1 && a.team2 === (b as typeof a).team2
      );
    case 'deuce':
    case 'golden_point':
      return true;
    case 'advantage':
      return a.side === (b as typeof a).side;
    case 'tiebreak':
      return (
        a.team1 === (b as typeof a).team1 && a.team2 === (b as typeof a).team2
      );
  }
}

/** Index of the last non-null set entry, or -1 if none. */
function lastSetIndex(sets: Array<LiveSetEntry | null>): number {
  for (let i = sets.length - 1; i >= 0; i--) {
    if (sets[i] != null) return i;
  }
  return -1;
}

interface SetComparison {
  gameChanged: boolean;
  setChanged: boolean;
  /** Which side had their games++ in the current set. Only meaningful when gameChanged. */
  gameWinnerSide: 1 | 2 | null;
  /** True when the latest set shows a recorded tiebreak digit on the side that won games. */
  currentSetHasTiebreak: boolean;
}

function compareSets(
  prev: LiveMatchState,
  curr: LiveMatchState,
): SetComparison {
  const prevIdx = lastSetIndex(prev.team1Sets);
  const currIdx = lastSetIndex(curr.team2Sets.length > curr.team1Sets.length ? curr.team2Sets : curr.team1Sets);
  // Use the max index across both teams for each side to be robust.
  const currIdxA = lastSetIndex(curr.team1Sets);
  const currIdxB = lastSetIndex(curr.team2Sets);
  const currIdxMax = Math.max(currIdxA, currIdxB);

  const setChanged = currIdxMax > prevIdx;

  // gameChanged: compare current-set games on both sides.
  // Use currIdxMax as the "current" set. If prev didn't have an entry there,
  // treat games as 0.
  let gameChanged = false;
  let gameWinnerSide: 1 | 2 | null = null;
  let currentSetHasTiebreak = false;

  if (currIdxMax >= 0) {
    const prevAGames = prev.team1Sets[currIdxMax]?.games ?? 0;
    const prevBGames = prev.team2Sets[currIdxMax]?.games ?? 0;
    const currAGames = curr.team1Sets[currIdxMax]?.games ?? 0;
    const currBGames = curr.team2Sets[currIdxMax]?.games ?? 0;

    if (currAGames > prevAGames) {
      gameChanged = true;
      gameWinnerSide = 1;
    } else if (currBGames > prevBGames) {
      gameChanged = true;
      gameWinnerSide = 2;
    }

    const currTb1 = curr.team1Sets[currIdxMax]?.tiebreak ?? null;
    const currTb2 = curr.team2Sets[currIdxMax]?.tiebreak ?? null;
    currentSetHasTiebreak = currTb1 !== null || currTb2 !== null;
  }

  // If setChanged AND gameChanged wasn't detected in currIdxMax (because the
  // new set starts with games=0,0), check whether the PREVIOUS set just ended
  // with a games++ — that's the game-ending point of the old set.
  if (!gameChanged && setChanged && prevIdx >= 0) {
    const prevAGames = prev.team1Sets[prevIdx]?.games ?? 0;
    const prevBGames = prev.team2Sets[prevIdx]?.games ?? 0;
    const currAGames = curr.team1Sets[prevIdx]?.games ?? 0;
    const currBGames = curr.team2Sets[prevIdx]?.games ?? 0;
    if (currAGames > prevAGames) {
      gameChanged = true;
      gameWinnerSide = 1;
    } else if (currBGames > prevBGames) {
      gameChanged = true;
      gameWinnerSide = 2;
    }
    // Tiebreak digit recorded on the set that just ended?
    const prevSetTb1 = curr.team1Sets[prevIdx]?.tiebreak ?? null;
    const prevSetTb2 = curr.team2Sets[prevIdx]?.tiebreak ?? null;
    if (prevSetTb1 !== null || prevSetTb2 !== null) {
      currentSetHasTiebreak = true;
    }
  }

  return { gameChanged, setChanged, gameWinnerSide, currentSetHasTiebreak };
}

// ---------------------------------------------------------------------------
// Point-state comparator
// ---------------------------------------------------------------------------

interface PointComparison {
  pointAdded: 1 | 2 | null;
  suspected: boolean;
}

/**
 * Compare two point states and decide who (if anyone) won a point.
 *
 * Implements the truth table documented in docs/superpowers/plans/2026-04-18-padelgod-plan-4.md
 * Task 11. Keep this function and that doc in sync.
 *
 * Returns:
 *   { pointAdded: 1|2|null, suspected: boolean }
 *
 * `gameWinnerSide` is the side whose games-counter went up in this diff
 * (if any). It's used to attribute the game-ending point when the point
 * state flips to {0,0}.
 */
function comparePointStates(
  prev: PointState,
  curr: PointState,
  gameWinnerSide: 1 | 2 | null,
): PointComparison {
  // Label-only shuffles / no-ops first.
  if (pointStatesEqual(prev, curr)) {
    return { pointAdded: null, suspected: false };
  }

  // deuce <-> golden_point: widgets sometimes reshuffle between these as
  // labels of the same state. No new point.
  if (
    (prev.kind === 'deuce' && curr.kind === 'golden_point') ||
    (prev.kind === 'golden_point' && curr.kind === 'deuce')
  ) {
    return { pointAdded: null, suspected: false };
  }

  // regular → regular
  if (prev.kind === 'regular' && curr.kind === 'regular') {
    return compareRegularToRegular(prev, curr);
  }

  // regular {30,40} or {40,30} → deuce
  if (prev.kind === 'regular' && curr.kind === 'deuce') {
    // exactly one team at 40 and the other at 30 means that 30-team just
    // hit 40 and we collapsed to deuce.
    if (prev.team1 === 40 && prev.team2 === 30) {
      return { pointAdded: 2, suspected: false };
    }
    if (prev.team2 === 40 && prev.team1 === 30) {
      return { pointAdded: 1, suspected: false };
    }
    // `regular {40,40}` → deuce: defensive tolerance — the parser never
    // emits regular 40-40, but if a caller hand-constructed such a prev,
    // treat as no-op label shuffle.
    if (prev.team1 === 40 && prev.team2 === 40) {
      return { pointAdded: null, suspected: false };
    }
    return { pointAdded: null, suspected: true };
  }

  // deuce → advantage
  if (prev.kind === 'deuce' && curr.kind === 'advantage') {
    return { pointAdded: curr.side, suspected: false };
  }

  // advantage → deuce (break back)
  if (prev.kind === 'advantage' && curr.kind === 'deuce') {
    const other: 1 | 2 = prev.side === 1 ? 2 : 1;
    return { pointAdded: other, suspected: false };
  }

  // advantage → regular {0,0} — game ended.
  if (prev.kind === 'advantage' && isZeroZero(curr)) {
    if (gameWinnerSide === null) {
      // Games counter didn't move — something is wrong.
      return { pointAdded: null, suspected: true };
    }
    if (gameWinnerSide === prev.side) {
      // AD side won the game, normal path.
      return { pointAdded: prev.side, suspected: false };
    }
    // AD flipped + game won by the other side in ≤1 poll. Missed at least
    // one intermediate state (break-back-to-deuce and then game-winning
    // point). Still emit 1 game-ending point to the actual winner.
    return { pointAdded: gameWinnerSide, suspected: true };
  }

  // deuce → regular {0,0} — game ended from deuce without ever seeing AD.
  // Possible in real life (golden-point tournaments treat deuce AS the
  // decider, so they skip AD), but in a standard match the AD poll was
  // missed. Either way, emit the game-ending point; only flag suspected
  // when we know it's a standard (non-GP) match — the caller can consult
  // `tournaments.uses_golden_point` if it wants to suppress the warning.
  // V1: always flag suspected on deuce→0-0, matches the truth table.
  if (prev.kind === 'deuce' && isZeroZero(curr)) {
    if (gameWinnerSide === null) {
      return { pointAdded: null, suspected: true };
    }
    return { pointAdded: gameWinnerSide, suspected: true };
  }

  // golden_point → regular {0,0} — GP decided the game, game ended.
  if (prev.kind === 'golden_point' && isZeroZero(curr)) {
    if (gameWinnerSide === null) {
      return { pointAdded: null, suspected: true };
    }
    return { pointAdded: gameWinnerSide, suspected: false };
  }

  // regular → regular {0,0} with game change — covered by the regular→regular
  // branch above (compareRegularToRegular treats that case). But if
  // regular→{0,0} happens without reaching 40 first, that's strange.

  // tiebreak → tiebreak
  if (prev.kind === 'tiebreak' && curr.kind === 'tiebreak') {
    const prevSum = prev.team1 + prev.team2;
    const currSum = curr.team1 + curr.team2;
    if (currSum === prevSum + 1) {
      // exactly one point
      const winner: 1 | 2 =
        curr.team1 > prev.team1 ? 1 : curr.team2 > prev.team2 ? 2 : (null as never);
      if (winner !== 1 && winner !== 2) {
        return { pointAdded: null, suspected: true };
      }
      return { pointAdded: winner, suspected: false };
    }
    if (currSum > prevSum + 1) {
      // Missed some ticks — attribute to net gainer.
      const gained1 = curr.team1 - prev.team1;
      const gained2 = curr.team2 - prev.team2;
      if (gained1 > gained2) return { pointAdded: 1, suspected: true };
      if (gained2 > gained1) return { pointAdded: 2, suspected: true };
      // Equal gain — can't attribute. Flag suspected, no point.
      return { pointAdded: null, suspected: true };
    }
    // Sum decreased or stayed equal with different values — corrupted.
    return { pointAdded: null, suspected: true };
  }

  // tiebreak → regular {0,0} — tiebreak ended, set changed. The game-ending
  // point on the tiebreak is credited here. Caller guarantees setChanged+
  // currentSetHasTiebreak via the broader diff.
  if (prev.kind === 'tiebreak' && isZeroZero(curr)) {
    if (gameWinnerSide === null) {
      return { pointAdded: null, suspected: true };
    }
    return { pointAdded: gameWinnerSide, suspected: false };
  }

  // Anything else — unexplained transition.
  return { pointAdded: null, suspected: true };
}

function isZeroZero(p: PointState): p is { kind: 'regular'; team1: 0; team2: 0 } {
  return p.kind === 'regular' && p.team1 === 0 && p.team2 === 0;
}

/**
 * Regular-to-regular comparator. Exactly one side's numeric score must have
 * advanced one step (0→15, 15→30, 30→40), and the other side must be
 * unchanged. Anything else is suspected.
 */
function compareRegularToRegular(
  prev: Extract<PointState, { kind: 'regular' }>,
  curr: Extract<PointState, { kind: 'regular' }>,
): PointComparison {
  const step1 = regularStep(prev.team1, curr.team1);
  const step2 = regularStep(prev.team2, curr.team2);

  if (step1 === 'up' && step2 === 'same') return { pointAdded: 1, suspected: false };
  if (step2 === 'up' && step1 === 'same') return { pointAdded: 2, suspected: false };
  if (step1 === 'same' && step2 === 'same') return { pointAdded: null, suspected: false };

  return { pointAdded: null, suspected: true };
}

function regularStep(
  from: 0 | 15 | 30 | 40,
  to: 0 | 15 | 30 | 40,
): 'same' | 'up' | 'other' {
  if (from === to) return 'same';
  if (from === 0 && to === 15) return 'up';
  if (from === 15 && to === 30) return 'up';
  if (from === 30 && to === 40) return 'up';
  return 'other';
}

// ---------------------------------------------------------------------------
// Main diff function
// ---------------------------------------------------------------------------

/**
 * Diff two consecutive poll snapshots and report what changed.
 *
 * - `prev === null` means this is the first poll for this match. We return
 *   an empty diff (no points, no warnings): we have no baseline to compare
 *   against.
 * - At most one point is ever added per diff — even when we detect missing
 *   ticks (we credit the apparent winner and flag `suspectedMissedPoints`).
 */
export function diffLiveState(
  prev: LiveMatchState | null,
  curr: LiveMatchState,
  opts: DiffOptions = {},
): LiveStateDiff {
  const result: LiveStateDiff = {
    pointsAdded: [],
    gameChanged: false,
    setChanged: false,
    serverChanged: false,
    statusChanged: false,
    suspectedMissedPoints: false,
  };

  if (prev === null) {
    // First poll — no baseline, no diff.
    return result;
  }

  result.serverChanged = prev.servingTeam !== curr.servingTeam;
  result.statusChanged = prev.status !== curr.status;

  const setComp = compareSets(prev, curr);
  result.gameChanged = setComp.gameChanged;
  result.setChanged = setComp.setChanged;

  const pointComp = comparePointStates(
    prev.pointState,
    curr.pointState,
    setComp.gameWinnerSide,
  );

  if (pointComp.pointAdded !== null) {
    result.pointsAdded.push({ winnerTeam: pointComp.pointAdded });
  }

  if (pointComp.suspected) {
    result.suspectedMissedPoints = true;
    opts.logger?.warn(
      { matchId: curr.matchId, prev, curr },
      'missed points suspected',
    );
  }

  return result;
}
