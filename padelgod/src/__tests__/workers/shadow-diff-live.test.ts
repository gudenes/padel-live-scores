import { describe, it, expect } from 'vitest';
import { runShadowDiffLive } from '../../workers/shadow-diff-live.js';

interface TournamentSeed {
  id: string;
  shadow_enabled: boolean;
}

interface MatchSeed {
  id: string;
  tournament_id: string;
  status: string;
}

interface PublicSetSeed {
  match_id: string;
  set_number: number;
  updated_at: string;
}

interface ShadowSetSeed {
  match_id: string;
  set_number: number;
  updated_at: string;
}

interface FakeInputs {
  tournaments: TournamentSeed[];
  matches: MatchSeed[];
  publicSets: PublicSetSeed[];
  shadowSets: ShadowSetSeed[];
}

function fakeSupabase(inputs: Partial<FakeInputs> = {}) {
  const tournaments = inputs.tournaments ?? [];
  const matches = inputs.matches ?? [];
  const publicSets = inputs.publicSets ?? [];
  const shadowSets = inputs.shadowSets ?? [];

  const shadowDiffInserted: any[] = [];

  function tournamentsTable() {
    return {
      select: (_cols: string) => ({
        eq: (col: string, val: any) => {
          if (col !== 'shadow_enabled')
            throw new Error(`unexpected tournaments filter: ${col}`);
          const data = tournaments
            .filter((t) => t.shadow_enabled === val)
            .map((t) => ({ id: t.id }));
          return Promise.resolve({ data, error: null });
        },
      }),
    };
  }

  function matchesTable() {
    return {
      select: (_cols: string) => ({
        in: (col1: string, vals1: any[]) => ({
          in: (col2: string, vals2: any[]) => {
            if (col1 !== 'status')
              throw new Error(`unexpected matches filter 1: ${col1}`);
            if (col2 !== 'tournament_id')
              throw new Error(`unexpected matches filter 2: ${col2}`);
            const data = matches
              .filter(
                (m) => vals1.includes(m.status) && vals2.includes(m.tournament_id)
              )
              .map((m) => ({
                id: m.id,
                tournament_id: m.tournament_id,
              }));
            return Promise.resolve({ data, error: null });
          },
        }),
      }),
    };
  }

  function publicSetsTable() {
    return {
      select: (_cols: string) => ({
        eq: (col: string, val: string) => {
          if (col !== 'match_id')
            throw new Error(`unexpected sets filter: ${col}`);
          const rows = publicSets.filter((s) => s.match_id === val);
          const sorted = [...rows].sort(
            (a, b) => b.set_number - a.set_number
          );
          return {
            order: (_c: string, _opts: any) => ({
              limit: (n: number) =>
                Promise.resolve({ data: sorted.slice(0, n), error: null }),
            }),
          };
        },
      }),
    };
  }

  function shadowSetsTable() {
    return {
      select: (_cols: string) => ({
        eq: (col: string, val: string) => {
          if (col !== 'match_id')
            throw new Error(`unexpected shadow_sets filter: ${col}`);
          const rows = shadowSets.filter((s) => s.match_id === val);
          const sorted = [...rows].sort(
            (a, b) => b.set_number - a.set_number
          );
          return {
            order: (_c: string, _opts: any) => ({
              limit: (n: number) =>
                Promise.resolve({ data: sorted.slice(0, n), error: null }),
            }),
          };
        },
      }),
    };
  }

  function shadowDiffTable() {
    return {
      insert: (row: any) => {
        shadowDiffInserted.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  return {
    shadowDiffInserted,
    schema: (_name: string) => ({
      from: (t: string) => {
        if (t === 'shadow_sets') return shadowSetsTable();
        if (t === 'shadow_diff') return shadowDiffTable();
        throw new Error(`unexpected padelgod-schema table: ${t}`);
      },
    }),
    from: (t: string) => {
      if (t === 'tournaments') return tournamentsTable();
      if (t === 'matches') return matchesTable();
      if (t === 'sets') return publicSetsTable();
      throw new Error(`unexpected public-schema table: ${t}`);
    },
  };
}

const fakeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
} as any;

const TOUR = 'tour-1';
const MATCH = 'match-1';

describe('runShadowDiffLive', () => {
  it('no shadow-enrolled tournaments → 0 rowsWritten, 0 matchesConsidered', async () => {
    const supabase = fakeSupabase({
      tournaments: [{ id: TOUR, shadow_enabled: false }],
      matches: [{ id: MATCH, tournament_id: TOUR, status: 'live' }],
    });
    const result = await runShadowDiffLive({
      supabase: supabase as any,
      logger: fakeLogger,
    });
    expect(result.rowsWritten).toBe(0);
    expect(result.matchesConsidered).toBe(0);
    expect(supabase.shadowDiffInserted).toHaveLength(0);
  });

  it('live match with both sides → writes 1 live_latency row with correct delta', async () => {
    // padelapi wrote at T+0, padelgod wrote at T+1500 → padelgod is 1500ms slower.
    const padelapiTs = '2026-04-20T12:00:00.000Z';
    const padelgodTs = '2026-04-20T12:00:01.500Z';
    const supabase = fakeSupabase({
      tournaments: [{ id: TOUR, shadow_enabled: true }],
      matches: [{ id: MATCH, tournament_id: TOUR, status: 'live' }],
      publicSets: [
        { match_id: MATCH, set_number: 1, updated_at: padelapiTs },
      ],
      shadowSets: [
        { match_id: MATCH, set_number: 1, updated_at: padelgodTs },
      ],
    });
    const result = await runShadowDiffLive({
      supabase: supabase as any,
      logger: fakeLogger,
    });
    expect(result.matchesConsidered).toBe(1);
    expect(result.rowsWritten).toBe(1);
    expect(supabase.shadowDiffInserted).toHaveLength(1);
    const row = supabase.shadowDiffInserted[0];
    expect(row.comparison_type).toBe('live_latency');
    expect(row.tournament_id).toBe(TOUR);
    expect(row.match_id).toBe(MATCH);
    expect(row.padelapi_updated_at).toBe(padelapiTs);
    expect(row.padelgod_updated_at).toBe(padelgodTs);
    expect(row.latency_delta_ms).toBe(1500);
  });

  it('skips match when public.sets has no row', async () => {
    const supabase = fakeSupabase({
      tournaments: [{ id: TOUR, shadow_enabled: true }],
      matches: [{ id: MATCH, tournament_id: TOUR, status: 'live' }],
      publicSets: [], // no relay-side row yet
      shadowSets: [
        {
          match_id: MATCH,
          set_number: 1,
          updated_at: '2026-04-20T12:00:00.000Z',
        },
      ],
    });
    const result = await runShadowDiffLive({
      supabase: supabase as any,
      logger: fakeLogger,
    });
    expect(result.matchesConsidered).toBe(1);
    expect(result.rowsWritten).toBe(0);
    expect(supabase.shadowDiffInserted).toHaveLength(0);
  });

  it('skips match when padelgod.shadow_sets has no row', async () => {
    const supabase = fakeSupabase({
      tournaments: [{ id: TOUR, shadow_enabled: true }],
      matches: [{ id: MATCH, tournament_id: TOUR, status: 'live' }],
      publicSets: [
        {
          match_id: MATCH,
          set_number: 1,
          updated_at: '2026-04-20T12:00:00.000Z',
        },
      ],
      shadowSets: [], // padelgod hasn't written yet
    });
    const result = await runShadowDiffLive({
      supabase: supabase as any,
      logger: fakeLogger,
    });
    expect(result.matchesConsidered).toBe(1);
    expect(result.rowsWritten).toBe(0);
    expect(supabase.shadowDiffInserted).toHaveLength(0);
  });

  it('negative delta when padelgod is faster than relay', async () => {
    // padelapi wrote at T+800, padelgod wrote at T+0 → padelgod is 800ms faster
    const padelapiTs = '2026-04-20T12:00:00.800Z';
    const padelgodTs = '2026-04-20T12:00:00.000Z';
    const supabase = fakeSupabase({
      tournaments: [{ id: TOUR, shadow_enabled: true }],
      matches: [{ id: MATCH, tournament_id: TOUR, status: 'live' }],
      publicSets: [
        { match_id: MATCH, set_number: 1, updated_at: padelapiTs },
      ],
      shadowSets: [
        { match_id: MATCH, set_number: 1, updated_at: padelgodTs },
      ],
    });
    const result = await runShadowDiffLive({
      supabase: supabase as any,
      logger: fakeLogger,
    });
    expect(result.rowsWritten).toBe(1);
    const row = supabase.shadowDiffInserted[0];
    expect(row.latency_delta_ms).toBe(-800);
  });
});
