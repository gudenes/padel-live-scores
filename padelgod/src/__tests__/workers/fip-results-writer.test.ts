import { describe, it, expect, vi } from 'vitest';
import {
  runFipResultsWriter,
  computeFinishedAt,
} from '../../workers/fip-results-writer.js';

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

  const resultsSnapshotsTable = () => ({
    select: (_cols: string) => ({
      eq: (col: string, val: string) => {
        const data = resultsRows.filter(
          (r) => col !== 'tournament_id' || r.tournament_id === val
        );
        return Promise.resolve({ data, error: null });
      },
    }),
  });

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
