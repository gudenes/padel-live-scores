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

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.opts.logger.info(
      { tournamentId: this.opts.tournamentId, widgetId: this.opts.widgetId },
      'live-poller-loop: starting',
    );
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
    this.opts.logger.info(
      { tournamentId: this.opts.tournamentId, widgetId: this.opts.widgetId },
      'live-poller-loop: stopped',
    );
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
        {
          tournamentId: this.opts.tournamentId,
          widgetId: this.opts.widgetId,
          err: err instanceof Error ? err.message : String(err),
        },
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
    const targetUrl = `/screen/tournamentlive/${this.opts.widgetId}?t=tol`;
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
        {
          tournamentId: this.opts.tournamentId,
          widgetId: this.opts.widgetId,
          err: err instanceof Error ? err.message : String(err),
        },
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
        {
          tournamentId: this.opts.tournamentId,
          widgetId: this.opts.widgetId,
          err: err instanceof Error ? err.message : String(err),
        },
        'live-poller-loop: parse failed, retrying at default cadence',
      );
      return [];
    }

    const currentStates: LiveMatchState[] = [];

    for (const m of parsed.matches) {
      try {
        const state = await this.processMatch(m);
        if (state) currentStates.push(state);
      } catch (err) {
        this.opts.logger.warn(
          {
            tournamentId: this.opts.tournamentId,
            widgetId: this.opts.widgetId,
            matchWidgetId: m.matchWidgetId,
            err: err instanceof Error ? err.message : String(err),
          },
          'live-poller-loop: match processing failed, continuing',
        );
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

    await applyDiff(this.opts.supabase, matchId, prev, curr, diff, resolvedPlayers, {
      logger: this.opts.logger,
    });

    this.states.set(matchId, curr);
    return curr;
  }

  private async getResolvedPlayers(matchId: string): Promise<ResolvedPlayers> {
    const cached = this.resolvedPlayersCache.get(matchId);
    if (cached) return cached;

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
