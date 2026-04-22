/**
 * live-poller-loop — per-tournament adaptive polling loop.
 *
 * Polls Crionet's /screen/tournamentlive/{widgetId} endpoint on a cadence that
 * adapts to match criticality. Each tick:
 *   1. GET the tournamentlive page (via runScrapeJob wrapper → scrape_jobs row)
 *   2. Parse via parseCrionetTournamentLive (pure)
 *   3. For each live match:
 *      - Resolve canonical match UUID via findOrCreateMatch
 *      - Build LiveMatchState (PointState + sets + server + status)
 *      - Diff against per-match in-memory state via diffLiveState
 *      - Apply diff to DB via applyDiff (sets / games / match_points)
 *      - Update in-memory state
 *   4. Compute next cadence from aggregated criticality
 *   5. Schedule next tick
 *
 * In-flight guard
 * ---------------
 * Each tick awaits its work before scheduling the next — so setTimeout only
 * fires after the previous tick fully resolved. No explicit mutex needed.
 *
 * Start / stop
 * ------------
 * start(): first tick scheduled at delay 0. Idempotent.
 * stop():  clear pending timeout. Any in-flight tick completes, then sees
 *          `running=false` and skips scheduling the next. Idempotent.
 *
 * Error handling
 * --------------
 * - HTTP / parse errors: logged at `error`, loop continues at default 6s.
 * - DB errors from applyDiff: already logged internally at warn, loop continues.
 * - Uncaught exceptions at the top of a tick: logged at `fatal`, loop stops.
 *
 * V1 cadence tiers
 * ----------------
 * - 6000ms default
 * - 3000ms when any active match is in deuce / advantage / golden_point
 * Plan 5+: 2000ms (set-point) and 1000ms (match-point) tiers. Detection
 * requires additional scoring context not easily available at this layer.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';
import { createHash } from 'node:crypto';

import { runScrapeJob } from './scrape-job.js';
import { CRIONET_TOURNAMENTLIVE_VERSION } from './parser-versions.js';
import {
  parseCrionetTournamentLive,
  type ParsedLiveMatch,
} from '../parsers/crionet-tournamentlive.js';
import {
  diffLiveState,
  parsePointState,
  type LiveMatchState,
  type LiveSetEntry,
  type PointState,
} from './live-state.js';
import { applyDiff, type ResolvedPlayers } from './point-reconstruction.js';
import { findOrCreateMatch } from './match-identifier.js';
import {
  computeBackstampedStartedAt,
  formatDurationHHMM,
} from './match-time-stamps.js';
import { inferWinnerFromSets } from './shadow-winner-inference.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LivePollerLoopOptions {
  tournamentId: string;
  /**
   * The widget id (e.g. "FIP-2026-1701") used in the tournamentlive URL path.
   * Also used as the tournamentWidgetId part of the match-identifier composite.
   */
  widgetId: string;
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger: Logger;
  /** Injected for testing. Production uses the real setTimeout. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  /** Injected for testing. Production uses the real clearTimeout. */
  clearTimeoutFn?: (handle: unknown) => void;
  /**
   * Write routing for applyDiff. Defaults to 'canonical' (writes to
   * public.sets / games / match_points). When 'shadow', writes are
   * redirected to padelgod.shadow_sets / shadow_match_points — used by the
   * Shadow Mode plan to poll a parallel tournament without touching canonical
   * rows. Propagated into log contexts so Railway operators can tell
   * canonical vs shadow runs apart.
   */
  mode?: 'canonical' | 'shadow';
}

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

export const DEFAULT_INTERVAL_MS = 6000;
export const CRITICAL_INTERVAL_MS = 3000;

/**
 * Compute the delay until the next tick from the set of states we just saw.
 *
 * V1 rule: if any active match's point state is deuce / advantage / golden
 * point, drop to 3s; otherwise stay at 6s. Match-point / set-point awareness
 * (2s / 1s) is intentionally deferred — see module header.
 */
export function computeNextInterval(states: LiveMatchState[]): number {
  for (const s of states) {
    const k = s.pointState.kind;
    if (k === 'deuce' || k === 'advantage' || k === 'golden_point') {
      return CRITICAL_INTERVAL_MS;
    }
  }
  return DEFAULT_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Parser-output → LiveMatchState conversion
// ---------------------------------------------------------------------------

/**
 * Convert one parsed set cell ({ games: string, tiebreak: number | null }) to
 * a LiveSetEntry or null. "-" or empty means the set hasn't started.
 */
function toSetEntry(games: string | null, tiebreak: number | null): LiveSetEntry | null {
  if (games == null) return null;
  const trimmed = games.trim();
  if (trimmed === '' || trimmed === '-') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return { games: n, tiebreak };
}

function teamSetsFromParsed(
  setGames: Array<string | null>,
  setTiebreaks: Array<number | null>,
): Array<LiveSetEntry | null> {
  const len = Math.max(setGames.length, setTiebreaks.length);
  const out: Array<LiveSetEntry | null> = [];
  for (let i = 0; i < len; i++) {
    out.push(toSetEntry(setGames[i] ?? null, setTiebreaks[i] ?? null));
  }
  return out;
}

/**
 * Find the last set index where either team has a non-null entry.
 * Returns -1 when both arrays are entirely null.
 */
function currentSetIndex(
  team1Sets: Array<LiveSetEntry | null>,
  team2Sets: Array<LiveSetEntry | null>,
): number {
  const maxLen = Math.max(team1Sets.length, team2Sets.length);
  for (let i = maxLen - 1; i >= 0; i--) {
    if (team1Sets[i] != null || team2Sets[i] != null) return i;
  }
  return -1;
}

/**
 * Detect "inside tiebreak" for parsePointState.
 *
 * V1 heuristic: both teams' games in the current set equal 6. More nuanced
 * detection (super-tiebreaks at 10 points, 7-6 edge cases) is Plan 5+.
 */
function detectInsideTiebreak(
  team1Sets: Array<LiveSetEntry | null>,
  team2Sets: Array<LiveSetEntry | null>,
): boolean {
  const idx = currentSetIndex(team1Sets, team2Sets);
  if (idx < 0) return false;
  const g1 = team1Sets[idx]?.games ?? null;
  const g2 = team2Sets[idx]?.games ?? null;
  return g1 === 6 && g2 === 6;
}

/**
 * Build a LiveMatchState from a parsed tournamentlive match + the canonical
 * matchId we already resolved via findOrCreateMatch.
 *
 * Exported for tests.
 */
export function buildLiveMatchState(
  parsed: ParsedLiveMatch,
  matchId: string,
): LiveMatchState {
  const team1Sets = teamSetsFromParsed(parsed.team1.setGames, parsed.team1.setTiebreaks);
  const team2Sets = teamSetsFromParsed(parsed.team2.setGames, parsed.team2.setTiebreaks);
  const insideTiebreak = detectInsideTiebreak(team1Sets, team2Sets);

  let pointState: PointState;
  try {
    pointState = parsePointState(
      parsed.team1.currentPoints,
      parsed.team2.currentPoints,
      insideTiebreak,
    );
  } catch {
    // Defensive: if the widget emits something unrecognised (e.g. empty
    // string between games), fall back to 0-0 so we don't crash the loop.
    // The diff comparator will emit suspectedMissedPoints if appropriate.
    pointState = { kind: 'regular', team1: 0, team2: 0 };
  }

  const status: LiveMatchState['status'] = parsed.status === 'finished' ? 'finished' : 'live';

  return {
    matchWidgetId: parsed.matchWidgetId,
    matchId,
    pointState,
    team1Sets,
    team2Sets,
    servingTeam: parsed.servingTeam,
    status,
  };
}

// ---------------------------------------------------------------------------
// Match-close inference helpers (used by closeMatch)
// ---------------------------------------------------------------------------

/**
 * Infer which pair won the match from a LiveMatchState — wraps
 * shadow-winner-inference's `inferWinnerFromSets` by mapping the per-team
 * LiveSetEntry arrays to (set_number, pair1_games, pair2_games) rows.
 *
 * Returns 1 | 2 when one team has won 2 sets; null when the state is
 * indecisive (no team at 2 set wins yet, or both teams' arrays all null).
 * Exported for tests.
 */
export function inferWinnerFromLiveState(state: LiveMatchState): 1 | 2 | null {
  const n = Math.max(state.team1Sets.length, state.team2Sets.length);
  const rows: Array<{
    set_number: number;
    pair1_games: number | null;
    pair2_games: number | null;
  }> = [];
  for (let i = 0; i < n; i++) {
    const t1 = state.team1Sets[i] ?? null;
    const t2 = state.team2Sets[i] ?? null;
    if (t1 === null && t2 === null) continue;
    rows.push({
      set_number: i + 1,
      pair1_games: t1?.games ?? null,
      pair2_games: t2?.games ?? null,
    });
  }
  return inferWinnerFromSets(rows);
}

/**
 * A set is "complete" when one team has won it under standard padel rules:
 *   - First to 6 games with a 2-game lead, OR
 *   - 7-5, OR
 *   - 7-6 (tiebreak win, resolved internally)
 */
function isSetComplete(p1: number, p2: number): boolean {
  if (p1 >= 6 && p1 - p2 >= 2) return true;
  if (p2 >= 6 && p2 - p1 >= 2) return true;
  if (p1 === 7 || p2 === 7) return true;
  return false;
}

export interface FinalSetRow {
  set_number: number;
  pair1_games: number;
  pair2_games: number;
}

/**
 * Build the final set rows we'll upsert when closing a match. Starts from
 * the last-known state's per-team arrays and extrapolates the trailing set
 * if it's still mid-play — e.g. the live-poller caught the set at 5-0 for
 * the winner but never saw the closing game, so we bump the winner's count
 * to 6. Also handles the tiebreak case (6-6 or 6-5 → 7) on the same logic.
 *
 * Intermediate complete sets are written as-is. Sets with both teams still
 * null are skipped.
 *
 * Exported for tests.
 */
export function buildFinalSets(
  state: LiveMatchState,
  winner: 1 | 2,
): FinalSetRow[] {
  const n = Math.max(state.team1Sets.length, state.team2Sets.length);
  const out: FinalSetRow[] = [];

  // Locate the last set that has any non-null entry — this is the candidate
  // for trailing-set extrapolation. Any earlier set is taken as-is.
  let lastNonNull = -1;
  for (let i = 0; i < n; i++) {
    if (state.team1Sets[i] != null || state.team2Sets[i] != null) lastNonNull = i;
  }

  for (let i = 0; i < n; i++) {
    const t1 = state.team1Sets[i] ?? null;
    const t2 = state.team2Sets[i] ?? null;
    if (t1 === null && t2 === null) continue;

    let p1 = t1?.games ?? 0;
    let p2 = t2?.games ?? 0;

    if (i === lastNonNull && !isSetComplete(p1, p2)) {
      // Trailing incomplete set — assume the match winner also won this set.
      // If they're already ≥6 and at a tiebreak score (6-6 or 6-5), bump
      // winner to 7 (standard tiebreak win). Otherwise bump winner to 6.
      if (winner === 1) {
        if (p1 === 6 && p2 >= 5) p1 = 7;
        else if (p1 < 6) p1 = 6;
      } else {
        if (p2 === 6 && p1 >= 5) p2 = 7;
        else if (p2 < 6) p2 = 6;
      }
    }

    out.push({ set_number: i + 1, pair1_games: p1, pair2_games: p2 });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Loop class
// ---------------------------------------------------------------------------

export class LivePollerLoop {
  private readonly opts: LivePollerLoopOptions;
  private readonly states: Map<string, LiveMatchState> = new Map();
  private readonly resolvedPlayersCache: Map<string, ResolvedPlayers> = new Map();
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;

  private running = false;
  private pendingHandle: unknown = null;

  constructor(opts: LivePollerLoopOptions) {
    this.opts = opts;
    // setTimeout / clearTimeout in Node return `NodeJS.Timeout`, in browsers
    // they return `number`. We treat the handle as opaque `unknown`.
    this.setTimeoutFn =
      opts.setTimeoutFn ??
      ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
    this.clearTimeoutFn =
      opts.clearTimeoutFn ??
      ((handle: unknown) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Resolve the configured mode, defaulting to canonical. */
  private get mode(): 'canonical' | 'shadow' {
    return this.opts.mode ?? 'canonical';
  }

  /** Common log context. Included on every log line the loop emits. */
  private logCtx(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      tournamentId: this.opts.tournamentId,
      widgetId: this.opts.widgetId,
      mode: this.mode,
      ...extra,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.opts.logger.info(this.logCtx(), 'live-poller-loop: starting');
    // Kick off the first tick immediately (delay 0).
    this.scheduleNext(0);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.pendingHandle !== null) {
      this.clearTimeoutFn(this.pendingHandle);
      this.pendingHandle = null;
    }
    this.opts.logger.info(this.logCtx(), 'live-poller-loop: stopped');
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    const handle = this.setTimeoutFn(() => {
      // Fire-and-forget the async tick; it will schedule the next one itself.
      void this.runTick();
    }, delayMs);
    this.pendingHandle = handle;
  }

  /**
   * Single tick: fetch, parse, diff, apply. Schedules the next tick on its
   * way out unless the loop has been stopped.
   */
  private async runTick(): Promise<void> {
    // If stop() fired between scheduling and firing, bail before any work.
    if (!this.running) return;

    try {
      const states = await this.pollOnce();
      const nextDelay = computeNextInterval(states);
      this.scheduleNext(nextDelay);
    } catch (err) {
      // Uncaught exception in the tick body (not already handled below) —
      // this is a bug in the loop itself, not an upstream flake. Stop the
      // loop to avoid an infinite crash spiral.
      this.opts.logger.fatal(
        this.logCtx({ err: err instanceof Error ? err.message : String(err) }),
        'live-poller-loop: fatal error in tick, stopping',
      );
      this.running = false;
      this.pendingHandle = null;
    }
  }

  /**
   * Fetch the tournamentlive page once, parse it, and process every live
   * match. Returns the list of current LiveMatchState values for cadence
   * computation.
   *
   * HTTP / parse errors are logged at `error` but do NOT throw — we want
   * the loop to keep retrying at default cadence on transient failures.
   * DB errors inside applyDiff are logged at `warn` internally and do
   * not abort the loop.
   */
  private async pollOnce(): Promise<LiveMatchState[]> {
    const targetUrl = `https://widget.matchscorerlive.com/screen/tournamentlive/${this.opts.widgetId}?t=tol`;
    let body: string | null = null;

    try {
      await runScrapeJob(
        this.opts.supabase,
        {
          jobType: 'tournamentlive',
          tournamentId: this.opts.tournamentId,
          targetUrl,
          parserVersion: CRIONET_TOURNAMENTLIVE_VERSION,
          captureBody: false,
        },
        async () => {
          const response = await this.opts.httpClient.get(targetUrl);
          const bodyText = String(response.data);
          body = bodyText;
          const contentHash = `sha256:${createHash('sha256')
            .update(bodyText)
            .digest('hex')}`;
          return { body: bodyText, contentHash };
        },
      );
    } catch (err) {
      this.opts.logger.error(
        this.logCtx({ err: err instanceof Error ? err.message : String(err) }),
        'live-poller-loop: scrape failed, retrying at default cadence',
      );
      return [];
    }

    if (body === null) {
      // Shouldn't happen — runScrapeJob only returns after fn resolved.
      return [];
    }

    let parsed;
    try {
      parsed = parseCrionetTournamentLive(body);
    } catch (err) {
      this.opts.logger.error(
        this.logCtx({ err: err instanceof Error ? err.message : String(err) }),
        'live-poller-loop: parse failed, retrying at default cadence',
      );
      return [];
    }

    const currentStates: LiveMatchState[] = [];
    const seenMatchIds = new Set<string>();

    for (const m of parsed.matches) {
      try {
        const state = await this.processMatch(m);
        if (state) {
          currentStates.push(state);
          seenMatchIds.add(state.matchId);
        }
      } catch (err) {
        this.opts.logger.warn(
          this.logCtx({
            matchWidgetId: m.matchWidgetId,
            err: err instanceof Error ? err.message : String(err),
          }),
          'live-poller-loop: match processing failed, continuing',
        );
      }
    }

    // Case B: matches we were tracking that fell off the live feed without
    // emitting a terminal tick. Crionet sometimes drops a finished match
    // from the tournamentlive response before surfacing it with
    // status='finished'. Without closeMatch here, the row stays `live`
    // forever (and the stale-detector guard in scores cron correctly
    // refuses to touch padelgod-owned rows). Canonical mode only.
    if (this.mode === 'canonical') {
      for (const [matchId, lastState] of Array.from(this.states.entries())) {
        if (seenMatchIds.has(matchId)) continue;
        const winner = inferWinnerFromLiveState(lastState);
        if (winner === null) {
          this.opts.logger.warn(
            this.logCtx({ matchId }),
            'tracked match disappeared with indecisive sets — leaving status unchanged',
          );
          // Keep the state so a subsequent tick can retry if the widget
          // re-surfaces the match with updated sets.
          continue;
        }
        try {
          await this.closeMatch(
            matchId,
            winner,
            lastState,
            null,
            'disappeared_from_feed',
          );
          // Successful close — drop the state so we don't keep re-closing.
          this.states.delete(matchId);
        } catch (err) {
          this.opts.logger.warn(
            this.logCtx({
              matchId,
              err: err instanceof Error ? err.message : String(err),
            }),
            'close-match failed for disappeared match; will retry next tick',
          );
          // Keep the state for a retry on the next tick.
        }
      }
    }

    return currentStates;
  }

  private async processMatch(parsed: ParsedLiveMatch): Promise<LiveMatchState | null> {
    if (!parsed.matchWidgetId) {
      // Matches without a stats-button data-id can't be identified. Skip.
      return null;
    }

    const { matchId } = await findOrCreateMatch(
      this.opts.supabase,
      {
        tournamentId: this.opts.tournamentId,
        tournamentWidgetId: this.opts.widgetId,
        matchWidgetId: parsed.matchWidgetId,
        category: parsed.category,
        roundLabel: parsed.roundLabel,
        court: parsed.court || null,
      },
      { logger: this.opts.logger },
    );

    const curr = buildLiveMatchState(parsed, matchId);
    const prev = this.states.get(matchId) ?? null;

    const diff = diffLiveState(prev, curr, { logger: this.opts.logger });
    const resolvedPlayers = await this.getResolvedPlayers(matchId);

    // Stamp match-level timestamps on public.matches BEFORE applyDiff.
    // Timestamps are orthogonal to point-level diffs — we always want them
    // recorded, even if applyDiff later throws on a transient sets/games DB
    // error. Canonical mode only: shadow runs must never mutate canonical
    // metadata. Individual stamp failures are logged at warn; they don't
    // abort the tick.
    if (this.mode === 'canonical') {
      await this.stampMatchTimes(matchId, parsed, curr, prev);
    }

    await applyDiff(this.opts.supabase, matchId, prev, curr, diff, resolvedPlayers, {
      logger: this.opts.logger,
      mode: this.mode,
      // Shadow-enabled tournaments need their live data visible on
      // padelnachos.com too — dual-write public.sets + status. Guarded
      // inside applyDiff: only acts when mode==='shadow' AND flag is true.
      // See ApplyDiffOpts.dualWritePublic docs for rationale.
      dualWritePublic: this.mode === 'shadow',
    });

    // Case A: widget emitted a terminal status tick. Close the match now
    // (status + winner + finished_at + final sets). Only on the transition
    // edge (live → finished); subsequent ticks see curr.status === 'finished'
    // with a cached `prev` in the same state and skip the work. Canonical
    // mode only — shadow runs never touch canonical status.
    const observedFinish = curr.status === 'finished';
    const wasLiveOrNew = prev === null || prev.status === 'live';
    if (this.mode === 'canonical' && observedFinish && wasLiveOrNew) {
      const winner = inferWinnerFromLiveState(curr);
      if (winner !== null) {
        await this.closeMatch(
          matchId,
          winner,
          curr,
          parsed.durationMinutes,
          'widget_finished',
        );
      } else {
        this.opts.logger.warn(
          this.logCtx({ matchId }),
          'widget signaled finished but sets are indecisive — leaving status=live for reconciler',
        );
      }
    }

    this.states.set(matchId, curr);
    return curr;
  }

  /**
   * Write started_at / duration / finished_at onto `public.matches`.
   *
   * - `started_at`: back-computed from `parsed.durationMinutes` so late-discovered
   *   matches still get an accurate start. One-shot write guarded with
   *   `.is('started_at', null)` — the first successful stamp wins; subsequent
   *   ticks are no-ops.
   * - `duration`: written on every live tick in `HH:MM` form (monotonically
   *   increasing while the match is live; safe to overwrite).
   * - `finished_at`: stamped `now()` on the tick we first observe a terminal
   *   status from the widget. One-shot guarded with `.is('finished_at', null)`.
   *
   * Schema note: `public.matches.duration` is a `text` column in `HH:MM`
   * format (e.g. "01:20"), matching the legacy padelapi shape — see
   * match-time-stamps.formatDurationHHMM.
   */
  private async stampMatchTimes(
    matchId: string,
    parsed: ParsedLiveMatch,
    curr: LiveMatchState,
    prev: LiveMatchState | null,
  ): Promise<void> {
    const nowMs = Date.now();

    // started_at — back-compute from durationMinutes when present. If the
    // widget didn't emit a duration this tick (rare but possible during page
    // transitions), skip the stamp; a future tick will carry it.
    const startedAtIso = computeBackstampedStartedAt(parsed.durationMinutes, nowMs);
    if (startedAtIso) {
      const { error: sErr } = await this.opts.supabase
        .from('matches')
        .update({ started_at: startedAtIso })
        .eq('id', matchId)
        .is('started_at', null);
      if (sErr) {
        this.opts.logger.warn(
          this.logCtx({ matchId, err: sErr.message }),
          'stamp started_at failed',
        );
      }
    }

    // duration — written on every live tick. Safe to overwrite: the widget's
    // counter is monotonic for a given match.
    if (parsed.durationMinutes !== null) {
      const { error: dErr } = await this.opts.supabase
        .from('matches')
        .update({ duration: formatDurationHHMM(parsed.durationMinutes) })
        .eq('id', matchId);
      if (dErr) {
        this.opts.logger.warn(
          this.logCtx({ matchId, err: dErr.message }),
          'stamp duration failed',
        );
      }
    }

    // NOTE: finished_at is no longer written here — it moved to closeMatch,
    // which also writes status + winner_pair + final sets atomically on the
    // same terminal-status signal. See closeMatch docs for the ownership
    // rationale.
  }

  /**
   * Close a match: write status='finished', winner_pair, finished_at,
   * duration, and upsert the final set rows.
   *
   * Ownership
   * ---------
   * Before this method existed, `status` + `winner_pair` transitions were
   * owned exclusively by `static-reconciler` from results_snapshots. That
   * split worked when all the fetchers were healthy, but:
   *   - results-fetcher can go silent (2026-04-22 incident — no snapshots
   *     for hours while matches finished)
   *   - the reconciler's results phase gates on name resolution from an
   *     entry-list dictionary, which is empty for Premier tournaments
   *
   * Either failure leaves finished matches stuck as `status='live'`.
   * closeMatch moves the primary transition to the live-poller, which has
   * direct observation of Crionet's widget state. The reconciler remains
   * a secondary pass (score correction from the results widget) but is no
   * longer on the critical path for closing.
   *
   * Triggers
   * --------
   * - Case A: `curr.status === 'finished'` observed on a live tick (widget
   *   emits a terminal tick before the match drops from the response).
   * - Case B: a match previously in `this.states` is absent from the new
   *   parsed response (dropped without a terminal tick).
   *
   * Guards
   * ------
   * - `.eq('status', 'live')` — never regress a row already in a terminal
   *   state (finished / retired / walkover).
   * - Indecisive state (neither pair has 2 sets) — caller logs warn and
   *   skips instead of calling this. This method itself is unconditional.
   * - Canonical mode only. Shadow-mode runs must never mutate canonical.
   *
   * Idempotence
   * -----------
   * Safe to call multiple times on the same match. The match update's
   * `.eq('status', 'live')` guard makes it a no-op after the first call.
   * Sets upsert uses `(match_id, set_number)` onConflict — re-running
   * overwrites with the same values.
   */
  private async closeMatch(
    matchId: string,
    winner: 1 | 2,
    state: LiveMatchState,
    durationMinutes: number | null,
    reason: 'widget_finished' | 'disappeared_from_feed',
  ): Promise<void> {
    if (this.mode !== 'canonical') return;

    const nowIso = new Date().toISOString();
    const matchUpdate: Record<string, unknown> = {
      status: 'finished',
      winner_pair: winner,
      finished_at: nowIso,
      updated_at: nowIso,
    };
    if (durationMinutes !== null) {
      matchUpdate.duration = formatDurationHHMM(durationMinutes);
    }

    const { error: mErr } = await this.opts.supabase
      .from('matches')
      .update(matchUpdate)
      .eq('id', matchId)
      .eq('status', 'live');
    if (mErr) {
      this.opts.logger.warn(
        this.logCtx({ matchId, err: mErr.message, reason }),
        'close-match: matches update failed',
      );
      return;
    }

    const finalSets = buildFinalSets(state, winner);
    for (const row of finalSets) {
      const { error: sErr } = await this.opts.supabase
        .from('sets')
        .upsert(
          {
            match_id: matchId,
            set_number: row.set_number,
            pair1_games: row.pair1_games,
            pair2_games: row.pair2_games,
            set_score: `${row.pair1_games}-${row.pair2_games}`,
            is_current: false,
            updated_at: nowIso,
          },
          { onConflict: 'match_id,set_number' },
        );
      if (sErr) {
        this.opts.logger.warn(
          this.logCtx({
            matchId,
            setNumber: row.set_number,
            err: sErr.message,
            reason,
          }),
          'close-match: sets upsert failed',
        );
      }
    }

    this.opts.logger.info(
      this.logCtx({
        matchId,
        winner,
        sets: finalSets.length,
        reason,
      }),
      'close-match: transitioned to finished',
    );
  }

  private async getResolvedPlayers(matchId: string): Promise<ResolvedPlayers> {
    const cached = this.resolvedPlayersCache.get(matchId);
    // Only trust the cache when all four player FKs are populated. If any
    // are null, the match row was a thin row at first-read (e.g. live-poller
    // hit a Premier tournament before its padelapi twin existed, or before
    // static-reconciler / findPadelapiTwin retrofitted the FKs). Re-reading
    // here lets subsequent backfills flow through to `applyDiff`, so the
    // canonical `games.server_player_id` stops being written as null once
    // the FKs are populated upstream.
    if (
      cached &&
      cached.pair1Player1Id &&
      cached.pair1Player2Id &&
      cached.pair2Player1Id &&
      cached.pair2Player2Id
    ) {
      return cached;
    }

    const { data } = await this.opts.supabase
      .from('matches')
      .select('pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
      .eq('id', matchId)
      .maybeSingle();

    const resolved: ResolvedPlayers = {
      pair1Player1Id: (data?.pair1_player1_id as string | null | undefined) ?? null,
      pair1Player2Id: (data?.pair1_player2_id as string | null | undefined) ?? null,
      pair2Player1Id: (data?.pair2_player1_id as string | null | undefined) ?? null,
      pair2Player2Id: (data?.pair2_player2_id as string | null | undefined) ?? null,
    };
    this.resolvedPlayersCache.set(matchId, resolved);
    return resolved;
  }
}
