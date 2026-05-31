import { describe, it, expect } from 'vitest';
import { runCloseStaleLiveSweeper } from '../../workers/close-stale-live-sweeper.js';

interface MatchSeed {
  id: string;
  status: 'live' | 'ended' | 'finished' | 'walkover' | 'retired' | 'scheduled';
  scheduled_at: string | null;
  updated_at: string | null;
  started_at?: string | null;
  duration?: string | null;
  finished_at?: string | null;
}

interface SetSeed {
  match_id: string;
  set_number: number;
  pair1_games: number | null;
  pair2_games: number | null;
  set_score: string | null;
  is_current: boolean | null;
}

interface FakeInputs {
  matches: MatchSeed[];
  sets: SetSeed[];
  now?: number; // fixed clock for determinism
}

function fakeSupabase(inputs: FakeInputs) {
  const matches = [...inputs.matches];
  const sets = [...inputs.sets];
  const now = inputs.now ?? Date.parse('2026-04-22T20:00:00.000Z');

  const matchUpdates: Array<{ id: string; patch: any; guardStatuses: string[] }> = [];
  const setUpserts: Array<any> = [];
  const gameUpdates: Array<{ matchId: string; patch: any }> = [];

  function matchesSelect() {
    // Two query shapes, sharing `.in('status', [...])`:
    //   Path A (stale): .in(status).lt('updated_at').or('started_at.not.is.null,scheduled_at.lt.<now>').order().limit()
    //   Path B (regression repair, added 2026-04-23):
    //     .in(status).not('finished_at', 'is', null).order('finished_at').limit()
    const toRow = (m: any) => ({
      id: m.id,
      status: m.status,
      scheduled_at: m.scheduled_at,
      updated_at: m.updated_at,
      started_at: m.started_at ?? null,
      duration: m.duration ?? null,
      finished_at: m.finished_at ?? null,
    });
    return {
      in: (col1: string, statuses: string[]) => {
        if (col1 !== 'status') throw new Error(`unexpected .in: ${col1}`);

        // ── Path A ──────────────────────────────────────────────
        const pathA = {
          lt: (col2: string, updatedCutoff: string) => {
            if (col2 !== 'updated_at') throw new Error(`unexpected .lt: ${col2}`);
            return {
              // `.or('started_at.not.is.null,scheduled_at.lt.<nowIso>')` —
              // the "started" predicate. Parse the two terms generically so
              // the fake mirrors the production query rather than hard-coding.
              or: (expr: string) => {
                const terms = expr.split(',');
                const startedPredicate = (m: MatchSeed): boolean =>
                  terms.some((term) => {
                    if (term === 'started_at.not.is.null') {
                      return m.started_at !== null && m.started_at !== undefined;
                    }
                    const lt = term.match(/^scheduled_at\.lt\.(.+)$/);
                    if (lt) {
                      const cutoff = lt[1]!;
                      return m.scheduled_at !== null && m.scheduled_at < cutoff;
                    }
                    throw new Error(`unexpected .or term: ${term}`);
                  });
                return {
                  order: (_c: string, _opts: any) => ({
                    limit: (n: number) => {
                      const filtered = matches
                        .filter((m) => statuses.includes(m.status))
                        .filter(
                          (m) => m.updated_at !== null && m.updated_at < updatedCutoff,
                        )
                        .filter(startedPredicate)
                        .sort((a, b) =>
                          (a.updated_at ?? '').localeCompare(b.updated_at ?? ''),
                        )
                        .slice(0, n)
                        .map(toRow);
                      return Promise.resolve({ data: filtered, error: null });
                    },
                  }),
                };
              },
            };
          },
          // ── Path B ────────────────────────────────────────────
          not: (col2: string, op: string, value: unknown) => {
            if (col2 !== 'finished_at' || op !== 'is' || value !== null) {
              throw new Error(`unexpected .not: ${col2} ${op} ${String(value)}`);
            }
            return {
              order: (_c: string, _opts: any) => ({
                limit: (n: number) => {
                  const filtered = matches
                    .filter((m) => statuses.includes(m.status))
                    .filter((m) => m.finished_at !== null && m.finished_at !== undefined)
                    .sort((a, b) =>
                      (a.finished_at ?? '').localeCompare(b.finished_at ?? ''),
                    )
                    .slice(0, n)
                    .map(toRow);
                  return Promise.resolve({ data: filtered, error: null });
                },
              }),
            };
          },
        };
        return pathA;
      },
    };
  }

  function matchesUpdate(patch: any) {
    return {
      eq: (col: string, id: string) => {
        if (col !== 'id') throw new Error(`unexpected matches update eq: ${col}`);
        return {
          in: (col2: string, vals: string[]) => {
            if (col2 !== 'status')
              throw new Error(`unexpected matches update .in: ${col2}`);
            // Race-check: only apply if the current status is in vals.
            const target = matches.find((m) => m.id === id);
            if (target && vals.includes(target.status)) {
              target.status = patch.status ?? target.status;
              matchUpdates.push({ id, patch, guardStatuses: vals });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
  }

  function setsTable() {
    return {
      select: (_cols: string) => ({
        in: (col: string, vals: string[]) => {
          if (col !== 'match_id') throw new Error(`unexpected sets .in: ${col}`);
          const data = sets.filter((s) => vals.includes(s.match_id));
          return Promise.resolve({ data, error: null });
        },
      }),
      upsert: (row: any, _opts: any) => {
        setUpserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function gamesTable() {
    return {
      update: (patch: any) => ({
        eq: (col1: string, matchId: string) => ({
          eq: (col2: string, _val: any) => {
            if (col1 !== 'match_id' || col2 !== 'is_current') {
              throw new Error(`unexpected games update eq: ${col1}/${col2}`);
            }
            gameUpdates.push({ matchId, patch });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    };
  }

  return {
    matchUpdates,
    setUpserts,
    gameUpdates,
    now,
    from: (t: string) => {
      if (t === 'matches')
        return {
          select: (_cols: string) => matchesSelect(),
          update: (patch: any) => matchesUpdate(patch),
        };
      if (t === 'sets') return setsTable();
      if (t === 'games') return gamesTable();
      throw new Error(`unexpected table: ${t}`);
    },
  };
}

const NOW = Date.parse('2026-04-22T20:00:00.000Z');
const STALE_IS0 = new Date(NOW - 30 * 60_000).toISOString(); // 30 min old
const SCHEDULED_IS0 = new Date(NOW - 90 * 60_000).toISOString(); // 90 min ago
const FRESH_ISO = new Date(NOW - 5 * 60_000).toISOString(); // 5 min old

describe('runCloseStaleLiveSweeper', () => {
  it('no candidates → no-op', async () => {
    const supabase = fakeSupabase({ matches: [], sets: [], now: NOW });
    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });
    expect(result.candidatesConsidered).toBe(0);
    expect(result.matchesClosed).toBe(0);
  });

  it('fresh match (updated 5 min ago) is skipped — below stale threshold', async () => {
    const supabase = fakeSupabase({
      matches: [
        {
          id: 'm-fresh',
          status: 'live',
          scheduled_at: SCHEDULED_IS0,
          updated_at: FRESH_ISO,
        },
      ],
      sets: [
        { match_id: 'm-fresh', set_number: 1, pair1_games: 6, pair2_games: 3, set_score: '6-3', is_current: false },
        { match_id: 'm-fresh', set_number: 2, pair1_games: 6, pair2_games: 2, set_score: '6-2', is_current: true },
      ],
      now: NOW,
    });
    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });
    expect(result.candidatesConsidered).toBe(0);
    expect(supabase.matchUpdates).toHaveLength(0);
  });

  it('future-scheduled match is skipped (scheduled_at in future)', async () => {
    const supabase = fakeSupabase({
      matches: [
        {
          id: 'm-future',
          status: 'live',
          scheduled_at: new Date(NOW + 30 * 60_000).toISOString(),
          updated_at: STALE_IS0,
        },
      ],
      sets: [],
      now: NOW,
    });
    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });
    expect(result.candidatesConsidered).toBe(0);
  });

  it('finished/walkover/retired matches are never candidates (idempotency guard)', async () => {
    const supabase = fakeSupabase({
      matches: [
        {
          id: 'm-done',
          status: 'finished',
          scheduled_at: SCHEDULED_IS0,
          updated_at: STALE_IS0,
        },
        {
          id: 'm-ret',
          status: 'retired',
          scheduled_at: SCHEDULED_IS0,
          updated_at: STALE_IS0,
        },
        {
          id: 'm-wo',
          status: 'walkover',
          scheduled_at: SCHEDULED_IS0,
          updated_at: STALE_IS0,
        },
      ],
      sets: [],
      now: NOW,
    });
    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });
    expect(result.candidatesConsidered).toBe(0);
    expect(supabase.matchUpdates).toHaveLength(0);
  });

  it('stale match with decisive 2-set lead → closed, winner_pair=1, is_current cleared', async () => {
    const supabase = fakeSupabase({
      matches: [
        {
          id: 'm-stale-1',
          status: 'live',
          scheduled_at: SCHEDULED_IS0,
          updated_at: STALE_IS0,
          started_at: new Date(NOW - 80 * 60_000).toISOString(),
          duration: '01:20',
        },
      ],
      sets: [
        { match_id: 'm-stale-1', set_number: 1, pair1_games: 6, pair2_games: 3, set_score: '6-3', is_current: false },
        { match_id: 'm-stale-1', set_number: 2, pair1_games: 6, pair2_games: 2, set_score: '6-2', is_current: true },
      ],
      now: NOW,
    });

    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });

    expect(result.matchesClosed).toBe(1);
    expect(result.matchesIndecisive).toBe(0);

    const update = supabase.matchUpdates[0]!;
    expect(update.id).toBe('m-stale-1');
    expect(update.patch.status).toBe('finished');
    expect(update.patch.winner_pair).toBe(1);
    expect(update.patch.last_updated_by).toBe('padelgod-sweeper');
    expect(update.guardStatuses).toEqual(['live', 'ended']);

    // 2 sets upserted with is_current=false.
    expect(supabase.setUpserts).toHaveLength(2);
    for (const row of supabase.setUpserts) {
      expect(row.is_current).toBe(false);
    }

    // Games is_current cleared.
    expect(supabase.gameUpdates).toHaveLength(1);
    expect(supabase.gameUpdates[0]!.patch.is_current).toBe(false);
  });

  // Was: "extrapolates trailing in-progress set (6-3, 5-0) → (6-3, 6-0)".
  // The sweeper used to count an in-progress trailing set as a win when one
  // team was clearly leading, then extrapolate it to a final score. That
  // aggressive inference produced the 2026-05-16 Buenos Aires P1 incident
  // (mid-third-set 3-5 got auto-closed). inferWinnerFromSets is now strict
  // — only completed sets count — so the sweeper leaves these matches alone
  // and lets a real terminal signal (widget status / retired_pair / oop)
  // close them. Trade-off: a small number of genuinely stuck stale matches
  // need manual closure, but we never wrong-close a live match.
  it('does NOT close on a trailing in-progress set even with a clear lead (6-3, 5-0)', async () => {
    const supabase = fakeSupabase({
      matches: [
        {
          id: 'm-extrap',
          status: 'live',
          scheduled_at: SCHEDULED_IS0,
          updated_at: STALE_IS0,
        },
      ],
      sets: [
        { match_id: 'm-extrap', set_number: 1, pair1_games: 6, pair2_games: 3, set_score: '6-3', is_current: false },
        { match_id: 'm-extrap', set_number: 2, pair1_games: 5, pair2_games: 0, set_score: null, is_current: true },
      ],
      now: NOW,
    });

    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });

    expect(result.matchesClosed).toBe(0);
    expect(result.matchesIndecisive).toBe(1);
    expect(supabase.matchUpdates).toHaveLength(0);
    expect(supabase.setUpserts).toHaveLength(0);
  });

  it('PATH A: stale started match with NULL scheduled_at is still swept (started_at present)', async () => {
    // Incident 2026-05-31: a Q1 match (ITALY MAJOR) sat stuck at status=live
    // with scheduled_at=NULL. Path A's `scheduled_at < now` filter evaluates
    // to NULL/false for NULL scheduled_at, so the safety-net sweeper couldn't
    // see it. A match with started_at set HAS started and must be sweepable
    // even without a scheduled time. Two completed sets → decisive (no
    // reliance on in-progress leads).
    const supabase = fakeSupabase({
      matches: [
        {
          id: 'm-null-sched',
          status: 'live',
          scheduled_at: null,
          updated_at: STALE_IS0,
          started_at: new Date(NOW - 80 * 60_000).toISOString(),
          duration: '01:20',
        },
      ],
      sets: [
        { match_id: 'm-null-sched', set_number: 1, pair1_games: 6, pair2_games: 3, set_score: '6-3', is_current: false },
        { match_id: 'm-null-sched', set_number: 2, pair1_games: 6, pair2_games: 2, set_score: '6-2', is_current: false },
      ],
      now: NOW,
    });

    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });

    expect(result.candidatesConsidered).toBe(1);
    expect(result.matchesClosed).toBe(1);
    expect(supabase.matchUpdates[0]!.patch.status).toBe('finished');
    expect(supabase.matchUpdates[0]!.patch.winner_pair).toBe(1);
  });

  it('PATH A: match with NULL scheduled_at AND NULL started_at (never started) is NOT swept', async () => {
    // Safety: broadening Path A to started-but-unscheduled must NOT also
    // pull in matches that never started. started_at NULL + scheduled_at
    // NULL means we have no evidence the match began — leave it alone.
    const supabase = fakeSupabase({
      matches: [
        {
          id: 'm-never-started',
          status: 'live',
          scheduled_at: null,
          updated_at: STALE_IS0,
          // started_at intentionally omitted (null)
        },
      ],
      sets: [
        { match_id: 'm-never-started', set_number: 1, pair1_games: 6, pair2_games: 3, set_score: '6-3', is_current: false },
        { match_id: 'm-never-started', set_number: 2, pair1_games: 6, pair2_games: 2, set_score: '6-2', is_current: false },
      ],
      now: NOW,
    });

    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });

    expect(result.candidatesConsidered).toBe(0);
    expect(result.matchesClosed).toBe(0);
    expect(supabase.matchUpdates).toHaveLength(0);
  });

  it('indecisive sets (1-all in set 1, mid-set 2) → skipped, logged, not closed', async () => {
    const supabase = fakeSupabase({
      matches: [
        {
          id: 'm-indecisive',
          status: 'live',
          scheduled_at: SCHEDULED_IS0,
          updated_at: STALE_IS0,
        },
      ],
      sets: [
        { match_id: 'm-indecisive', set_number: 1, pair1_games: 3, pair2_games: 3, set_score: null, is_current: true },
      ],
      now: NOW,
    });

    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });

    expect(result.candidatesConsidered).toBe(1);
    expect(result.matchesClosed).toBe(0);
    expect(result.matchesIndecisive).toBe(1);
    expect(supabase.matchUpdates).toHaveLength(0);
    expect(supabase.setUpserts).toHaveLength(0);
  });

  it('preserves existing finished_at if already set by live-poller', async () => {
    const preExistingFinishedAt = new Date(NOW - 60 * 60_000).toISOString();
    const supabase = fakeSupabase({
      matches: [
        {
          id: 'm-has-finished-at',
          status: 'ended',
          scheduled_at: SCHEDULED_IS0,
          updated_at: STALE_IS0,
          finished_at: preExistingFinishedAt,
        },
      ],
      sets: [
        { match_id: 'm-has-finished-at', set_number: 1, pair1_games: 6, pair2_games: 4, set_score: '6-4', is_current: false },
        { match_id: 'm-has-finished-at', set_number: 2, pair1_games: 7, pair2_games: 5, set_score: '7-5', is_current: false },
      ],
      now: NOW,
    });

    await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });

    const update = supabase.matchUpdates[0]!;
    expect(update.patch.finished_at).toBe(preExistingFinishedAt);
  });

  it('respects maxMatchesPerRun cap', async () => {
    const stales: MatchSeed[] = [];
    const setRows: SetSeed[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `m-${i}`;
      stales.push({
        id,
        status: 'live',
        scheduled_at: SCHEDULED_IS0,
        // Slightly different updated_at so ordering is stable.
        updated_at: new Date(NOW - (30 + i) * 60_000).toISOString(),
      });
      setRows.push(
        { match_id: id, set_number: 1, pair1_games: 6, pair2_games: 3, set_score: '6-3', is_current: false },
        { match_id: id, set_number: 2, pair1_games: 6, pair2_games: 2, set_score: '6-2', is_current: false },
      );
    }
    const supabase = fakeSupabase({ matches: stales, sets: setRows, now: NOW });

    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
      maxMatchesPerRun: 2,
    });

    expect(result.candidatesConsidered).toBe(2);
    expect(result.matchesClosed).toBe(2);
  });

  // ── Path B: regression repair (added 2026-04-23) ──
  //
  // A match was closed properly by live-poller (finished_at written), but
  // a subsequent writer — sync-matches, scores cron, or a pre-guard
  // static-reconciler — reverted status to 'live' without touching
  // finished_at. The sweeper must re-close it within one tick regardless
  // of staleness, because the finished_at signal is unambiguous evidence
  // the match is terminal.

  it('PATH B: match with finished_at set but status=live is closed immediately (no staleness wait)', async () => {
    // Fresh updated_at — Path A would skip this (not stale). Only Path B
    // catches it, via the finished_at-is-not-null signal.
    const freshUpdatedAt = new Date(NOW - 2 * 60_000).toISOString(); // 2 min ago
    const finishedAtMark = new Date(NOW - 30 * 60_000).toISOString(); // 30 min ago
    const supabase = fakeSupabase({
      matches: [
        {
          id: 'm-regression',
          status: 'live',                 // ← regression state
          scheduled_at: SCHEDULED_IS0,
          updated_at: freshUpdatedAt,     // ← not stale, Path A would skip
          finished_at: finishedAtMark,    // ← Path B triggers on this
        },
      ],
      sets: [
        { match_id: 'm-regression', set_number: 1, pair1_games: 6, pair2_games: 2, set_score: '6-2', is_current: false },
        { match_id: 'm-regression', set_number: 2, pair1_games: 6, pair2_games: 0, set_score: '6-0', is_current: false },
      ],
      now: NOW,
    });

    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });

    expect(result.candidatesConsidered).toBe(1);
    expect(result.matchesClosed).toBe(1);
    const update = supabase.matchUpdates[0]!;
    expect(update.patch.status).toBe('finished');
    expect(update.patch.winner_pair).toBe(1);
    // Preserves the original finished_at (never overwritten) — matches
    // the existing "preserves existing finished_at" semantics.
    expect(update.patch.finished_at).toBe(finishedAtMark);
  });

  it('PATH B: match with finished_at but status=finished already is NOT a candidate (idempotent)', async () => {
    // Already correctly closed — neither path should pick it up.
    const supabase = fakeSupabase({
      matches: [
        {
          id: 'm-already-done',
          status: 'finished',                // ← terminal
          scheduled_at: SCHEDULED_IS0,
          updated_at: new Date(NOW - 2 * 60_000).toISOString(),
          finished_at: new Date(NOW - 10 * 60_000).toISOString(),
        },
      ],
      sets: [],
      now: NOW,
    });

    const result = await runCloseStaleLiveSweeper({
      supabase: supabase as any,
      nowMs: () => NOW,
    });

    expect(result.candidatesConsidered).toBe(0);
    expect(result.matchesClosed).toBe(0);
  });
});
