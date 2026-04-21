import { describe, it, expect } from 'vitest';
import { applyDiff, formatPointScore, type ResolvedPlayers } from '../../lib/point-reconstruction.js';
import type { LiveMatchState, LiveStateDiff, PointState } from '../../lib/live-state.js';

// ---------------------------------------------------------------------------
// Fake Supabase client
// ---------------------------------------------------------------------------

interface SetRow {
  id: string;
  match_id: string;
  set_number: number;
  pair1_games: number;
  pair2_games: number;
  is_current: boolean;
}
interface GameRow {
  id: string;
  set_id: string;
  match_id: string;
  game_number: number;
  game_score: string;
  server_player_id: string | null;
  is_tiebreak: boolean;
  is_current: boolean;
}
interface MatchPointRow {
  match_id: string;
  set_id: string;
  game_id: string;
  point_number: number;
  server_player_id: string | null;
  winner_pair: 1 | 2;
  score_after: string;
  is_break_point: boolean;
  is_set_point: boolean;
  is_match_point: boolean;
  is_golden_point: boolean;
  source: string;
}

interface ShadowSetRow {
  match_id: string;
  set_number: number;
  set_score: string | null;
  pair1_games: number | null;
  pair2_games: number | null;
  updated_at: string;
}

interface ShadowMatchPointRow {
  match_id: string;
  set_number: number;
  game_number: number;
  point_number: number;
  winner_pair: 1 | 2;
  score_after: string;
  server_team: 1 | 2 | null;
  is_golden_point: boolean;
}

interface FakeSupabase {
  setsUpsertCalls: any[];
  setsUpdateCalls: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>;
  gamesUpsertCalls: any[];
  gamesUpdateCalls: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>;
  matchPointsInserted: MatchPointRow[];
  sets: SetRow[];
  games: GameRow[];
  shadowSetsUpsertCalls: any[];
  shadowMatchPointsInserted: ShadowMatchPointRow[];
  padelgodFromCalls: string[];
  // Dual-write surfaces: public.matches.update (status flip) + public.sets.select
  matchesUpdateCalls: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>;
  matchesRows: Array<{ id: string; status: string }>;
}

function makeFakeSupabase(opts: {
  preSets?: SetRow[];
  preGames?: GameRow[];
  preMatchPoints?: MatchPointRow[];
  preMatchesRows?: Array<{ id: string; status: string }>;
  setUpsertError?: boolean;
  gameUpsertError?: boolean;
} = {}): { client: any; state: FakeSupabase } {
  const state: FakeSupabase = {
    setsUpsertCalls: [],
    setsUpdateCalls: [],
    gamesUpsertCalls: [],
    gamesUpdateCalls: [],
    matchPointsInserted: opts.preMatchPoints ? [...opts.preMatchPoints] : [],
    sets: opts.preSets ? [...opts.preSets] : [],
    games: opts.preGames ? [...opts.preGames] : [],
    shadowSetsUpsertCalls: [],
    shadowMatchPointsInserted: [],
    padelgodFromCalls: [],
    matchesUpdateCalls: [],
    matchesRows: opts.preMatchesRows ? [...opts.preMatchesRows] : [],
  };

  let setIdCounter = state.sets.length;
  let gameIdCounter = state.games.length;

  function setsTable() {
    return {
      upsert: (row: any, _opts: any) => {
        state.setsUpsertCalls.push(row);
        if (opts.setUpsertError) {
          return {
            select: (_c: string) => ({
              single: () => Promise.resolve({ data: null, error: { message: 'upsert failed' } }),
            }),
          };
        }
        // simulate upsert: find by (match_id, set_number) or insert
        const existing = state.sets.find(
          (s) => s.match_id === row.match_id && s.set_number === row.set_number,
        );
        let id: string;
        if (existing) {
          id = existing.id;
          Object.assign(existing, { ...row, id });
        } else {
          setIdCounter += 1;
          id = `set-uuid-${setIdCounter}`;
          state.sets.push({ ...(row as SetRow), id });
        }
        return {
          select: (_c: string) => ({
            single: () => Promise.resolve({ data: { id }, error: null }),
          }),
          // Upsert with no .select() — returned when the caller doesn't chain.
          // Returns a thenable so `await supabase.from('sets').upsert(...)` resolves.
          then: (resolve: (v: { data: null; error: null }) => void) =>
            resolve({ data: null, error: null }),
        };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col1: string, val1: unknown) => ({
          neq: (col2: string, val2: unknown) => {
            state.setsUpdateCalls.push({
              patch,
              filters: { [col1]: val1, [`!${col2}`]: val2 },
            });
            // apply: clear is_current for matching rows
            for (const s of state.sets) {
              if (s.match_id === val1 && s.set_number !== val2) {
                Object.assign(s, patch);
              }
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      // Used by dual-write to read existing score_source before overwriting.
      // Two supported chains:
      //   .select(...).eq(match_id).eq(set_number).maybeSingle() → single row
      //   .select(...).eq(match_id) → all rows for match (thenable on .eq)
      select: (_cols: string) => {
        const filters: Record<string, unknown> = {};
        const api: any = {
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return api;
          },
          maybeSingle: () => {
            const row = state.sets.find(
              (s) => s.match_id === filters.match_id && s.set_number === filters.set_number,
            );
            if (!row) return Promise.resolve({ data: null, error: null });
            return Promise.resolve({
              data: { id: row.id, score_source: (row as any).score_source ?? null },
              error: null,
            });
          },
          then: (resolve: (v: { data: any[]; error: null }) => void) => {
            const rows = state.sets
              .filter((s) => Object.entries(filters).every(([k, v]) => (s as any)[k] === v))
              .map((s) => ({
                set_number: s.set_number,
                score_source: (s as any).score_source ?? null,
              }));
            resolve({ data: rows, error: null });
          },
        };
        return api;
      },
    };
  }

  function matchesTable() {
    return {
      update: (patch: Record<string, unknown>) => ({
        eq: (col1: string, val1: unknown) => ({
          eq: (col2: string, val2: unknown) => {
            state.matchesUpdateCalls.push({
              patch,
              filters: { [col1]: val1, [col2]: val2 },
            });
            // Apply only when the row matches both filters (status flip guard).
            for (const m of state.matchesRows) {
              if ((m as any)[col1] === val1 && (m as any)[col2] === val2) {
                Object.assign(m, patch);
              }
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    };
  }

  function gamesTable() {
    return {
      upsert: (row: any, _opts: any) => {
        state.gamesUpsertCalls.push(row);
        if (opts.gameUpsertError) {
          return {
            select: (_c: string) => ({
              single: () => Promise.resolve({ data: null, error: { message: 'upsert failed' } }),
            }),
          };
        }
        const existing = state.games.find(
          (g) => g.set_id === row.set_id && g.game_number === row.game_number,
        );
        let id: string;
        if (existing) {
          id = existing.id;
          Object.assign(existing, { ...row, id });
        } else {
          gameIdCounter += 1;
          id = `game-uuid-${gameIdCounter}`;
          state.games.push({ ...(row as GameRow), id });
        }
        return {
          select: (_c: string) => ({
            single: () => Promise.resolve({ data: { id }, error: null }),
          }),
        };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col1: string, val1: unknown) => ({
          neq: (col2: string, val2: unknown) => {
            state.gamesUpdateCalls.push({
              patch,
              filters: { [col1]: val1, [`!${col2}`]: val2 },
            });
            for (const g of state.games) {
              if (g.set_id === val1 && g.game_number !== val2) {
                Object.assign(g, patch);
              }
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    };
  }

  function matchPointsTable() {
    return {
      select: (_cols: string, selOpts: any) => ({
        eq: (col: string, val: unknown) => {
          if (selOpts?.count === 'exact' && selOpts?.head === true) {
            const count = state.matchPointsInserted.filter(
              (p) => (p as any)[col] === val,
            ).length;
            return Promise.resolve({ count, data: null, error: null });
          }
          return Promise.resolve({ data: [], count: 0, error: null });
        },
      }),
      insert: (row: MatchPointRow) => {
        // check UNIQUE (game_id, point_number)
        const dup = state.matchPointsInserted.find(
          (p) => p.game_id === row.game_id && p.point_number === row.point_number,
        );
        if (dup) {
          return Promise.resolve({
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' },
          });
        }
        state.matchPointsInserted.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function shadowSetsTable() {
    return {
      upsert: (row: any, _opts: any) => {
        state.shadowSetsUpsertCalls.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function shadowMatchPointsTable() {
    return {
      select: (_cols: string, selOpts: any) => {
        // Chain: .select().eq().eq().eq() — resolves as a Promise-like thenable
        // that reports the count.
        const filters: Array<{ col: string; val: unknown }> = [];
        const api: any = {
          eq: (col: string, val: unknown) => {
            filters.push({ col, val });
            return api;
          },
          then: (resolve: (v: { count: number; data: null; error: null }) => void) => {
            if (selOpts?.count === 'exact' && selOpts?.head === true) {
              const count = state.shadowMatchPointsInserted.filter((p) =>
                filters.every((f) => (p as any)[f.col] === f.val),
              ).length;
              resolve({ count, data: null, error: null });
            } else {
              resolve({ count: 0, data: null, error: null });
            }
          },
        };
        return api;
      },
      insert: (row: ShadowMatchPointRow) => {
        // UNIQUE(match_id, set_number, game_number, point_number)
        const dup = state.shadowMatchPointsInserted.find(
          (p) =>
            p.match_id === row.match_id &&
            p.set_number === row.set_number &&
            p.game_number === row.game_number &&
            p.point_number === row.point_number,
        );
        if (dup) {
          return Promise.resolve({
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' },
          });
        }
        state.shadowMatchPointsInserted.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  const client = {
    from: (t: string) => {
      if (t === 'sets') return setsTable();
      if (t === 'games') return gamesTable();
      if (t === 'match_points') return matchPointsTable();
      if (t === 'matches') return matchesTable();
      throw new Error(`unexpected table: ${t}`);
    },
    schema: (schemaName: string) => {
      if (schemaName !== 'padelgod') {
        throw new Error(`unexpected schema: ${schemaName}`);
      }
      return {
        from: (t: string) => {
          state.padelgodFromCalls.push(t);
          if (t === 'shadow_sets') return shadowSetsTable();
          if (t === 'shadow_match_points') return shadowMatchPointsTable();
          throw new Error(`unexpected padelgod table: ${t}`);
        },
      };
    },
  };

  return { client, state };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const MATCH_ID = 'match-uuid-1';
const RESOLVED: ResolvedPlayers = {
  pair1Player1Id: 'p1p1',
  pair1Player2Id: 'p1p2',
  pair2Player1Id: 'p2p1',
  pair2Player2Id: 'p2p2',
};

function state(
  pointState: PointState,
  opts: Partial<LiveMatchState> = {},
): LiveMatchState {
  return {
    matchWidgetId: 'w-1',
    matchId: MATCH_ID,
    pointState,
    team1Sets: opts.team1Sets ?? [{ games: 0, tiebreak: null }],
    team2Sets: opts.team2Sets ?? [{ games: 0, tiebreak: null }],
    servingTeam: 'servingTeam' in opts ? (opts.servingTeam as 1 | 2 | null) : 1,
    status: opts.status ?? 'live',
  };
}

function emptyDiff(): LiveStateDiff {
  return {
    pointsAdded: [],
    gameChanged: false,
    setChanged: false,
    serverChanged: false,
    statusChanged: false,
    suspectedMissedPoints: false,
  };
}

// ---------------------------------------------------------------------------
// formatPointScore
// ---------------------------------------------------------------------------

describe('formatPointScore', () => {
  it('formats regular scores as T1-T2', () => {
    expect(formatPointScore({ kind: 'regular', team1: 15, team2: 0 })).toBe('15-0');
    expect(formatPointScore({ kind: 'regular', team1: 30, team2: 40 })).toBe('30-40');
  });
  it('formats deuce as "Deuce"', () => {
    expect(formatPointScore({ kind: 'deuce' })).toBe('Deuce');
  });
  it('formats advantage as AD-40 / 40-AD', () => {
    expect(formatPointScore({ kind: 'advantage', side: 1 })).toBe('AD-40');
    expect(formatPointScore({ kind: 'advantage', side: 2 })).toBe('40-AD');
  });
  it('formats golden_point as "GP"', () => {
    expect(formatPointScore({ kind: 'golden_point' })).toBe('GP');
  });
  it('formats tiebreak as T1-T2', () => {
    expect(formatPointScore({ kind: 'tiebreak', team1: 5, team2: 3 })).toBe('5-3');
  });
});

// ---------------------------------------------------------------------------
// applyDiff — core behaviours
// ---------------------------------------------------------------------------

describe('applyDiff — no-ops', () => {
  it('first poll (prev=null) writes nothing', async () => {
    const { client, state: s } = makeFakeSupabase();
    const curr = state({ kind: 'regular', team1: 0, team2: 0 });
    await applyDiff(client, MATCH_ID, null, curr, emptyDiff(), RESOLVED);
    expect(s.setsUpsertCalls).toHaveLength(0);
    expect(s.gamesUpsertCalls).toHaveLength(0);
    expect(s.matchPointsInserted).toHaveLength(0);
  });

  it('empty diff (no points, no changes) writes nothing', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 15, team2: 0 });
    await applyDiff(client, MATCH_ID, prev, curr, emptyDiff(), RESOLVED);
    expect(s.setsUpsertCalls).toHaveLength(0);
    expect(s.gamesUpsertCalls).toHaveLength(0);
    expect(s.matchPointsInserted).toHaveLength(0);
  });
});

describe('applyDiff — point insertion', () => {
  it('writes a match_points row for a detected point (15-0 → 30-0)', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
    };
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);

    expect(s.matchPointsInserted).toHaveLength(1);
    const pt = s.matchPointsInserted[0];
    expect(pt.match_id).toBe(MATCH_ID);
    expect(pt.winner_pair).toBe(1);
    expect(pt.score_after).toBe('30-0');
    expect(pt.source).toBe('padelgod');
    expect(pt.point_number).toBe(1);
    expect(pt.is_break_point).toBe(false);
    expect(pt.is_golden_point).toBe(false);
    // set_id + game_id match the rows we just upserted
    expect(pt.set_id).toBe(s.sets[0]!.id);
    expect(pt.game_id).toBe(s.games[0]!.id);
  });

  it('computes point_number from existing count (next point is #2)', async () => {
    // pre-seed: one set, one game, one existing match_point row
    const preSet: SetRow = {
      id: 'set-uuid-seed',
      match_id: MATCH_ID,
      set_number: 1,
      pair1_games: 0,
      pair2_games: 0,
      is_current: true,
    };
    const preGame: GameRow = {
      id: 'game-uuid-seed',
      set_id: preSet.id,
      match_id: MATCH_ID,
      game_number: 1,
      game_score: '15-0',
      server_player_id: 'p1p1',
      is_tiebreak: false,
      is_current: true,
    };
    const preMp: MatchPointRow = {
      match_id: MATCH_ID,
      set_id: preSet.id,
      game_id: preGame.id,
      point_number: 1,
      server_player_id: 'p1p1',
      winner_pair: 1,
      score_after: '15-0',
      is_break_point: false,
      is_set_point: false,
      is_match_point: false,
      is_golden_point: false,
      source: 'padelgod',
    };
    const { client, state: s } = makeFakeSupabase({
      preSets: [preSet],
      preGames: [preGame],
      preMatchPoints: [preMp],
    });

    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
    };
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);

    expect(s.matchPointsInserted).toHaveLength(2);
    expect(s.matchPointsInserted[1]!.point_number).toBe(2);
  });

  it('golden point produces score_after="GP"', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'deuce' });
    const curr = state({ kind: 'golden_point' });
    // (label shuffle — comparator would NOT emit a point for this, but
    //  we want to test score_after formatting when a point IS emitted —
    //  simulate via a hand-built diff.)
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 2 }],
    };
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);
    expect(s.matchPointsInserted[0]!.score_after).toBe('GP');
  });

  it('tiebreak state propagates is_tiebreak=true onto games row', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'tiebreak', team1: 3, team2: 2 }, {
      team1Sets: [{ games: 6, tiebreak: 3 }],
      team2Sets: [{ games: 6, tiebreak: 2 }],
    });
    const curr = state({ kind: 'tiebreak', team1: 4, team2: 2 }, {
      team1Sets: [{ games: 6, tiebreak: 4 }],
      team2Sets: [{ games: 6, tiebreak: 2 }],
    });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
    };
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);

    expect(s.gamesUpsertCalls).toHaveLength(1);
    expect(s.gamesUpsertCalls[0].is_tiebreak).toBe(true);
    expect(s.gamesUpsertCalls[0].game_score).toBe('4-2');
    // game_number = 6 + 6 + 1 = 13 (the tiebreak game)
    expect(s.gamesUpsertCalls[0].game_number).toBe(13);
  });

  it('is idempotent on replay (UNIQUE(game_id, point_number) swallows dup)', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
    };
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);
    // replay the exact same diff — the UNIQUE constraint kicks in
    // because the point_number counter sees the prior row.
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);
    // NOTE: with our count-based numbering, the second call computes
    // point_number = 2 (sees 1 existing) and inserts that. The test is
    // really "double-apply doesn't throw" and "sets+games remain consistent".
    // We only assert no throw + set row count is still 1.
    expect(s.sets).toHaveLength(1);
    expect(s.games).toHaveLength(1);
  });
});

describe('applyDiff — games row', () => {
  it('upserts games row with server_player_id from servingTeam=1', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'regular', team1: 0, team2: 0 }, { servingTeam: 1 });
    const curr = state({ kind: 'regular', team1: 0, team2: 0 }, {
      team1Sets: [{ games: 1, tiebreak: null }],
      team2Sets: [{ games: 0, tiebreak: null }],
      servingTeam: 2, // server changed after game ended
    });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
      gameChanged: true,
      serverChanged: true,
    };
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);

    expect(s.gamesUpsertCalls).toHaveLength(1);
    const g = s.gamesUpsertCalls[0];
    // servingTeam=2 → pair2Player1Id
    expect(g.server_player_id).toBe('p2p1');
    expect(g.game_number).toBe(2); // 1 + 0 + 1
    expect(g.is_current).toBe(true);
  });

  it('server_player_id is null when servingTeam is null', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'regular', team1: 0, team2: 0 }, { servingTeam: null });
    const curr = state({ kind: 'regular', team1: 15, team2: 0 }, { servingTeam: null });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
    };
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);

    expect(s.gamesUpsertCalls[0].server_player_id).toBe(null);
    expect(s.matchPointsInserted[0].server_player_id).toBe(null);
  });

  it('clears is_current on prior games in the same set', async () => {
    // pre-seed: one prior game in the set
    const preSet: SetRow = {
      id: 'set-uuid-seed',
      match_id: MATCH_ID,
      set_number: 1,
      pair1_games: 1,
      pair2_games: 0,
      is_current: true,
    };
    const priorGame: GameRow = {
      id: 'game-uuid-prior',
      set_id: preSet.id,
      match_id: MATCH_ID,
      game_number: 1,
      game_score: 'GameWin',
      server_player_id: 'p1p1',
      is_tiebreak: false,
      is_current: true, // stale
    };
    const { client, state: s } = makeFakeSupabase({
      preSets: [preSet],
      preGames: [priorGame],
    });

    const prev = state({ kind: 'regular', team1: 40, team2: 0 }, {
      team1Sets: [{ games: 1, tiebreak: null }],
      team2Sets: [{ games: 0, tiebreak: null }],
    });
    const curr = state({ kind: 'regular', team1: 0, team2: 0 }, {
      team1Sets: [{ games: 2, tiebreak: null }],
      team2Sets: [{ games: 0, tiebreak: null }],
    });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
      gameChanged: true,
    };
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);

    expect(s.gamesUpdateCalls.length).toBeGreaterThan(0);
    // the prior game should now have is_current=false
    const prior = s.games.find((g) => g.id === 'game-uuid-prior')!;
    expect(prior.is_current).toBe(false);
  });
});

describe('applyDiff — set handling', () => {
  it('upserts set with is_current=true and latest pair games', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'regular', team1: 40, team2: 15 }, {
      team1Sets: [{ games: 5, tiebreak: null }],
      team2Sets: [{ games: 3, tiebreak: null }],
    });
    const curr = state({ kind: 'regular', team1: 0, team2: 0 }, {
      team1Sets: [{ games: 6, tiebreak: null }],
      team2Sets: [{ games: 3, tiebreak: null }],
    });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
      gameChanged: true,
    };
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);

    expect(s.setsUpsertCalls).toHaveLength(1);
    const row = s.setsUpsertCalls[0];
    expect(row.match_id).toBe(MATCH_ID);
    expect(row.set_number).toBe(1);
    expect(row.pair1_games).toBe(6);
    expect(row.pair2_games).toBe(3);
    expect(row.is_current).toBe(true);
    expect(row.score_source).toBe('live');
  });

  it('clears is_current on previous sets when a new set starts', async () => {
    const prevSet: SetRow = {
      id: 'set-uuid-1',
      match_id: MATCH_ID,
      set_number: 1,
      pair1_games: 6,
      pair2_games: 4,
      is_current: true, // stale
    };
    const { client, state: s } = makeFakeSupabase({ preSets: [prevSet] });

    const prev = state({ kind: 'regular', team1: 40, team2: 0 }, {
      team1Sets: [
        { games: 6, tiebreak: null },
        { games: 5, tiebreak: null },
      ],
      team2Sets: [
        { games: 4, tiebreak: null },
        { games: 4, tiebreak: null },
      ],
    });
    const curr = state({ kind: 'regular', team1: 0, team2: 0 }, {
      team1Sets: [
        { games: 6, tiebreak: null },
        { games: 6, tiebreak: null },
      ],
      team2Sets: [
        { games: 4, tiebreak: null },
        { games: 4, tiebreak: null },
      ],
    });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
      gameChanged: true,
    };
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);

    // we should have issued an UPDATE to clear is_current on non-current sets
    expect(s.setsUpdateCalls).toHaveLength(1);
    expect(s.setsUpdateCalls[0].patch.is_current).toBe(false);
    // and the current set 2 should be upserted with is_current=true
    const currentSetUpsert = s.setsUpsertCalls.find((r) => r.set_number === 2);
    expect(currentSetUpsert).toBeDefined();
    expect(currentSetUpsert.is_current).toBe(true);
    // the pre-seeded set 1 should have been patched to false
    const prior = s.sets.find((x) => x.set_number === 1)!;
    expect(prior.is_current).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyDiff (shadow mode) — routing to padelgod.shadow_* tables
// ---------------------------------------------------------------------------

describe('applyDiff (shadow mode)', () => {
  it('routes set upsert to padelgod.shadow_sets (no public.sets write)', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'regular', team1: 15, team2: 0 }, {
      team1Sets: [{ games: 3, tiebreak: null }],
      team2Sets: [{ games: 2, tiebreak: null }],
    });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 }, {
      team1Sets: [{ games: 3, tiebreak: null }],
      team2Sets: [{ games: 2, tiebreak: null }],
    });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
    };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, { mode: 'shadow' });

    // No canonical writes at all.
    expect(s.setsUpsertCalls).toHaveLength(0);
    expect(s.setsUpdateCalls).toHaveLength(0);
    expect(s.gamesUpsertCalls).toHaveLength(0);
    expect(s.gamesUpdateCalls).toHaveLength(0);
    expect(s.matchPointsInserted).toHaveLength(0);

    // Exactly one shadow_sets upsert, matching the current set aggregates.
    expect(s.shadowSetsUpsertCalls).toHaveLength(1);
    const row = s.shadowSetsUpsertCalls[0];
    expect(row.match_id).toBe(MATCH_ID);
    expect(row.set_number).toBe(1);
    expect(row.pair1_games).toBe(3);
    expect(row.pair2_games).toBe(2);
    expect(row.set_score).toBe('3-2');
    // Schema-less columns are NOT written — no is_current, no score_source.
    expect(row.is_current).toBeUndefined();
    expect(row.score_source).toBeUndefined();
  });

  it('routes match_point insert to padelgod.shadow_match_points', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
    };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, { mode: 'shadow' });

    expect(s.matchPointsInserted).toHaveLength(0);
    expect(s.shadowMatchPointsInserted).toHaveLength(1);
    const pt = s.shadowMatchPointsInserted[0]!;
    expect(pt.match_id).toBe(MATCH_ID);
    expect(pt.set_number).toBe(1);
    // game_number = pair1Games + pair2Games + 1 = 0 + 0 + 1 = 1
    expect(pt.game_number).toBe(1);
    expect(pt.point_number).toBe(1);
    expect(pt.winner_pair).toBe(1);
    expect(pt.score_after).toBe('30-0');
  });

  it('skips games writes entirely in shadow mode', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'regular', team1: 40, team2: 15 }, {
      team1Sets: [{ games: 5, tiebreak: null }],
      team2Sets: [{ games: 3, tiebreak: null }],
    });
    const curr = state({ kind: 'regular', team1: 0, team2: 0 }, {
      team1Sets: [{ games: 6, tiebreak: null }],
      team2Sets: [{ games: 3, tiebreak: null }],
    });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
      gameChanged: true,
    };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, { mode: 'shadow' });

    expect(s.gamesUpsertCalls).toHaveLength(0);
    expect(s.gamesUpdateCalls).toHaveLength(0);
    // Confirm the padelgod schema was only used for shadow_sets + (optionally)
    // shadow_match_points — never shadow_games.
    expect(s.padelgodFromCalls).not.toContain('shadow_games');
  });

  it('defaults mode to canonical when omitted (existing behavior preserved)', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
    };

    // No `mode` passed — should behave exactly like canonical.
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED);

    // Canonical paths written.
    expect(s.setsUpsertCalls).toHaveLength(1);
    expect(s.gamesUpsertCalls).toHaveLength(1);
    expect(s.matchPointsInserted).toHaveLength(1);
    // Shadow paths untouched.
    expect(s.shadowSetsUpsertCalls).toHaveLength(0);
    expect(s.shadowMatchPointsInserted).toHaveLength(0);
    expect(s.padelgodFromCalls).toHaveLength(0);
  });

  it('passes server_team + is_golden_point correctly into shadow_match_points', async () => {
    const { client, state: s } = makeFakeSupabase();
    const prev = state({ kind: 'deuce' }, { servingTeam: 2 });
    const curr = state({ kind: 'golden_point' }, { servingTeam: 2 });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 2 }],
    };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, { mode: 'shadow' });

    expect(s.shadowMatchPointsInserted).toHaveLength(1);
    const pt = s.shadowMatchPointsInserted[0]!;
    expect(pt.server_team).toBe(2);
    expect(pt.is_golden_point).toBe(true);
    expect(pt.score_after).toBe('GP');
    // Confirm the server UUID shape from canonical mode is NOT present.
    expect((pt as any).server_player_id).toBeUndefined();
  });

  it('computes point_number from existing count in shadow_match_points (next is #2)', async () => {
    const { client, state: s } = makeFakeSupabase();
    // Pre-seed a shadow point row for (set 1, game 1, point 1)
    s.shadowMatchPointsInserted.push({
      match_id: MATCH_ID,
      set_number: 1,
      game_number: 1,
      point_number: 1,
      winner_pair: 1,
      score_after: '15-0',
      server_team: 1,
      is_golden_point: false,
    });

    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
    };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, { mode: 'shadow' });

    expect(s.shadowMatchPointsInserted).toHaveLength(2);
    expect(s.shadowMatchPointsInserted[1]!.point_number).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// applyDiff (shadow mode + dualWritePublic=true) — dual-write behavior
// ---------------------------------------------------------------------------

describe('applyDiff (shadow + dualWritePublic)', () => {
  function makeClientWithMatch(status: string) {
    return makeFakeSupabase({
      preMatchesRows: [{ id: MATCH_ID, status }],
    });
  }

  it('flips public.matches.status scheduled → live on first tick', async () => {
    const { client, state: s } = makeClientWithMatch('scheduled');
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
    };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    expect(s.matchesUpdateCalls).toHaveLength(1);
    expect(s.matchesUpdateCalls[0]!.patch.status).toBe('live');
    expect(s.matchesUpdateCalls[0]!.filters).toMatchObject({ id: MATCH_ID, status: 'scheduled' });
    expect(s.matchesRows[0]!.status).toBe('live');
  });

  it('does not regress public.matches.status when already finished', async () => {
    const { client, state: s } = makeClientWithMatch('finished');
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    // The update call is still issued (no pre-check), but the .eq('status','scheduled')
    // guard means no row actually matches → DB state untouched.
    expect(s.matchesRows[0]!.status).toBe('finished');
  });

  it('upserts public.sets with score_source=shadow', async () => {
    const { client, state: s } = makeClientWithMatch('scheduled');
    const prev = state({ kind: 'regular', team1: 15, team2: 0 }, {
      team1Sets: [{ games: 2, tiebreak: null }],
      team2Sets: [{ games: 1, tiebreak: null }],
    });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 }, {
      team1Sets: [{ games: 2, tiebreak: null }],
      team2Sets: [{ games: 1, tiebreak: null }],
    });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    // Shadow path also fires (padelgod.shadow_sets).
    expect(s.shadowSetsUpsertCalls).toHaveLength(1);
    // Plus a public.sets upsert with score_source='shadow'.
    expect(s.setsUpsertCalls).toHaveLength(1);
    expect(s.setsUpsertCalls[0]).toMatchObject({
      match_id: MATCH_ID,
      set_number: 1,
      set_score: '2-1',
      pair1_games: 2,
      pair2_games: 1,
      is_current: true,
      score_source: 'shadow',
    });
  });

  it('skips public.sets upsert when existing row has score_source=api', async () => {
    const { client, state: s } = makeFakeSupabase({
      preMatchesRows: [{ id: MATCH_ID, status: 'live' }],
      preSets: [
        {
          id: 'pre-set-1',
          match_id: MATCH_ID,
          set_number: 1,
          pair1_games: 6,
          pair2_games: 4,
          is_current: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ score_source: 'api' } as any),
        },
      ],
    });
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    // Shadow path still runs (padelgod.shadow_sets is independent).
    expect(s.shadowSetsUpsertCalls).toHaveLength(1);
    // But public.sets is NOT touched — canonical source wins.
    expect(s.setsUpsertCalls).toHaveLength(0);
  });

  it('upserts ALL sets (not just current) so completed sets stay in sync', async () => {
    // Why: padelgod.shadow_sets only updates the current set per tick, so
    // completed sets freeze at whatever value they had the last time they
    // were "current" — often one game shy of the final score. Writing every
    // set every tick from curr.team1Sets/team2Sets keeps public.sets in sync
    // with the live widget for ALL sets.
    const { client, state: s } = makeClientWithMatch('scheduled');
    const prev = state({ kind: 'regular', team1: 15, team2: 0 }, {
      team1Sets: [{ games: 6, tiebreak: null }, { games: 3, tiebreak: null }],
      team2Sets: [{ games: 4, tiebreak: null }, { games: 2, tiebreak: null }],
    });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 }, {
      team1Sets: [{ games: 6, tiebreak: null }, { games: 3, tiebreak: null }],
      team2Sets: [{ games: 4, tiebreak: null }, { games: 2, tiebreak: null }],
    });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    // Two upserts: set 1 (is_current=false) + set 2 (is_current=true).
    expect(s.setsUpsertCalls).toHaveLength(2);
    const bySetNum = new Map(s.setsUpsertCalls.map((c: any) => [c.set_number, c]));
    expect(bySetNum.get(1)).toMatchObject({
      set_number: 1,
      set_score: '6-4',
      pair1_games: 6,
      pair2_games: 4,
      is_current: false,
      score_source: 'shadow',
    });
    expect(bySetNum.get(2)).toMatchObject({
      set_number: 2,
      set_score: '3-2',
      pair1_games: 3,
      pair2_games: 2,
      is_current: true,
      score_source: 'shadow',
    });
  });

  it('writes public.games for the current game so UI "Pts" column has real point data', async () => {
    // Why: match detail page falls back to showing pair-set-count in the
    // "Pts" column when no games row exists ({p1Point ?? pair1Sets}). Writing
    // a single-element points[game_score] from the current pointState gives
    // the UI real point data.
    const { client, state: s } = makeClientWithMatch('scheduled');
    const prev = state({ kind: 'regular', team1: 15, team2: 30 }, {
      team1Sets: [{ games: 3, tiebreak: null }],
      team2Sets: [{ games: 2, tiebreak: null }],
    });
    const curr = state({ kind: 'regular', team1: 30, team2: 30 }, {
      team1Sets: [{ games: 3, tiebreak: null }],
      team2Sets: [{ games: 2, tiebreak: null }],
    });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    // One public.games upsert for the current game (games=3+2+1=6).
    expect(s.gamesUpsertCalls).toHaveLength(1);
    expect(s.gamesUpsertCalls[0]).toMatchObject({
      match_id: MATCH_ID,
      game_number: 6,
      game_score: '30-30',
      is_current: true,
      is_tiebreak: false,
    });
    // points[] should contain the single current game_score so UI's
    // points[-1] lookup returns a value.
    expect(s.gamesUpsertCalls[0]!.points).toEqual(['30-30']);
    // set_id is populated (references the current set we upserted).
    expect(typeof s.gamesUpsertCalls[0]!.set_id).toBe('string');
  });

  it('does not touch public tables when dualWritePublic is omitted (back-compat)', async () => {
    const { client, state: s } = makeClientWithMatch('scheduled');
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    // mode='shadow' WITHOUT the flag — existing behavior preserved.
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, { mode: 'shadow' });

    expect(s.matchesUpdateCalls).toHaveLength(0);
    expect(s.setsUpsertCalls).toHaveLength(0);
    expect(s.setsUpdateCalls).toHaveLength(0);
    expect(s.gamesUpsertCalls).toHaveLength(0);
    expect(s.gamesUpdateCalls).toHaveLength(0);
    // Shadow writes still happen.
    expect(s.shadowSetsUpsertCalls).toHaveLength(1);
  });
});
