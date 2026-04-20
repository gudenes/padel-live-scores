import { describe, it, expect } from 'vitest';
import { runShadowDiffFinalizer } from '../../workers/shadow-diff-finalizer.js';

interface TournamentSeed {
  id: string;
  shadow_enabled: boolean;
}

interface MatchSeed {
  id: string;
  tournament_id: string;
  status: string;
  winner_pair: number | null;
}

interface PublicSetSeed {
  id: string;
  match_id: string;
  set_number: number;
  set_score: string | null;
  pair1_games: number | null;
  pair2_games: number | null;
}

interface ShadowSetSeed {
  match_id: string;
  set_number: number;
  set_score: string | null;
  pair1_games: number | null;
  pair2_games: number | null;
}

interface PublicGameSeed {
  match_id: string;
  set_id: string;
  game_number: number;
  points: string[] | null;
}

interface ShadowMatchPointSeed {
  match_id: string;
  set_number: number;
  game_number: number;
  point_number: number;
  score_after: string;
}

interface ShadowDiffRowSeed {
  match_id: string;
  comparison_type: string;
}

interface FakeInputs {
  tournaments: TournamentSeed[];
  matches: MatchSeed[];
  publicSets: PublicSetSeed[];
  shadowSets: ShadowSetSeed[];
  publicGames: PublicGameSeed[];
  shadowMatchPoints: ShadowMatchPointSeed[];
  existingDiffs: ShadowDiffRowSeed[];
}

function fakeSupabase(inputs: Partial<FakeInputs> = {}) {
  const tournaments = inputs.tournaments ?? [];
  const matches = inputs.matches ?? [];
  const publicSets = inputs.publicSets ?? [];
  const shadowSets = inputs.shadowSets ?? [];
  const publicGames = inputs.publicGames ?? [];
  const shadowMatchPoints = inputs.shadowMatchPoints ?? [];
  const existingDiffs = inputs.existingDiffs ?? [];

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
        eq: (col1: string, val1: any) => ({
          in: (col2: string, vals: any[]) => {
            if (col1 !== 'status')
              throw new Error(`unexpected matches filter 1: ${col1}`);
            if (col2 !== 'tournament_id')
              throw new Error(`unexpected matches filter 2: ${col2}`);
            const data = matches
              .filter((m) => m.status === val1 && vals.includes(m.tournament_id))
              .map((m) => ({
                id: m.id,
                tournament_id: m.tournament_id,
                winner_pair: m.winner_pair,
              }));
            return Promise.resolve({ data, error: null });
          },
        }),
      }),
    };
  }

  function publicSetsTable() {
    return {
      select: (cols: string) => ({
        eq: (col: string, val: string) => {
          if (col !== 'match_id')
            throw new Error(`unexpected sets filter: ${col}`);
          const rows = publicSets.filter((s) => s.match_id === val);
          // Return either full rows or the (id, set_number) projection —
          // both calls paths exist in the worker.
          const projected = cols.includes('set_score')
            ? rows.map((r) => ({
                id: r.id,
                match_id: r.match_id,
                set_number: r.set_number,
                set_score: r.set_score,
                pair1_games: r.pair1_games,
                pair2_games: r.pair2_games,
              }))
            : rows.map((r) => ({ id: r.id, set_number: r.set_number }));
          const sorted = [...projected].sort(
            (a: any, b: any) => a.set_number - b.set_number
          );
          return {
            // Chainable order — returned when the worker calls .order()
            order: (_c: string, _opts: any) =>
              Promise.resolve({ data: sorted, error: null }),
            // Also resolve directly when the worker awaits without .order()
            then: (resolve: any) => resolve({ data: projected, error: null }),
          };
        },
      }),
    };
  }

  function publicGamesTable() {
    return {
      select: (_cols: string) => ({
        eq: (col: string, val: string) => {
          if (col !== 'match_id')
            throw new Error(`unexpected games filter: ${col}`);
          const rows = publicGames.filter((g) => g.match_id === val);
          return Promise.resolve({ data: rows, error: null });
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
            (a, b) => a.set_number - b.set_number
          );
          return {
            order: (_c: string, _opts: any) =>
              Promise.resolve({ data: sorted, error: null }),
          };
        },
      }),
    };
  }

  function shadowMatchPointsTable() {
    return {
      select: (_cols: string) => ({
        eq: (col: string, val: string) => {
          if (col !== 'match_id')
            throw new Error(`unexpected shadow_match_points filter: ${col}`);
          const rows = shadowMatchPoints.filter((p) => p.match_id === val);
          const sorted = [...rows].sort((a, b) => {
            if (a.set_number !== b.set_number)
              return a.set_number - b.set_number;
            if (a.game_number !== b.game_number)
              return a.game_number - b.game_number;
            return a.point_number - b.point_number;
          });
          return {
            order: (_c1: string, _o1: any) => ({
              order: (_c2: string, _o2: any) => ({
                order: (_c3: string, _o3: any) =>
                  Promise.resolve({ data: sorted, error: null }),
              }),
            }),
          };
        },
      }),
    };
  }

  function shadowDiffTable() {
    return {
      select: (_cols: string) => ({
        in: (col: string, vals: any[]) => {
          if (col !== 'match_id')
            throw new Error(`unexpected shadow_diff filter: ${col}`);
          const data = existingDiffs.filter((d) => vals.includes(d.match_id));
          return Promise.resolve({ data, error: null });
        },
      }),
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
        if (t === 'shadow_match_points') return shadowMatchPointsTable();
        if (t === 'shadow_diff') return shadowDiffTable();
        throw new Error(`unexpected padelgod-schema table: ${t}`);
      },
    }),
    from: (t: string) => {
      if (t === 'tournaments') return tournamentsTable();
      if (t === 'matches') return matchesTable();
      if (t === 'sets') return publicSetsTable();
      if (t === 'games') return publicGamesTable();
      throw new Error(`unexpected public-schema table: ${t}`);
    },
  };
}

const TOUR = 'tour-1';
const MATCH = 'match-1';

describe('runShadowDiffFinalizer', () => {
  it('no shadow-enrolled tournaments → 0 writes, 0 matches considered', async () => {
    const supabase = fakeSupabase({
      tournaments: [{ id: TOUR, shadow_enabled: false }],
      matches: [
        { id: MATCH, tournament_id: TOUR, status: 'finished', winner_pair: 1 },
      ],
    });
    const result = await runShadowDiffFinalizer({ supabase: supabase as any });
    expect(result.finalStateRowsWritten).toBe(0);
    expect(result.perPointRowsWritten).toBe(0);
    expect(result.matchesConsidered).toBe(0);
    expect(supabase.shadowDiffInserted).toHaveLength(0);
  });

  it('finished match with matching final_state → 1 final_state row, winner+score match, divergence_reason=null', async () => {
    const supabase = fakeSupabase({
      tournaments: [{ id: TOUR, shadow_enabled: true }],
      matches: [
        { id: MATCH, tournament_id: TOUR, status: 'finished', winner_pair: 1 },
      ],
      publicSets: [
        {
          id: 'set-1',
          match_id: MATCH,
          set_number: 1,
          set_score: '6-4',
          pair1_games: 6,
          pair2_games: 4,
        },
        {
          id: 'set-2',
          match_id: MATCH,
          set_number: 2,
          set_score: '6-3',
          pair1_games: 6,
          pair2_games: 3,
        },
      ],
      shadowSets: [
        {
          match_id: MATCH,
          set_number: 1,
          set_score: '6-4',
          pair1_games: 6,
          pair2_games: 4,
        },
        {
          match_id: MATCH,
          set_number: 2,
          set_score: '6-3',
          pair1_games: 6,
          pair2_games: 3,
        },
      ],
    });
    const result = await runShadowDiffFinalizer({ supabase: supabase as any });
    expect(result.matchesConsidered).toBe(1);
    expect(result.finalStateRowsWritten).toBe(1);
    // No shadow points → no per_point row.
    expect(result.perPointRowsWritten).toBe(0);

    expect(supabase.shadowDiffInserted).toHaveLength(1);
    const row = supabase.shadowDiffInserted[0];
    expect(row.comparison_type).toBe('final_state');
    expect(row.match_id).toBe(MATCH);
    expect(row.tournament_id).toBe(TOUR);
    expect(row.padelapi_winner_pair).toBe(1);
    expect(row.padelgod_winner_pair).toBe(1);
    expect(row.winner_match).toBe(true);
    expect(row.padelapi_final_score).toBe('6-4 6-3');
    expect(row.padelgod_final_score).toBe('6-4 6-3');
    expect(row.score_match).toBe(true);
    expect(row.divergence_reason).toBeNull();
  });

  it('winner disagreement → divergence_reason=winner_disagreement, winner_match=false', async () => {
    const supabase = fakeSupabase({
      tournaments: [{ id: TOUR, shadow_enabled: true }],
      matches: [
        // Canonical says pair 1 won
        { id: MATCH, tournament_id: TOUR, status: 'finished', winner_pair: 1 },
      ],
      publicSets: [
        {
          id: 'set-1',
          match_id: MATCH,
          set_number: 1,
          set_score: '6-4',
          pair1_games: 6,
          pair2_games: 4,
        },
        {
          id: 'set-2',
          match_id: MATCH,
          set_number: 2,
          set_score: '6-3',
          pair1_games: 6,
          pair2_games: 3,
        },
      ],
      // Shadow says pair 2 won (flipped)
      shadowSets: [
        {
          match_id: MATCH,
          set_number: 1,
          set_score: '4-6',
          pair1_games: 4,
          pair2_games: 6,
        },
        {
          match_id: MATCH,
          set_number: 2,
          set_score: '3-6',
          pair1_games: 3,
          pair2_games: 6,
        },
      ],
    });
    const result = await runShadowDiffFinalizer({ supabase: supabase as any });
    expect(result.finalStateRowsWritten).toBe(1);
    const row = supabase.shadowDiffInserted[0];
    expect(row.padelapi_winner_pair).toBe(1);
    expect(row.padelgod_winner_pair).toBe(2);
    expect(row.winner_match).toBe(false);
    expect(row.divergence_reason).toBe('winner_disagreement');
  });

  it('skips match that already has a final_state diff row', async () => {
    const supabase = fakeSupabase({
      tournaments: [{ id: TOUR, shadow_enabled: true }],
      matches: [
        { id: MATCH, tournament_id: TOUR, status: 'finished', winner_pair: 1 },
      ],
      publicSets: [
        {
          id: 'set-1',
          match_id: MATCH,
          set_number: 1,
          set_score: '6-4',
          pair1_games: 6,
          pair2_games: 4,
        },
      ],
      shadowSets: [
        {
          match_id: MATCH,
          set_number: 1,
          set_score: '6-4',
          pair1_games: 6,
          pair2_games: 4,
        },
      ],
      existingDiffs: [{ match_id: MATCH, comparison_type: 'final_state' }],
    });
    const result = await runShadowDiffFinalizer({ supabase: supabase as any });
    expect(result.matchesConsidered).toBe(1);
    expect(result.finalStateRowsWritten).toBe(0);
    expect(supabase.shadowDiffInserted).toHaveLength(0);
  });

  it('per_point_sequence: scripted length mismatch (padelapi 4, padelgod 3) writes a divergence row', async () => {
    const supabase = fakeSupabase({
      tournaments: [{ id: TOUR, shadow_enabled: true }],
      matches: [
        { id: MATCH, tournament_id: TOUR, status: 'finished', winner_pair: 1 },
      ],
      // Final state matches so we don't interfere.
      publicSets: [
        {
          id: 'set-1',
          match_id: MATCH,
          set_number: 1,
          set_score: '6-0',
          pair1_games: 6,
          pair2_games: 0,
        },
        {
          id: 'set-2',
          match_id: MATCH,
          set_number: 2,
          set_score: '6-0',
          pair1_games: 6,
          pair2_games: 0,
        },
      ],
      shadowSets: [
        {
          match_id: MATCH,
          set_number: 1,
          set_score: '6-0',
          pair1_games: 6,
          pair2_games: 0,
        },
        {
          match_id: MATCH,
          set_number: 2,
          set_score: '6-0',
          pair1_games: 6,
          pair2_games: 0,
        },
      ],
      // One game with 4 padelapi points, shadow has 3 — all matching what
      // overlaps, but lengths differ.
      publicGames: [
        {
          match_id: MATCH,
          set_id: 'set-1',
          game_number: 1,
          points: ['15:0', '30:0', '40:0', '40:15'],
        },
      ],
      shadowMatchPoints: [
        {
          match_id: MATCH,
          set_number: 1,
          game_number: 1,
          point_number: 1,
          score_after: '15-0',
        },
        {
          match_id: MATCH,
          set_number: 1,
          game_number: 1,
          point_number: 2,
          score_after: '30-0',
        },
        {
          match_id: MATCH,
          set_number: 1,
          game_number: 1,
          point_number: 3,
          score_after: '40-0',
        },
      ],
    });
    const result = await runShadowDiffFinalizer({ supabase: supabase as any });
    expect(result.finalStateRowsWritten).toBe(1);
    expect(result.perPointRowsWritten).toBe(1);

    const perPoint = supabase.shadowDiffInserted.find(
      (r) => r.comparison_type === 'per_point_sequence'
    );
    expect(perPoint).toBeDefined();
    expect(perPoint.padelapi_point_count).toBe(4);
    expect(perPoint.padelgod_point_count).toBe(3);
    expect(perPoint.point_sequence_match).toBe(false);
    expect(perPoint.first_divergence_index).toBe(3);
    expect(perPoint.first_divergence_detail).toContain('sequence length mismatch');
    expect(perPoint.divergence_reason).toBe('point_sequence_mismatch');
  });

  it('per_point_sequence: fully-matching sequence writes point_sequence_match=true, divergence_reason=null', async () => {
    const supabase = fakeSupabase({
      tournaments: [{ id: TOUR, shadow_enabled: true }],
      matches: [
        { id: MATCH, tournament_id: TOUR, status: 'finished', winner_pair: 1 },
      ],
      publicSets: [
        {
          id: 'set-1',
          match_id: MATCH,
          set_number: 1,
          set_score: '6-0',
          pair1_games: 6,
          pair2_games: 0,
        },
        {
          id: 'set-2',
          match_id: MATCH,
          set_number: 2,
          set_score: '6-0',
          pair1_games: 6,
          pair2_games: 0,
        },
      ],
      shadowSets: [
        {
          match_id: MATCH,
          set_number: 1,
          set_score: '6-0',
          pair1_games: 6,
          pair2_games: 0,
        },
        {
          match_id: MATCH,
          set_number: 2,
          set_score: '6-0',
          pair1_games: 6,
          pair2_games: 0,
        },
      ],
      publicGames: [
        {
          match_id: MATCH,
          set_id: 'set-1',
          game_number: 1,
          points: ['15:0', '30:0', '40:0'],
        },
      ],
      shadowMatchPoints: [
        {
          match_id: MATCH,
          set_number: 1,
          game_number: 1,
          point_number: 1,
          score_after: '15-0',
        },
        {
          match_id: MATCH,
          set_number: 1,
          game_number: 1,
          point_number: 2,
          score_after: '30-0',
        },
        {
          match_id: MATCH,
          set_number: 1,
          game_number: 1,
          point_number: 3,
          score_after: '40-0',
        },
      ],
    });
    const result = await runShadowDiffFinalizer({ supabase: supabase as any });
    expect(result.perPointRowsWritten).toBe(1);

    const perPoint = supabase.shadowDiffInserted.find(
      (r) => r.comparison_type === 'per_point_sequence'
    );
    expect(perPoint).toBeDefined();
    expect(perPoint.padelapi_point_count).toBe(3);
    expect(perPoint.padelgod_point_count).toBe(3);
    expect(perPoint.point_sequence_match).toBe(true);
    expect(perPoint.first_divergence_index).toBeNull();
    expect(perPoint.first_divergence_detail).toBeNull();
    expect(perPoint.divergence_reason).toBeNull();
  });
});
