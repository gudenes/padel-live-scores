import { describe, it, expect, vi } from 'vitest';
import {
  LivePollerLoop,
  computeNextInterval,
  buildLiveMatchState,
  DEFAULT_INTERVAL_MS,
  CRITICAL_INTERVAL_MS,
} from '../../lib/live-poller-loop.js';
import type { LiveMatchState } from '../../lib/live-state.js';
import type { ParsedLiveMatch } from '../../parsers/crionet-tournamentlive.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ParsedLiveMatch fixture. Caller overrides currentPoints +
 * setGames to describe a specific scenario.
 */
function parsedMatchFixture(opts: {
  matchWidgetId?: string;
  team1Points?: string;
  team2Points?: string;
  team1SetGames?: Array<string | null>;
  team2SetGames?: Array<string | null>;
} = {}): ParsedLiveMatch {
  const team1Games = opts.team1SetGames ?? ['1', '-', '-'];
  const team2Games = opts.team2SetGames ?? ['0', '-', '-'];
  return {
    matchWidgetId: opts.matchWidgetId ?? 'MQ012',
    court: 'Court 1',
    roundLabel: 'Q1',
    category: 'men',
    team1: {
      player1Name: 'A',
      player2Name: 'B',
      player1Country: 'ESP',
      player2Country: 'ESP',
      player1Seed: null,
      player2Seed: null,
      currentPoints: opts.team1Points ?? '15',
      setGames: team1Games,
      setTiebreaks: team1Games.map(() => null),
    },
    team2: {
      player1Name: 'C',
      player2Name: 'D',
      player1Country: 'ITA',
      player2Country: 'ITA',
      player1Seed: null,
      player2Seed: null,
      currentPoints: opts.team2Points ?? '0',
      setGames: team2Games,
      setTiebreaks: team2Games.map(() => null),
    },
    servingTeam: 1,
    durationMinutes: 10,
    status: 'live',
  };
}

/**
 * Build an HTML body string that parseCrionetTournamentLive will expand into
 * a live-match page with the provided parsed shape. We shortcut this by
 * mocking the parser itself at the module boundary.
 */
const FAKE_BODY = '<html>fake-live-body</html>';

/**
 * Fake Supabase: shallow router that handles the calls the loop makes.
 *
 * Calls we need to handle:
 *   1. scrape_jobs INSERT (via runScrapeJob) → needs .schema('padelgod')
 *   2. scrape_jobs UPDATE status=success (same path)
 *   3. entity_external_ids SELECT (via findOrCreateMatch's lookupByWidgetId)
 *      → returns a pre-existing matchId so we skip insert/link paths
 *   4. matches SELECT (via getResolvedPlayers) → returns null player UUIDs
 *   5. matches UPDATE (via stampMatchTimes) — started_at / duration / finished_at
 *      chains: .update(patch).eq('id', x)[.is(col, null)]
 *
 * On first poll (prev=null) applyDiff returns early, so we never hit sets /
 * games / match_points tables.
 *
 * `matchesUpdateCalls` lets tests assert on the timestamp writes.
 */
interface MatchesUpdateCall {
  patch: Record<string, unknown>;
  filters: Record<string, unknown>;
}

function fakeSupabase(opts: { matchId: string }): any {
  const matchesUpdateCalls: MatchesUpdateCall[] = [];

  const buildMatchesUpdateChain = (patch: Record<string, unknown>) => {
    const filters: Record<string, unknown> = {};
    // Each terminal (.eq without a following .is, or .is) records the call.
    // Using a PromiseLike shape lets the caller `await` the terminal chain.
    const terminal = {
      then: (resolve: (v: any) => void) => {
        matchesUpdateCalls.push({ patch, filters: { ...filters } });
        resolve({ data: null, error: null });
      },
    };
    const isNode = {
      is: (col: string, val: unknown) => {
        filters[`is:${col}`] = val;
        return terminal;
      },
      // also support terminating at .eq (e.g. duration write has no .is())
      then: (resolve: (v: any) => void) => {
        matchesUpdateCalls.push({ patch, filters: { ...filters } });
        resolve({ data: null, error: null });
      },
    };
    return {
      eq: (col: string, val: unknown) => {
        filters[`eq:${col}`] = val;
        return isNode;
      },
    };
  };

  const api = {
    schema: (_s: string) => ({
      from: (_table: string) => ({
        // scrape_jobs insert → returns a fake job row
        insert: (_row: any) => ({
          select: () => ({
            single: async () => ({
              data: { id: 'scrape-job-uuid-1' },
              error: null,
            }),
          }),
        }),
        // scrape_jobs update (status, completed_at) - chained .eq()
        update: (_row: any) => ({
          eq: async () => ({ data: null, error: null }),
        }),
      }),
    }),
    from: (table: string) => {
      if (table === 'entity_external_ids') {
        return {
          select: (_cols: string) => ({
            eq: (_c1: string, _v1: string) => ({
              eq: (_c2: string, _v2: string) => ({
                eq: (_c3: string, _v3: string) => ({
                  maybeSingle: async () => ({
                    // Pre-existing mapping → short-circuits findOrCreateMatch
                    // on step 1 (widget-id direct lookup).
                    data: { entity_id: opts.matchId },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'matches') {
        return {
          select: (_cols: string) => ({
            eq: (_c: string, _v: string) => ({
              maybeSingle: async () => ({
                data: {
                  pair1_player1_id: null,
                  pair1_player2_id: null,
                  pair2_player1_id: null,
                  pair2_player2_id: null,
                },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => buildMatchesUpdateChain(patch),
        };
      }
      throw new Error(`fakeSupabase: unexpected table '${table}'`);
    },
  };

  // Expose call log for assertions.
  (api as any).__matchesUpdateCalls = matchesUpdateCalls;
  return api;
}

function fakeHttp() {
  return {
    get: vi.fn(async () => ({ data: FAKE_BODY })),
  };
}

function silentLogger() {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => silentLogger(),
    level: 'silent',
  } as any;
}

/**
 * Deterministic timer harness. Returns fns to inject plus internal state.
 */
function createFakeTimers() {
  type Scheduled = { fn: () => void; delay: number; handle: number };
  const scheduled: Scheduled[] = [];
  const cleared: number[] = [];
  let nextHandle = 1;

  const setTimeoutFn = (fn: () => void, delay: number): unknown => {
    const handle = nextHandle++;
    scheduled.push({ fn, delay, handle });
    return handle;
  };
  const clearTimeoutFn = (h: unknown): void => {
    cleared.push(h as number);
  };

  /**
   * Fire the most recently scheduled tick and await completion.
   * Returns the { delay, handle } of the one we just fired.
   */
  async function fireLatest(): Promise<Scheduled> {
    const last = scheduled[scheduled.length - 1];
    if (!last) throw new Error('fireLatest: no scheduled tick');
    // Execute — the tick is async via `void this.runTick()` inside the loop;
    // we need a microtask drain after calling.
    last.fn();
    // Drain microtasks. runScrapeJob + findOrCreateMatch + applyDiff all use
    // awaits; a handful of microtask turns should be enough to let them
    // settle. A tiny setTimeout(0) loop drains reliably.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
    return last;
  }

  return { scheduled, cleared, setTimeoutFn, clearTimeoutFn, fireLatest };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('computeNextInterval', () => {
  function makeState(pointStateKind: LiveMatchState['pointState']['kind']): LiveMatchState {
    let pointState: LiveMatchState['pointState'];
    switch (pointStateKind) {
      case 'deuce':
        pointState = { kind: 'deuce' };
        break;
      case 'advantage':
        pointState = { kind: 'advantage', side: 1 };
        break;
      case 'golden_point':
        pointState = { kind: 'golden_point' };
        break;
      case 'tiebreak':
        pointState = { kind: 'tiebreak', team1: 0, team2: 0 };
        break;
      case 'regular':
      default:
        pointState = { kind: 'regular', team1: 15, team2: 0 };
    }
    return {
      matchWidgetId: 'w',
      matchId: 'm',
      pointState,
      team1Sets: [{ games: 0, tiebreak: null }],
      team2Sets: [{ games: 0, tiebreak: null }],
      servingTeam: 1,
      status: 'live',
    };
  }

  it('returns the default 6s when no match is in a critical state', () => {
    expect(computeNextInterval([makeState('regular'), makeState('tiebreak')])).toBe(
      DEFAULT_INTERVAL_MS,
    );
  });

  it('drops to 3s when ANY match is in deuce', () => {
    expect(computeNextInterval([makeState('regular'), makeState('deuce')])).toBe(
      CRITICAL_INTERVAL_MS,
    );
  });

  it('drops to 3s on advantage and on golden_point', () => {
    expect(computeNextInterval([makeState('advantage')])).toBe(CRITICAL_INTERVAL_MS);
    expect(computeNextInterval([makeState('golden_point')])).toBe(CRITICAL_INTERVAL_MS);
  });
});

describe('buildLiveMatchState', () => {
  it('maps "-" set cells to null entries and numeric cells to LiveSetEntry', () => {
    const parsed = parsedMatchFixture({
      team1SetGames: ['6', '3', '-'],
      team2SetGames: ['4', '6', '-'],
    });
    const s = buildLiveMatchState(parsed, 'match-uuid-1');
    expect(s.team1Sets).toEqual([
      { games: 6, tiebreak: null },
      { games: 3, tiebreak: null },
      null,
    ]);
    expect(s.team2Sets).toEqual([
      { games: 4, tiebreak: null },
      { games: 6, tiebreak: null },
      null,
    ]);
  });

  it('detects inside-tiebreak when both teams are at 6 games in the current set', () => {
    const parsed = parsedMatchFixture({
      team1Points: '5',
      team2Points: '3',
      team1SetGames: ['6', '-', '-'],
      team2SetGames: ['6', '-', '-'],
    });
    const s = buildLiveMatchState(parsed, 'match-uuid-1');
    expect(s.pointState).toEqual({ kind: 'tiebreak', team1: 5, team2: 3 });
  });

  it('parses deuce from both-40 current points', () => {
    const parsed = parsedMatchFixture({ team1Points: '40', team2Points: '40' });
    const s = buildLiveMatchState(parsed, 'm');
    expect(s.pointState).toEqual({ kind: 'deuce' });
  });
});

// ---------------------------------------------------------------------------
// LivePollerLoop — integration-ish (all externals mocked)
// ---------------------------------------------------------------------------

describe('LivePollerLoop.start / stop', () => {
  it('schedules the first tick with delay 0 on start(), then the next tick with default 6s cadence after a non-critical poll', async () => {
    // Mock the parser to return a single non-critical (regular 15-0) match.
    const mod = await import('../../parsers/crionet-tournamentlive.js');
    const parseSpy = vi
      .spyOn(mod, 'parseCrionetTournamentLive')
      .mockReturnValue({
        matches: [parsedMatchFixture({ team1Points: '15', team2Points: '0' })],
      });

    const timers = createFakeTimers();
    const loop = new LivePollerLoop({
      tournamentId: 'tour-uuid-1',
      widgetId: 'FIP-2026-1701',
      supabase: fakeSupabase({ matchId: 'match-uuid-1' }),
      httpClient: fakeHttp() as any,
      logger: silentLogger(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    await loop.start();

    // First tick scheduled at delay 0.
    expect(timers.scheduled.length).toBeGreaterThanOrEqual(1);
    expect(timers.scheduled[0]!.delay).toBe(0);
    expect(loop.isRunning()).toBe(true);

    // Fire the first tick and drain its async work.
    await timers.fireLatest();

    // After the tick completes, a second tick must be scheduled. With a
    // non-critical match, cadence should be default 6s.
    expect(timers.scheduled.length).toBeGreaterThanOrEqual(2);
    const second = timers.scheduled[timers.scheduled.length - 1]!;
    expect(second.delay).toBe(DEFAULT_INTERVAL_MS);

    parseSpy.mockRestore();
    await loop.stop();
  });

  it('stop() clears the pending handle and isRunning() returns false', async () => {
    // Parser doesn't matter — we stop before firing any tick.
    const mod = await import('../../parsers/crionet-tournamentlive.js');
    const parseSpy = vi
      .spyOn(mod, 'parseCrionetTournamentLive')
      .mockReturnValue({ matches: [] });

    const timers = createFakeTimers();
    const loop = new LivePollerLoop({
      tournamentId: 'tour-uuid-1',
      widgetId: 'FIP-2026-1701',
      supabase: fakeSupabase({ matchId: 'match-uuid-1' }),
      httpClient: fakeHttp() as any,
      logger: silentLogger(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    await loop.start();
    expect(loop.isRunning()).toBe(true);
    const firstHandle = timers.scheduled[0]!.handle;

    await loop.stop();
    expect(loop.isRunning()).toBe(false);
    // The pending handle must have been cleared.
    expect(timers.cleared).toContain(firstHandle);

    // start/stop are idempotent — repeated calls are no-ops.
    await loop.stop();
    expect(loop.isRunning()).toBe(false);

    parseSpy.mockRestore();
  });

  it('accepts mode="shadow" and includes it in start-log context', async () => {
    const mod = await import('../../parsers/crionet-tournamentlive.js');
    const parseSpy = vi
      .spyOn(mod, 'parseCrionetTournamentLive')
      .mockReturnValue({ matches: [] });

    const infoCalls: Array<{ ctx: any; msg: string }> = [];
    const logger = {
      ...silentLogger(),
      info: (ctx: any, msg: string) => {
        infoCalls.push({ ctx, msg });
      },
    } as any;

    const timers = createFakeTimers();
    const loop = new LivePollerLoop({
      tournamentId: 'tour-uuid-shadow',
      widgetId: 'FIP-2026-SHADOW',
      supabase: fakeSupabase({ matchId: 'match-uuid-1' }),
      httpClient: fakeHttp() as any,
      logger,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
      mode: 'shadow',
    });

    await loop.start();
    // The "starting" info log must carry mode='shadow' (so Railway operators
    // can tell canonical vs shadow runs apart).
    const startLog = infoCalls.find((c) => c.msg.includes('starting'));
    expect(startLog).toBeDefined();
    expect(startLog!.ctx.mode).toBe('shadow');
    expect(startLog!.ctx.tournamentId).toBe('tour-uuid-shadow');
    expect(startLog!.ctx.widgetId).toBe('FIP-2026-SHADOW');

    await loop.stop();
    const stopLog = infoCalls.find((c) => c.msg.includes('stopped'));
    expect(stopLog).toBeDefined();
    expect(stopLog!.ctx.mode).toBe('shadow');

    parseSpy.mockRestore();
  });

  it('defaults mode to "canonical" in log context when omitted', async () => {
    const mod = await import('../../parsers/crionet-tournamentlive.js');
    const parseSpy = vi
      .spyOn(mod, 'parseCrionetTournamentLive')
      .mockReturnValue({ matches: [] });

    const infoCalls: Array<{ ctx: any; msg: string }> = [];
    const logger = {
      ...silentLogger(),
      info: (ctx: any, msg: string) => {
        infoCalls.push({ ctx, msg });
      },
    } as any;

    const timers = createFakeTimers();
    const loop = new LivePollerLoop({
      tournamentId: 'tour-uuid-1',
      widgetId: 'FIP-2026-1701',
      supabase: fakeSupabase({ matchId: 'match-uuid-1' }),
      httpClient: fakeHttp() as any,
      logger,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
      // no mode — should default
    });

    await loop.start();
    const startLog = infoCalls.find((c) => c.msg.includes('starting'));
    expect(startLog).toBeDefined();
    expect(startLog!.ctx.mode).toBe('canonical');

    await loop.stop();
    parseSpy.mockRestore();
  });

  it('stamps started_at (back-computed) and duration on a canonical live tick', async () => {
    const mod = await import('../../parsers/crionet-tournamentlive.js');
    // durationMinutes=10 on the fixture → started_at = now - 10min, duration = "00:10".
    const parseSpy = vi
      .spyOn(mod, 'parseCrionetTournamentLive')
      .mockReturnValue({
        matches: [parsedMatchFixture({ team1Points: '15', team2Points: '0' })],
      });

    const timers = createFakeTimers();
    const supabase = fakeSupabase({ matchId: 'match-uuid-1' });
    const loop = new LivePollerLoop({
      tournamentId: 'tour-uuid-1',
      widgetId: 'FIP-2026-1701',
      supabase,
      httpClient: fakeHttp() as any,
      logger: silentLogger(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
      // mode defaults to canonical
    });

    await loop.start();
    await timers.fireLatest();

    const calls = (supabase as any).__matchesUpdateCalls as Array<{
      patch: Record<string, unknown>;
      filters: Record<string, unknown>;
    }>;

    // Expect exactly two writes this tick: started_at (guarded) + duration.
    // finished_at is NOT written because the match is still live.
    const startedCall = calls.find((c) => 'started_at' in c.patch);
    const durationCall = calls.find((c) => 'duration' in c.patch);
    const finishedCall = calls.find((c) => 'finished_at' in c.patch);

    expect(startedCall).toBeDefined();
    expect(startedCall!.filters['eq:id']).toBe('match-uuid-1');
    expect(startedCall!.filters['is:started_at']).toBeNull();
    // The stamped value should be an ISO string (not null).
    expect(typeof startedCall!.patch.started_at).toBe('string');
    expect(startedCall!.patch.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(durationCall).toBeDefined();
    expect(durationCall!.patch.duration).toBe('00:10');
    expect(durationCall!.filters['eq:id']).toBe('match-uuid-1');
    // Duration write does NOT use .is() — always overwrites.
    expect(durationCall!.filters['is:duration']).toBeUndefined();

    expect(finishedCall).toBeUndefined();

    parseSpy.mockRestore();
    await loop.stop();
  });

  it('stamps finished_at on the tick when a match transitions live → finished', async () => {
    const mod = await import('../../parsers/crionet-tournamentlive.js');

    // Tick 1: match is live.
    // Tick 2: same match, but the parser now reports status='finished'.
    // The loop's processMatch keeps prev state across ticks, so on tick 2 we
    // should observe the transition and stamp finished_at.
    const liveFixture = parsedMatchFixture({ team1Points: '15', team2Points: '0' });
    const finishedFixture: ParsedLiveMatch = { ...liveFixture, status: 'finished' };

    const parseSpy = vi
      .spyOn(mod, 'parseCrionetTournamentLive')
      .mockReturnValueOnce({ matches: [liveFixture] })
      .mockReturnValueOnce({ matches: [finishedFixture] });

    const timers = createFakeTimers();
    const supabase = fakeSupabase({ matchId: 'match-uuid-1' });
    const loop = new LivePollerLoop({
      tournamentId: 'tour-uuid-1',
      widgetId: 'FIP-2026-1701',
      supabase,
      httpClient: fakeHttp() as any,
      logger: silentLogger(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    await loop.start();
    await timers.fireLatest(); // tick 1 (live)
    await timers.fireLatest(); // tick 2 (finished)

    const calls = (supabase as any).__matchesUpdateCalls as Array<{
      patch: Record<string, unknown>;
      filters: Record<string, unknown>;
    }>;

    const finishedCall = calls.find((c) => 'finished_at' in c.patch);
    expect(finishedCall).toBeDefined();
    expect(finishedCall!.filters['eq:id']).toBe('match-uuid-1');
    expect(finishedCall!.filters['is:finished_at']).toBeNull();
    expect(typeof finishedCall!.patch.finished_at).toBe('string');

    parseSpy.mockRestore();
    await loop.stop();
  });

  it('does NOT write timestamps to public.matches in shadow mode', async () => {
    const mod = await import('../../parsers/crionet-tournamentlive.js');
    const parseSpy = vi
      .spyOn(mod, 'parseCrionetTournamentLive')
      .mockReturnValue({
        matches: [parsedMatchFixture({ team1Points: '15', team2Points: '0' })],
      });

    const timers = createFakeTimers();
    const supabase = fakeSupabase({ matchId: 'match-uuid-1' });
    const loop = new LivePollerLoop({
      tournamentId: 'tour-uuid-1',
      widgetId: 'FIP-2026-1701',
      supabase,
      httpClient: fakeHttp() as any,
      logger: silentLogger(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
      mode: 'shadow',
    });

    await loop.start();
    await timers.fireLatest();

    const calls = (supabase as any).__matchesUpdateCalls as Array<{
      patch: Record<string, unknown>;
      filters: Record<string, unknown>;
    }>;
    // Shadow runs must stay scoped to padelgod.shadow_* tables — no canonical
    // metadata writes at all.
    expect(calls.length).toBe(0);

    parseSpy.mockRestore();
    await loop.stop();
  });

  it('skips started_at stamp when the widget emits durationMinutes=null', async () => {
    const mod = await import('../../parsers/crionet-tournamentlive.js');
    const fx = parsedMatchFixture({ team1Points: '15', team2Points: '0' });
    const parseSpy = vi
      .spyOn(mod, 'parseCrionetTournamentLive')
      .mockReturnValue({ matches: [{ ...fx, durationMinutes: null }] });

    const timers = createFakeTimers();
    const supabase = fakeSupabase({ matchId: 'match-uuid-1' });
    const loop = new LivePollerLoop({
      tournamentId: 'tour-uuid-1',
      widgetId: 'FIP-2026-1701',
      supabase,
      httpClient: fakeHttp() as any,
      logger: silentLogger(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    await loop.start();
    await timers.fireLatest();

    const calls = (supabase as any).__matchesUpdateCalls as Array<{
      patch: Record<string, unknown>;
      filters: Record<string, unknown>;
    }>;
    // Neither started_at nor duration should be written when durationMinutes
    // is null — a future tick with a real value will carry both.
    expect(calls.find((c) => 'started_at' in c.patch)).toBeUndefined();
    expect(calls.find((c) => 'duration' in c.patch)).toBeUndefined();

    parseSpy.mockRestore();
    await loop.stop();
  });

  it('adaptive cadence drops to 3s after a tick where a match is in deuce', async () => {
    const mod = await import('../../parsers/crionet-tournamentlive.js');
    // One match currently at deuce.
    const parseSpy = vi
      .spyOn(mod, 'parseCrionetTournamentLive')
      .mockReturnValue({
        matches: [parsedMatchFixture({ team1Points: '40', team2Points: '40' })],
      });

    const timers = createFakeTimers();
    const loop = new LivePollerLoop({
      tournamentId: 'tour-uuid-1',
      widgetId: 'FIP-2026-1701',
      supabase: fakeSupabase({ matchId: 'match-uuid-1' }),
      httpClient: fakeHttp() as any,
      logger: silentLogger(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    await loop.start();
    // First scheduled at 0ms.
    expect(timers.scheduled[0]!.delay).toBe(0);

    // Run the first tick.
    await timers.fireLatest();

    // Second tick should be scheduled with the critical (3s) cadence
    // because the current state has a deuce match.
    const second = timers.scheduled[timers.scheduled.length - 1]!;
    expect(second.delay).toBe(CRITICAL_INTERVAL_MS);

    parseSpy.mockRestore();
    await loop.stop();
  });
});

// ---------------------------------------------------------------------------
// getResolvedPlayers — private method behavior around cache invalidation
// ---------------------------------------------------------------------------

describe('LivePollerLoop.getResolvedPlayers cache invalidation', () => {
  it('re-reads from DB when the cached entry has any null player FK', async () => {
    // Simulate a thin row on first read, then populated FKs on the next read
    // (e.g. because findPadelapiTwin or a SQL backfill landed between ticks).
    const responses = [
      {
        pair1_player1_id: null,
        pair1_player2_id: null,
        pair2_player1_id: null,
        pair2_player2_id: null,
      },
      {
        pair1_player1_id: 'p-A',
        pair1_player2_id: 'p-B',
        pair2_player1_id: 'p-C',
        pair2_player2_id: 'p-D',
      },
    ];
    let callCount = 0;
    const supabase: any = {
      from: (table: string) => {
        if (table !== 'matches') {
          throw new Error(`unexpected table: ${table}`);
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                const data =
                  responses[Math.min(callCount, responses.length - 1)];
                callCount += 1;
                return { data, error: null };
              },
            }),
          }),
        };
      },
    };

    const timers = createFakeTimers();
    const loop = new LivePollerLoop({
      tournamentId: 't-1',
      widgetId: 'W-1',
      supabase,
      httpClient: fakeHttp() as any,
      logger: silentLogger(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    const method = (loop as any).getResolvedPlayers.bind(loop) as (
      matchId: string,
    ) => Promise<{
      pair1Player1Id: string | null;
      pair1Player2Id: string | null;
      pair2Player1Id: string | null;
      pair2Player2Id: string | null;
    }>;

    // 1st call: thin row — returns nulls, caches nulls
    const first = await method('match-x');
    expect(first.pair1Player1Id).toBeNull();
    expect(callCount).toBe(1);

    // 2nd call: cache has nulls → must re-read → returns populated FKs
    const second = await method('match-x');
    expect(second.pair1Player1Id).toBe('p-A');
    expect(second.pair2Player2Id).toBe('p-D');
    expect(callCount).toBe(2);

    // 3rd call: cache now has a full quartet → skips DB, returns cached
    const third = await method('match-x');
    expect(third.pair1Player1Id).toBe('p-A');
    expect(callCount).toBe(2); // no additional DB read
  });

  it('caches and reuses fully-populated entries from the first read', async () => {
    let callCount = 0;
    const supabase: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              callCount += 1;
              return {
                data: {
                  pair1_player1_id: 'p-A',
                  pair1_player2_id: 'p-B',
                  pair2_player1_id: 'p-C',
                  pair2_player2_id: 'p-D',
                },
                error: null,
              };
            },
          }),
        }),
      }),
    };

    const timers = createFakeTimers();
    const loop = new LivePollerLoop({
      tournamentId: 't-1',
      widgetId: 'W-1',
      supabase,
      httpClient: fakeHttp() as any,
      logger: silentLogger(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    const method = (loop as any).getResolvedPlayers.bind(loop) as (
      matchId: string,
    ) => Promise<{ pair1Player1Id: string | null }>;

    const first = await method('match-y');
    expect(first.pair1Player1Id).toBe('p-A');
    expect(callCount).toBe(1);

    // Subsequent calls must hit the cache — no extra DB reads.
    await method('match-y');
    await method('match-y');
    expect(callCount).toBe(1);
  });
});
