import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  runFipResultsWriter,
  computeFinishedAt,
} from '../../workers/fip-results-writer.js';

// All snapshot fixtures in this file use captured_at on 2026-04-24. The
// writer filters results_snapshots to the last 24h, so we freeze the
// clock here to make sure those fixtures fall inside the window.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-24T16:30:00.000Z'));
});
afterAll(() => {
  vi.useRealTimers();
});

const TOURNAMENT_ID = 't-isla';
const TOURNAMENT_SLUG = 'fip-bronze-aquahobby-isla-de-la-palma-2026';
const TOURNAMENT_WIDGET = 'FIP-2026-1706';

interface ResultsSeed {
  tournament_id: string;
  match_widget_id: string | null;
  category: 'men' | 'women';
  day_number?: number;
  round_label: string | null;
  court: string | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  set_scores: string | null;
  winner_team: 1 | 2 | null;
  status: 'finished' | 'walkover' | 'retired';
  captured_at: string;
}

interface ExistingMatchSeed {
  id: string;
  widget_id_composite: string;
  status: string | null;
  winner_pair: number | null;
  duration: string | null;
  finished_at: string | null;
  started_at: string | null;
}

interface Options {
  tournaments?: Array<{
    tournament_id: string;
    tournament_name: string;
    slug: string;
  }>;
  widgetCodeByTournament?: Record<string, string | null>;
  resultsRows?: ResultsSeed[];
  existingMatches?: ExistingMatchSeed[];
  tournamentStartsAtById?: Record<string, string | null>;
}

function fakeSupabase(opts: Options) {
  const tournaments = opts.tournaments ?? [];
  const widgetCode = opts.widgetCodeByTournament ?? {};
  const resultsRows = opts.resultsRows ?? [];
  const existing: ExistingMatchSeed[] = [...(opts.existingMatches ?? [])];
  const startsAtById = opts.tournamentStartsAtById ?? {};

  const updated: Array<{ id: string; patch: Record<string, unknown>; terminalGuard: string[] }> = [];
  const setsUpserted: any[] = [];

  const matchesTable = () => ({
    select: (_cols: string) => ({
      like: (_col: string, pattern: string) => {
        const prefix = pattern.slice(0, -1);
        const data = existing.filter((m) =>
          m.widget_id_composite.startsWith(prefix)
        );
        return Promise.resolve({ data, error: null });
      },
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: (col: string, val: string) => {
        if (col !== 'id') throw new Error(`unexpected UPDATE filter: ${col}`);
        const chain = {
          in: (_c: string, values: string[]) => {
            // Simulate the terminal-status guard — the UPDATE only fires
            // when the current status is one of the allowed values. We
            // record the guard but don't actually enforce it here since
            // the worker already checked; test asserts the guard was set.
            updated.push({ id: val, patch, terminalGuard: values });
            return Promise.resolve({ data: null, error: null });
          },
          then: (resolve: (v: any) => void) => {
            // Shouldn't be used by this worker; log a loud failure if so.
            updated.push({ id: val, patch, terminalGuard: [] });
            return Promise.resolve({ data: null, error: null }).then(resolve);
          },
        };
        return chain;
      },
    }),
  });

  const setsTable = () => ({
    upsert: (row: any, _opts: any) => {
      setsUpserted.push(row);
      return Promise.resolve({ data: null, error: null });
    },
  });

  // Tracks page sizes the worker actually requested so tests can assert
  // pagination is happening (regression for the PostgREST 10k-cap bug).
  const resultsSnapshotPages: Array<{ start: number; end: number; rows: number }> = [];

  const resultsSnapshotsTable = () => {
    let tournamentId: string | null = null;
    let sinceIso: string | null = null;
    let orderDesc = false;
    const builder = {
      select: (_cols: string) => builder,
      eq: (col: string, val: string) => {
        if (col === 'tournament_id') tournamentId = val;
        return builder;
      },
      gte: (col: string, val: string) => {
        if (col === 'captured_at') sinceIso = val;
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        if (col === 'captured_at' && opts?.ascending === false) orderDesc = true;
        return builder;
      },
      range: (start: number, end: number) => {
        const filtered = resultsRows.filter((r) => {
          if (tournamentId !== null && r.tournament_id !== tournamentId) return false;
          if (sinceIso !== null && r.captured_at < sinceIso) return false;
          return true;
        });
        // Match PostgREST `.order()` semantics: rows return in the
        // requested order. Without an order clause we preserve insertion
        // order (which is what the bug case relies on).
        const ordered = orderDesc
          ? [...filtered].sort((a, b) => (a.captured_at < b.captured_at ? 1 : -1))
          : filtered;
        const page = ordered.slice(start, end + 1);
        resultsSnapshotPages.push({ start, end, rows: page.length });
        return Promise.resolve({ data: page, error: null });
      },
    } as any;
    return builder;
  };

  const widgetIdCacheTable = () => ({
    select: (_cols: string) => ({
      eq: (_c1: string, v1: string) => ({
        eq: (_c2: string, _v2: boolean) => ({
          maybeSingle: () => {
            const code = widgetCode[v1];
            return Promise.resolve({
              data: code ? { widget_id: code } : null,
              error: null,
            });
          },
        }),
      }),
    }),
  });

  return {
    updated,
    setsUpserted,
    resultsSnapshotPages,
    schema: (_name: string) => ({
      from: (t: string) => {
        if (t === 'results_snapshots') return resultsSnapshotsTable();
        if (t === 'widget_id_cache') return widgetIdCacheTable();
        throw new Error(`unexpected padelgod table: ${t}`);
      },
    }),
    from: (t: string) => {
      if (t === 'matches') return matchesTable();
      if (t === 'sets') return setsTable();
      if (t === 'tournaments') {
        return {
          select: (_cols: string) => ({
            in: (_col: string, ids: string[]) => {
              const data = ids.map((id) => ({
                id,
                starts_at: startsAtById[id] ?? null,
              }));
              return Promise.resolve({ data, error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected public table: ${t}`);
    },
    rpc: vi.fn(async (name: string) => {
      if (name !== 'padelgod_active_tournaments_with_slug') {
        throw new Error(`unexpected RPC: ${name}`);
      }
      return { data: tournaments, error: null };
    }),
  };
}

// ── computeFinishedAt (pure helper) ─────────────────────────────────────

describe('computeFinishedAt', () => {
  it('started_at + duration → exact finish time', () => {
    const ts = computeFinishedAt(
      { started_at: '2026-04-24T14:00:00.000Z', duration: '01:23' },
      '2026-04-24T16:00:00.000Z',
    );
    expect(ts).toBe('2026-04-24T15:23:00.000Z');
  });

  it('fallback to captured_at when duration missing', () => {
    const ts = computeFinishedAt(
      { started_at: '2026-04-24T14:00:00.000Z', duration: null },
      '2026-04-24T16:00:00.000Z',
    );
    expect(ts).toBe('2026-04-24T16:00:00.000Z');
  });

  it('fallback to captured_at when duration is malformed', () => {
    const ts = computeFinishedAt(
      { started_at: '2026-04-24T14:00:00.000Z', duration: 'garbage' },
      '2026-04-24T16:00:00.000Z',
    );
    expect(ts).toBe('2026-04-24T16:00:00.000Z');
  });

  it('fallback to captured_at when started_at missing', () => {
    const ts = computeFinishedAt(
      { started_at: null, duration: '01:00' },
      '2026-04-24T16:00:00.000Z',
    );
    expect(ts).toBe('2026-04-24T16:00:00.000Z');
  });
});

// ── runFipResultsWriter ────────────────────────────────────────────────

const isla = {
  tournament_id: TOURNAMENT_ID,
  tournament_name: 'Isla',
  slug: TOURNAMENT_SLUG,
};

const md017Finished: ResultsSeed = {
  tournament_id: TOURNAMENT_ID,
  match_widget_id: 'MD017',
  category: 'men',
  round_label: 'Round of 32',
  court: 'CLUB, PISTA OMEYA',
  team1_player1_name: 'N. Baptista',
  team1_player2_name: 'D. Fernandes',
  team2_player1_name: 'J. Montalban',
  team2_player2_name: 'G. Rodriguez',
  set_scores: '0-6 2-6',
  winner_team: 2,
  status: 'finished',
  captured_at: '2026-04-24T16:00:00.000Z',
};

const md017Existing: ExistingMatchSeed = {
  id: 'm-md017',
  widget_id_composite: 'FIP-2026-1706:MD017',
  status: 'scheduled',
  winner_pair: null,
  duration: null,
  finished_at: null,
  started_at: null,
};

describe('runFipResultsWriter', () => {
  it('UPDATEs status + winner_pair + finished_at + UPSERTs 2 sets', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      resultsRows: [md017Finished],
      existingMatches: [md017Existing],
    });

    const result = await runFipResultsWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.matchesUpdated).toBe(1);
    expect(result.setsWritten).toBe(2);
    expect(result.finishedAtBackfilled).toBe(1);

    expect(supabase.updated).toHaveLength(1);
    expect(supabase.updated[0].id).toBe('m-md017');
    const patch = supabase.updated[0].patch;
    expect(patch.status).toBe('finished');
    expect(patch.winner_pair).toBe(2);
    expect(patch.finished_at).toBe('2026-04-24T16:00:00.000Z'); // captured_at fallback (no started_at)
    expect(patch.last_updated_by).toBe('padelgod');

    // Terminal-status guard in the UPDATE
    expect(supabase.updated[0].terminalGuard).toEqual([
      'scheduled',
      'on_court',
      'live',
    ]);

    expect(supabase.setsUpserted).toHaveLength(2);
    expect(supabase.setsUpserted[0]).toMatchObject({
      match_id: 'm-md017',
      set_number: 1,
      set_score: '0-6',
      pair1_games: 0,
      pair2_games: 6,
      score_source: 'api',
    });
    expect(supabase.setsUpserted[1]).toMatchObject({
      match_id: 'm-md017',
      set_number: 2,
      set_score: '2-6',
      pair1_games: 2,
      pair2_games: 6,
    });
  });

  it('dry-run: ticks counters, writes nothing', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      resultsRows: [md017Finished],
      existingMatches: [md017Existing],
    });

    const result = await runFipResultsWriter({
      supabase: supabase as any,
      dryRun: true,
    });

    expect(result.matchesUpdated).toBe(1);
    expect(result.setsWritten).toBe(2);
    expect(result.dryRun).toBe(true);
    expect(supabase.updated).toHaveLength(0);
    expect(supabase.setsUpserted).toHaveLength(0);
  });

  it('SKIPs when match is already in a terminal status (regression guard)', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      resultsRows: [md017Finished],
      existingMatches: [{ ...md017Existing, status: 'finished' }],
    });

    const result = await runFipResultsWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedTerminalStatus).toBe(1);
    expect(result.matchesUpdated).toBe(0);
    expect(result.setsWritten).toBe(0);
    expect(supabase.updated).toHaveLength(0);
  });

  it('does NOT backfill finished_at when live-poller already set it', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      resultsRows: [md017Finished],
      existingMatches: [
        {
          ...md017Existing,
          finished_at: '2026-04-24T15:45:22.123Z',
        },
      ],
    });

    const result = await runFipResultsWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.finishedAtBackfilled).toBe(0);
    expect(supabase.updated[0].patch.finished_at).toBeUndefined();
  });

  it('SKIPs results rows when composite-keyed match does not exist yet', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      resultsRows: [md017Finished],
      existingMatches: [],
    });

    const result = await runFipResultsWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.skippedNoMatch).toBe(1);
    expect(result.matchesUpdated).toBe(0);
    expect(result.setsWritten).toBe(0);
  });

  it('SKIPs tournaments with no widget_id_cache row', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: {},
      resultsRows: [md017Finished],
      existingMatches: [md017Existing],
    });

    const result = await runFipResultsWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsSkippedNoWidget).toBe(1);
    expect(result.matchesUpdated).toBe(0);
  });

  it('parses tiebreak sets correctly: "7-6(3) 4-6 7-5" → 3 sets', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      resultsRows: [
        { ...md017Finished, set_scores: '7-6(3) 4-6 7-5' },
      ],
      existingMatches: [md017Existing],
    });

    const result = await runFipResultsWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.setsWritten).toBe(3);
    // First set — tiebreak loser-side digit preserved on set_score
    expect(supabase.setsUpserted[0]).toMatchObject({
      set_number: 1,
      set_score: '7-6(3)',
      pair1_games: 7,
      pair2_games: 6,
    });
  });

  it('uses started_at + duration to compute exact finished_at', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      resultsRows: [md017Finished],
      existingMatches: [
        {
          ...md017Existing,
          started_at: '2026-04-24T14:00:00.000Z',
          duration: '01:30',
        },
      ],
    });

    const result = await runFipResultsWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.finishedAtBackfilled).toBe(1);
    expect(supabase.updated[0].patch.finished_at).toBe(
      '2026-04-24T15:30:00.000Z',
    );
  });

  it('handles walkovers (winner_team set but set_scores empty)', async () => {
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      resultsRows: [
        {
          ...md017Finished,
          status: 'walkover',
          set_scores: '',
          winner_team: 1,
        },
      ],
      existingMatches: [md017Existing],
    });

    const result = await runFipResultsWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.matchesUpdated).toBe(1);
    expect(result.setsWritten).toBe(0);
    expect(supabase.updated[0].patch.status).toBe('walkover');
    expect(supabase.updated[0].patch.winner_pair).toBe(1);
  });

  it('paginates results_snapshots — finds the latest row even past 10k offset', async () => {
    // Regression for the PostgREST 10k-cap bug (FIP BRONZE LATINA
    // 2026-05-24): when a tournament's results_snapshots grows past the
    // server-side row cap, an unranged `.select()` silently truncates.
    // The dedup loop never sees today's finals and the matches stay on
    // `scheduled`. This test simulates 12,001 rows where the terminal
    // snapshot for MD017 sits at the very end of the table (oldest
    // captured_at in our seed list would be first under the old bug; we
    // intentionally put the terminal row AFTER the first page boundary
    // when sorted ascending, then assert the writer still surfaces it
    // via the new ORDER BY captured_at DESC + paginated read).
    const padding: ResultsSeed[] = [];
    for (let i = 0; i < 12_000; i++) {
      padding.push({
        tournament_id: TOURNAMENT_ID,
        match_widget_id: `PAD${i.toString().padStart(5, '0')}`,
        category: 'men',
        round_label: 'Round of 64',
        court: null,
        team1_player1_name: null,
        team1_player2_name: null,
        team2_player1_name: null,
        team2_player2_name: null,
        set_scores: '6-0 6-0',
        winner_team: 1,
        status: 'finished',
        // Inside the 24h lookback window (frozen "now" is
        // 2026-04-24T16:30Z) but older than the terminal MD017 snapshot
        // so the DESC sort puts MD017 at the very top of page 1.
        captured_at: '2026-04-24T10:00:00.000Z',
      });
    }
    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      resultsRows: [...padding, md017Finished], // md017 last in insertion order
      existingMatches: [md017Existing],
    });

    const result = await runFipResultsWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    // Pagination actually ran (more than one page round-trip).
    expect(supabase.resultsSnapshotPages.length).toBeGreaterThan(1);
    expect(supabase.resultsSnapshotPages[0].start).toBe(0);

    // MD017 was surfaced and applied despite the table being >10k rows.
    expect(result.matchesUpdated).toBe(1);
    expect(supabase.updated[0].id).toBe('m-md017');
    expect(supabase.updated[0].patch.status).toBe('finished');
    expect(supabase.updated[0].patch.winner_pair).toBe(2);
  });

  it('deduplicates to latest captured_at per match_widget_id', async () => {
    const older = { ...md017Finished, captured_at: '2026-04-24T15:00:00.000Z', winner_team: 1 as const };
    const newer = { ...md017Finished, captured_at: '2026-04-24T16:00:00.000Z', winner_team: 2 as const };

    const supabase = fakeSupabase({
      tournaments: [isla],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      // Deliberately insert in older-first order to ensure the dedupe
      // logic keeps the NEWER row regardless of iteration order.
      resultsRows: [older, newer],
      existingMatches: [md017Existing],
    });

    const result = await runFipResultsWriter({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.matchesUpdated).toBe(1);
    expect(supabase.updated[0].patch.winner_pair).toBe(2); // newer wins
  });
});
