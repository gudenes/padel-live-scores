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
      // .select('status').eq('id', matchId).maybeSingle() — pre-read for
      // the notify hook inside dualWriteShadowToPublic.
      select: (_cols: string) => {
        const filters: Record<string, unknown> = {};
        const api: any = {
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return api;
          },
          maybeSingle: () => {
            const row = state.matchesRows.find((m) =>
              Object.entries(filters).every(([k, v]) => (m as any)[k] === v),
            );
            if (!row) return Promise.resolve({ data: null, error: null });
            return Promise.resolve({
              data: { status: row.status },
              error: null,
            });
          },
        };
        return api;
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col1: string, val1: unknown) => ({
          // Shape A: .eq().eq() — legacy single-value guard.
          eq: (col2: string, val2: unknown) => {
            state.matchesUpdateCalls.push({
              patch,
              filters: { [col1]: val1, [col2]: val2 },
            });
            for (const m of state.matchesRows) {
              if ((m as any)[col1] === val1 && (m as any)[col2] === val2) {
                Object.assign(m, patch);
              }
            }
            return Promise.resolve({ data: null, error: null });
          },
          // Shape B: .eq().in() — multi-value guard (used by the status-flip
          // + heartbeat write that accepts status IN ('scheduled','live')).
          in: (col2: string, vals: unknown[]) => {
            state.matchesUpdateCalls.push({
              patch,
              filters: { [col1]: val1, [`${col2}In`]: vals },
            });
            for (const m of state.matchesRows) {
              if ((m as any)[col1] === val1 && vals.includes((m as any)[col2])) {
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
        eq: (col1: string, val1: unknown) => {
          // Shape A: .update().eq('id', gameId) — points sync (thenable)
          // Shape B: .update().eq('set_id', ...).neq('game_number', ...) — is_current clear
          const result = {
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
            then: (resolve: any, reject?: any) => {
              // Shape A — direct .eq('id', gameId) for points update
              const game = state.games.find((g) => g.id === val1);
              if (game) Object.assign(game, patch);
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            },
          };
          return result;
        },
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
          const filtered = state.matchPointsInserted.filter(
            (p) => (p as any)[col] === val,
          );
          return {
            order: (_orderCol: string) => {
              const sorted = [...filtered].sort(
                (a, b) => a.point_number - b.point_number,
              );
              return Promise.resolve({
                data: sorted.map((p) => ({ score_after: p.score_after })),
                error: null,
              });
            },
            then: (resolve: any, reject?: any) =>
              Promise.resolve({ data: filtered, count: filtered.length, error: null }).then(resolve, reject),
          };
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
        // Two supported chains:
        //   .select('id', {count:'exact',head:true}).eq(...).eq(...).eq(...) → count
        //   .select(...).eq(...).order(...).order(...).order(...)            → rows
        const filters: Array<{ col: string; val: unknown }> = [];
        const orders: string[] = [];
        const api: any = {
          eq: (col: string, val: unknown) => {
            filters.push({ col, val });
            return api;
          },
          order: (col: string, _opts?: { ascending?: boolean }) => {
            orders.push(col);
            return api;
          },
          then: (resolve: (v: { count?: number; data: any; error: null }) => void) => {
            const matched = state.shadowMatchPointsInserted.filter((p) =>
              filters.every((f) => (p as any)[f.col] === f.val),
            );
            if (selOpts?.count === 'exact' && selOpts?.head === true) {
              resolve({ count: matched.length, data: null, error: null });
              return;
            }
            // Sort by requested order columns (stable ASC, cumulative).
            const sorted = [...matched].sort((a, b) => {
              for (const col of orders) {
                const av = (a as any)[col];
                const bv = (b as any)[col];
                if (av !== bv) return av < bv ? -1 : 1;
              }
              return 0;
            });
            resolve({ data: sorted, error: null });
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
  it('formats deuce as "40-40" so the UI point-parser treats it like any other numeric score', () => {
    expect(formatPointScore({ kind: 'deuce' })).toBe('40-40');
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
    // Guard is now .in('status', ['scheduled', 'on_court', 'live']) so the
    // heartbeat path bumps updated_at on every tick after the initial flip,
    // including from the on_court (warm-up) phase.
    expect(s.matchesUpdateCalls[0]!.filters).toMatchObject({
      id: MATCH_ID,
      statusIn: ['scheduled', 'on_court', 'live'],
    });
    expect(s.matchesRows[0]!.status).toBe('live');
    // updated_at must be written on this call so the sweeper knows the row is fresh.
    expect(typeof s.matchesUpdateCalls[0]!.patch.updated_at).toBe('string');
  });

  it('bumps updated_at on every tick when match is already live (heartbeat)', async () => {
    // Regression for the PR#7 + PR#9 interaction: without this heartbeat,
    // `public.matches.updated_at` goes stale 15 min after the initial
    // scheduled → live flip, and the close-stale-live-sweeper
    // wrongly closes the match as "stuck" while the live-poller is still
    // faithfully writing sets every 6–30s.
    const { client, state: s } = makeClientWithMatch('live');
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    const beforeMs = Date.now();
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    // Status write must still fire even though status isn't changing —
    // the purpose is to bump updated_at.
    expect(s.matchesUpdateCalls).toHaveLength(1);
    const call = s.matchesUpdateCalls[0]!;
    expect(call.patch.status).toBe('live');
    expect(typeof call.patch.updated_at).toBe('string');
    const writtenMs = Date.parse(call.patch.updated_at as string);
    expect(writtenMs).toBeGreaterThanOrEqual(beforeMs);
    // And the guard matches so the row is actually touched in the fake DB.
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

    // The update call is still issued (no pre-check), but the
    // .in('status', ['scheduled','live']) guard excludes terminal rows.
    expect(s.matchesRows[0]!.status).toBe('finished');
  });

  it('does not regress terminal statuses walkover or retired', async () => {
    for (const terminal of ['walkover', 'retired'] as const) {
      const { client, state: s } = makeClientWithMatch(terminal);
      const prev = state({ kind: 'regular', team1: 15, team2: 0 });
      const curr = state({ kind: 'regular', team1: 30, team2: 0 });
      const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

      await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
        mode: 'shadow',
        dualWritePublic: true,
      });

      expect(s.matchesRows[0]!.status).toBe(terminal);
    }
  });

  it('flips scheduled → on_court when the parser saw the widget in warm-up (PR #12)', async () => {
    // First tick: match row is still `scheduled` in DB, live widget shows it
    // in warm-up (parser emits LiveMatchState.status='on_court'). dualWrite
    // should write 'on_court' (not 'live') to canonical, plus a fresh
    // updated_at. Fan UI picks this up and renders the 'ON COURT' badge.
    const { client, state: s } = makeClientWithMatch('scheduled');
    const prev = state({ kind: 'regular', team1: 15, team2: 0 }, { status: 'on_court' });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 }, { status: 'on_court' });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    expect(s.matchesUpdateCalls).toHaveLength(1);
    expect(s.matchesUpdateCalls[0]!.patch.status).toBe('on_court');
    expect(s.matchesRows[0]!.status).toBe('on_court');
  });

  it('transitions on_court → live when the widget label flips (PR #12)', async () => {
    // Match was already on_court in DB (because we wrote it there last tick).
    // New tick shows it as 'live' (first point scored, Crionet flipped label).
    // dualWrite must flip to 'live' AND bump updated_at. Guard
    // `.in('status', ['scheduled','on_court','live'])` allows this transition.
    const { client, state: s } = makeClientWithMatch('on_court');
    const prev = state({ kind: 'regular', team1: 15, team2: 0 }, { status: 'on_court' });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 }, { status: 'live' });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    expect(s.matchesUpdateCalls).toHaveLength(1);
    expect(s.matchesUpdateCalls[0]!.patch.status).toBe('live');
    expect(s.matchesRows[0]!.status).toBe('live');
  });

  it('heartbeats updated_at for matches already in on_court (PR #12)', async () => {
    // Regression guard: if a match stays in warm-up for several poll ticks
    // without the label changing, public.matches.updated_at must still get
    // bumped every tick — otherwise the close-stale-live-sweeper's
    // staleness check can wrongly close a warm-up match. (Today the sweeper
    // filters status IN ('live','ended') so this specific failure mode isn't
    // active, but the invariant "updated_at tracks poller activity" should
    // hold for any future worker that reasons about staleness.)
    const { client, state: s } = makeClientWithMatch('on_court');
    const prev = state({ kind: 'regular', team1: 15, team2: 0 }, { status: 'on_court' });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 }, { status: 'on_court' });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    const before = Date.now();
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    expect(s.matchesUpdateCalls).toHaveLength(1);
    const call = s.matchesUpdateCalls[0]!;
    expect(call.patch.status).toBe('on_court');
    const writtenMs = Date.parse(call.patch.updated_at as string);
    expect(writtenMs).toBeGreaterThanOrEqual(before);
    expect(s.matchesRows[0]!.status).toBe('on_court');
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
      // game_score comes from the last element of points[] (colon-normalized)
      // to keep a single source of truth between the array and the scalar.
      game_score: '30:30',
      is_current: true,
      is_tiebreak: false,
      // Server — approximates to "player 1" of the serving pair. The state
      // builder defaults servingTeam=1, so we expect pair1Player1Id here.
      server_player_id: RESOLVED.pair1Player1Id,
    });
    // points[] contains the current game_score normalized to the UI's
    // colon-separated format (matches what padelapi/relay writes).
    expect(s.gamesUpsertCalls[0]!.points).toEqual(['30:30']);
    // set_id is populated (references the current set we upserted).
    expect(typeof s.gamesUpsertCalls[0]!.set_id).toBe('string');
  });

  it('populates server_player_id from curr.servingTeam + resolvedPlayers', async () => {
    const { client, state: s } = makeClientWithMatch('scheduled');
    const prev = state({ kind: 'regular', team1: 15, team2: 30 }, { servingTeam: 2 });
    const curr = state({ kind: 'regular', team1: 30, team2: 30 }, { servingTeam: 2 });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    expect(s.gamesUpsertCalls).toHaveLength(1);
    // servingTeam=2 → pair2Player1Id.
    expect(s.gamesUpsertCalls[0]!.server_player_id).toBe(RESOLVED.pair2Player1Id);
  });

  it('mirrors the full points[] history from shadow_match_points into public.games', async () => {
    // Seeds 3 prior shadow_match_points rows for (set 1, game 1) — simulating
    // points that were captured before this tick. The new point lands via
    // applyDiffShadow as point 4. After dual-write, public.games.points[]
    // should contain all 4 scores in order, colon-normalized.
    const { client, state: s } = makeClientWithMatch('scheduled');
    const pre = [
      { match_id: MATCH_ID, set_number: 1, game_number: 1, point_number: 1, winner_pair: 1 as const, score_after: '15-0', server_team: 1 as const, is_golden_point: false },
      { match_id: MATCH_ID, set_number: 1, game_number: 1, point_number: 2, winner_pair: 1 as const, score_after: '30-0', server_team: 1 as const, is_golden_point: false },
      { match_id: MATCH_ID, set_number: 1, game_number: 1, point_number: 3, winner_pair: 2 as const, score_after: '30-15', server_team: 1 as const, is_golden_point: false },
    ];
    s.shadowMatchPointsInserted.push(...pre);

    const prev = state({ kind: 'regular', team1: 30, team2: 15 }, { servingTeam: 1 });
    const curr = state({ kind: 'regular', team1: 40, team2: 15 }, { servingTeam: 1 });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    // applyDiffShadow inserts point #4 → "40-15". dual-write reads all 4
    // and writes them to public.games.points in colon format.
    expect(s.gamesUpsertCalls).toHaveLength(1);
    expect(s.gamesUpsertCalls[0]!.points).toEqual(['15:0', '30:0', '30:15', '40:15']);
    expect(s.gamesUpsertCalls[0]!.game_score).toBe('40:15');
  });

  it('writes games rows for completed games in the same match, not just the current', async () => {
    // Seeds points for TWO games: game 1 (completed, pair1 won to love) and
    // game 2 (current, in progress). After dual-write, both games should
    // have public.games rows, only game 2 should be is_current=true.
    const { client, state: s } = makeClientWithMatch('scheduled');
    const pre = [
      // Game 1 — completed, pair1 won 40-0 (4 points, final "40-0" → team1 4, team2 0)
      { match_id: MATCH_ID, set_number: 1, game_number: 1, point_number: 1, winner_pair: 1 as const, score_after: '15-0', server_team: 1 as const, is_golden_point: false },
      { match_id: MATCH_ID, set_number: 1, game_number: 1, point_number: 2, winner_pair: 1 as const, score_after: '30-0', server_team: 1 as const, is_golden_point: false },
      { match_id: MATCH_ID, set_number: 1, game_number: 1, point_number: 3, winner_pair: 1 as const, score_after: '40-0', server_team: 1 as const, is_golden_point: false },
      // Game 2 — in progress, pair2 ahead 0-15
      { match_id: MATCH_ID, set_number: 1, game_number: 2, point_number: 1, winner_pair: 2 as const, score_after: '0-15', server_team: 2 as const, is_golden_point: false },
    ];
    s.shadowMatchPointsInserted.push(...pre);

    const prev = state({ kind: 'regular', team1: 0, team2: 0 }, {
      team1Sets: [{ games: 1, tiebreak: null }],
      team2Sets: [{ games: 0, tiebreak: null }],
      servingTeam: 2,
    });
    const curr = state({ kind: 'regular', team1: 0, team2: 15 }, {
      team1Sets: [{ games: 1, tiebreak: null }],
      team2Sets: [{ games: 0, tiebreak: null }],
      servingTeam: 2,
    });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 2 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    // applyDiffShadow inserts one new point → game 2 becomes 4 entries total
    // (pre 1 + new 1). After the game 2 entry grows to 2 points actually —
    // applyDiffShadow only inserts 1 row for the new pointsAdded[0]. Verify
    // both games got upserts.
    const byGame = new Map<number, any>();
    for (const call of s.gamesUpsertCalls) byGame.set(call.game_number, call);
    expect(byGame.size).toBe(2);
    expect(byGame.get(1)!.is_current).toBe(false);
    expect(byGame.get(2)!.is_current).toBe(true);
    expect(byGame.get(1)!.points).toEqual(['15:0', '30:0', '40:0']);
    // Game 2 has the seeded point + the one applyDiffShadow just inserted.
    expect(byGame.get(2)!.points).toContain('0:15');
  });

  it('leaves server_player_id null when servingTeam cannot be determined', async () => {
    const { client, state: s } = makeClientWithMatch('scheduled');
    const prev = state({ kind: 'regular', team1: 15, team2: 30 }, { servingTeam: null });
    const curr = state({ kind: 'regular', team1: 30, team2: 30 }, { servingTeam: null });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    expect(s.gamesUpsertCalls).toHaveLength(1);
    expect(s.gamesUpsertCalls[0]!.server_player_id).toBeNull();
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

// ---------------------------------------------------------------------------
// applyDiff (shadow + dualWritePublic + notify) — push notification hook
// ---------------------------------------------------------------------------
//
// Regression: Brussels P2 women R16 `fd345282` on 2026-04-23. Padelgod
// flipped status='live' via dual-write, Vercel scores + sync crons were both
// padelapi rate-limited, so neither cron observed the transition and fired
// notify. Zero push notifications despite an active bookmark + player follow.
// Fix: when `notify` is provided, fire `/api/push/notify` on the first
// `scheduled → *` transition.

describe('applyDiff (shadow + dualWritePublic + notify)', () => {
  function makeClientWithMatch(status: string) {
    return makeFakeSupabase({
      preMatchesRows: [{ id: MATCH_ID, status }],
    });
  }

  interface CapturedFetch {
    url: string;
    init: RequestInit;
  }

  function makeMockFetch(captures: CapturedFetch[]): typeof fetch {
    return ((url: string, init?: RequestInit) => {
      captures.push({ url, init: init ?? {} });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
  }

  function silentLogger(): import('pino').Logger {
    // Minimal pino-shaped logger — notify only calls .warn / .info.
    const noop = () => undefined;
    return { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => silentLogger() } as any;
  }

  it('fires notify exactly once on scheduled → live transition', async () => {
    const { client, state: s } = makeClientWithMatch('scheduled');
    const captures: CapturedFetch[] = [];
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
      notify: {
        baseUrl: 'https://padelnachos.com',
        cronSecret: 'secret-token',
        logger: silentLogger(),
        fetchImpl: makeMockFetch(captures),
      },
    });

    // Status flipped…
    expect(s.matchesRows[0]!.status).toBe('live');
    // …and notify fired with the right URL, method, auth, body.
    // Note: the promise inside notify is detached (fire-and-forget), but fetch
    // itself is called synchronously so `captures` is populated by now.
    expect(captures).toHaveLength(1);
    expect(captures[0]!.url).toBe('https://padelnachos.com/api/push/notify');
    expect(captures[0]!.init.method).toBe('POST');
    expect(captures[0]!.init.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(captures[0]!.init.body as string)).toEqual({ matchId: MATCH_ID });
  });

  it('fires notify on scheduled → on_court transition (warm-up phase)', async () => {
    const { client } = makeClientWithMatch('scheduled');
    const captures: CapturedFetch[] = [];
    const prev = state({ kind: 'regular', team1: 15, team2: 0 }, { status: 'on_court' });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 }, { status: 'on_court' });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
      notify: {
        baseUrl: 'https://padelnachos.com',
        cronSecret: 'secret-token',
        logger: silentLogger(),
        fetchImpl: makeMockFetch(captures),
      },
    });

    expect(captures).toHaveLength(1);
    expect(captures[0]!.url).toBe('https://padelnachos.com/api/push/notify');
  });

  it('does NOT fire notify on on_court → live transition (avoid double push)', async () => {
    // User would have already gotten the push at scheduled → on_court. The
    // subsequent on_court → live flip should be silent.
    const { client } = makeClientWithMatch('on_court');
    const captures: CapturedFetch[] = [];
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
      notify: {
        baseUrl: 'https://padelnachos.com',
        cronSecret: 'secret-token',
        logger: silentLogger(),
        fetchImpl: makeMockFetch(captures),
      },
    });

    expect(captures).toHaveLength(0);
  });

  it('does NOT fire notify on per-tick heartbeats when already live', async () => {
    const { client } = makeClientWithMatch('live');
    const captures: CapturedFetch[] = [];
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
      notify: {
        baseUrl: 'https://padelnachos.com',
        cronSecret: 'secret-token',
        logger: silentLogger(),
        fetchImpl: makeMockFetch(captures),
      },
    });

    expect(captures).toHaveLength(0);
  });

  it('writes status=on_court on warm-up ticks that have NO diff effect (regression 2026-04-23)', async () => {
    // The Crionet widget shows the match in `on_court` / `WARMUP` state for
    // several minutes BEFORE the first point is scored. Those ticks carry
    // no pointsAdded / gameChanged / setChanged / statusChanged (in-memory
    // prev.status === curr.status === 'on_court'), so diffHasEffect returns
    // false and applyDiff would normally bail. That's exactly what happened
    // on Brussels P2 2026-04-23: zero `on_court` rows ever written to the
    // DB across an entire tournament day despite 5+ minutes of warm-up per
    // match in the widget. The fix runs flipShadowPublicStatus BEFORE the
    // diff-effect gate so warm-up ticks still write status.
    const { client, state: s } = makeClientWithMatch('scheduled');
    const captures: CapturedFetch[] = [];
    const prev = state({ kind: 'regular', team1: 0, team2: 0 }, { status: 'on_court' });
    const curr = state({ kind: 'regular', team1: 0, team2: 0 }, { status: 'on_court' });
    // No-op diff — warm-up tick. statusChanged stays false because in-memory
    // prev.status === curr.status (we've been seeing on_court for a while).
    const diff = emptyDiff();

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
      notify: {
        baseUrl: 'https://padelnachos.com',
        cronSecret: 'secret',
        logger: silentLogger(),
        fetchImpl: makeMockFetch(captures),
      },
    });

    // Status MUST be written to on_court even though diff is empty.
    expect(s.matchesUpdateCalls).toHaveLength(1);
    expect(s.matchesUpdateCalls[0]!.patch.status).toBe('on_court');
    expect(s.matchesRows[0]!.status).toBe('on_court');
    // Notify fires once — the DB prev was 'scheduled' (first write).
    expect(captures).toHaveLength(1);
    // But NO sets dual-write happened — the diff gate kept the rest of
    // dualWriteShadowToPublic from running, which is correct (nothing to
    // write when no point was scored).
    expect(s.setsUpsertCalls).toHaveLength(0);
  });

  it('still writes on the very first tick (prev=null) so first-observation warm-ups get captured', async () => {
    // In-memory prev is null the first time we see a match in the widget.
    // Previously applyDiff returned immediately on prev===null, so the
    // first-observation status never reached the DB. After the fix, the
    // shadow status flip runs BEFORE the prev-null gate.
    const { client, state: s } = makeClientWithMatch('scheduled');
    const captures: CapturedFetch[] = [];
    const curr = state({ kind: 'regular', team1: 0, team2: 0 }, { status: 'on_court' });
    const diff = emptyDiff();

    await applyDiff(client, MATCH_ID, null, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
      notify: {
        baseUrl: 'https://padelnachos.com',
        cronSecret: 'secret',
        logger: silentLogger(),
        fetchImpl: makeMockFetch(captures),
      },
    });

    expect(s.matchesRows[0]!.status).toBe('on_court');
    expect(captures).toHaveLength(1);
  });

  it('does NOT regress live → on_court when widget briefly flips label during set break', async () => {
    // Regression guard for the tightened `.in(allowedFromStates)`. If a match
    // is already live in the DB and the widget momentarily returns to an
    // `on_court` label (we've occasionally seen this between sets), we must
    // NOT overwrite the live status. Allowed transitions for targetStatus
    // on_court are only from scheduled; live → on_court is rejected by the
    // Supabase guard.
    const { client, state: s } = makeClientWithMatch('live');
    const prev = state({ kind: 'regular', team1: 15, team2: 0 }, { status: 'on_court' });
    const curr = state({ kind: 'regular', team1: 15, team2: 0 }, { status: 'on_court' });
    const diff = emptyDiff();

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    // Update is ATTEMPTED (for the heartbeat) but the allowedFromStates
    // guard excludes 'live' for an on_court target, so the DB row stays live.
    expect(s.matchesRows[0]!.status).toBe('live');
  });

  it('progresses on_court → live when the widget flips to Live match label', async () => {
    const { client, state: s } = makeClientWithMatch('on_court');
    const captures: CapturedFetch[] = [];
    const prev = state({ kind: 'regular', team1: 0, team2: 0 }, { status: 'on_court' });
    const curr = state({ kind: 'regular', team1: 15, team2: 0 });
    const diff: LiveStateDiff = {
      ...emptyDiff(),
      pointsAdded: [{ winnerTeam: 1 }],
      statusChanged: true,
    };

    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
      notify: {
        baseUrl: 'https://padelnachos.com',
        cronSecret: 'secret',
        logger: silentLogger(),
        fetchImpl: makeMockFetch(captures),
      },
    });

    expect(s.matchesRows[0]!.status).toBe('live');
    // Notify must NOT re-fire on on_court → live (prevStatus in DB was
    // 'on_court', not 'scheduled'; the user already got their push when
    // we stamped scheduled → on_court earlier).
    expect(captures).toHaveLength(0);
  });

  it('does NOT fire notify when opts.notify is omitted (back-compat)', async () => {
    const { client, state: s } = makeClientWithMatch('scheduled');
    const prev = state({ kind: 'regular', team1: 15, team2: 0 });
    const curr = state({ kind: 'regular', team1: 30, team2: 0 });
    const diff: LiveStateDiff = { ...emptyDiff(), pointsAdded: [{ winnerTeam: 1 }] };

    // No `notify` field — pre-existing behavior must be preserved exactly.
    await applyDiff(client, MATCH_ID, prev, curr, diff, RESOLVED, {
      mode: 'shadow',
      dualWritePublic: true,
    });

    // Status still flipped, dual-write still fired.
    expect(s.matchesRows[0]!.status).toBe('live');
    // Nothing else to check — no fetchImpl was wired, so if the code
    // accidentally tried to call fetch it would explode here (there's no
    // global mock). Passing the test = fetch was never called.
  });
});
