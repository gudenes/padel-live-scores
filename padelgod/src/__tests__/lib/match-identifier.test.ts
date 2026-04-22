import { describe, it, expect, vi } from 'vitest';
import {
  findLinkedMatchWithCompleteFks,
  findOrCreateMatch,
  type MatchIdentifierInput,
} from '../../lib/match-identifier.js';

// ---------------------------------------------------------------------------
// Mock Supabase builder
// ---------------------------------------------------------------------------
//
// The match-identifier lib issues these distinct query shapes against the
// default (public) schema:
//
//   SELECT on entity_external_ids + .eq().eq().eq() + .maybeSingle()
//     → widget-id lookup
//   SELECT on entity_external_ids + .eq().eq().in() (no terminator)
//     → mapped-check when multiple pair candidates
//   SELECT on matches + .eq().eq().eq() (no terminator — awaited directly)
//     → pair-based fallback candidates
//   INSERT on matches + .select().single()
//     → fresh match
//   UPSERT on entity_external_ids + .select()
//     → widget-id link (onConflict + ignoreDuplicates)
//
// `Thenable` helpers wrap terminal chains so both `await q` and
// `await q.maybeSingle()`/`await q.single()` work.

interface State {
  // entity_external_ids rows keyed by external_id
  eids: Map<string, { entity_id: string; external_id: string }>;
  // matches rows (id → row)
  matches: Map<
    string,
    {
      id: string;
      tournament_id: string;
      category: string;
      round: string;
      court: string | null;
      pair1_player1_id: string | null;
      pair1_player2_id: string | null;
      pair2_player1_id: string | null;
      pair2_player2_id: string | null;
      // Optional — only set on padelapi-sync'd rows; used by the padelapi-twin
      // fallback lookup (added in PR #2).
      padelapi_id?: string | null;
      scheduled_at?: string | null;
    }
  >;
  // Called on every entity_external_ids upsert. Lets tests simulate a
  // concurrent race by mutating `eids` between lookups.
  onEidUpsert?: (row: {
    entity_type: string;
    entity_id: string;
    source: string;
    external_id: string;
  }) => void;
  nextMatchId: () => string;
}

function makeThenable<T>(value: () => T | Promise<T>) {
  return {
    then: (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(value()).then(resolve, reject),
  };
}

function fakeSupabase(state: State) {
  return {
    from(table: string) {
      if (table === 'entity_external_ids') {
        return eidBuilder(state);
      }
      if (table === 'matches') {
        return matchesBuilder(state);
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

// ---------------------------- entity_external_ids ----------------------------
function eidBuilder(state: State) {
  return {
    select(_cols: string) {
      const filters: { col: string; op: 'eq' | 'in'; value: unknown }[] = [];
      const self: any = {
        eq(col: string, value: unknown) {
          filters.push({ col, op: 'eq', value });
          return self;
        },
        in(col: string, values: unknown[]) {
          filters.push({ col, op: 'in', value: values });
          return self;
        },
        async maybeSingle() {
          const rows = applyEidFilters(state, filters);
          return { data: rows[0] ?? null, error: null };
        },
        // Await-directly terminator — for the `mapped-check` .in() query
        then(resolve: any, reject?: any) {
          const rows = applyEidFilters(state, filters);
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return self;
    },
    upsert(
      row: {
        entity_type: string;
        entity_id: string;
        source: string;
        external_id: string;
      },
      opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
    ) {
      // Allow the test to observe + react to the upsert (for race simulation)
      state.onEidUpsert?.(row);

      const existing = state.eids.get(row.external_id);
      let won: boolean;
      if (existing) {
        if (opts.ignoreDuplicates) {
          won = false;
        } else {
          // Without ignoreDuplicates, upsert overwrites.
          state.eids.set(row.external_id, {
            entity_id: row.entity_id,
            external_id: row.external_id,
          });
          won = true;
        }
      } else {
        state.eids.set(row.external_id, {
          entity_id: row.entity_id,
          external_id: row.external_id,
        });
        won = true;
      }
      return {
        select(_cols: string) {
          return makeThenable(() => ({
            data: won
              ? [{ entity_id: state.eids.get(row.external_id)!.entity_id }]
              : [],
            error: null,
          }));
        },
      };
    },
  };
}

function applyEidFilters(
  state: State,
  filters: { col: string; op: 'eq' | 'in'; value: unknown }[]
) {
  const all = Array.from(state.eids.values()).map((r) => ({
    entity_type: 'match',
    entity_id: r.entity_id,
    source: 'crionet_widget',
    external_id: r.external_id,
  }));
  return all.filter((r) =>
    filters.every((f) => {
      const actual = (r as any)[f.col];
      if (f.op === 'eq') return actual === f.value;
      if (f.op === 'in') return (f.value as unknown[]).includes(actual);
      return false;
    })
  );
}

// -------------------------------- matches ----------------------------------
function matchesBuilder(state: State) {
  return {
    select(_cols: string) {
      // Each filter is applied as AND. `ilike` compares case-insensitively for
      // both sides (no wildcard semantics needed for our usage). `not` with
      // ('col', 'is', null) means "col IS NOT NULL".
      type Filter =
        | { op: 'eq'; col: string; value: unknown }
        | { op: 'ilike'; col: string; value: string }
        | { op: 'notIsNull'; col: string };
      const filters: Filter[] = [];
      const self: any = {
        eq(col: string, value: unknown) {
          filters.push({ op: 'eq', col, value });
          return self;
        },
        ilike(col: string, value: string) {
          filters.push({ op: 'ilike', col, value });
          return self;
        },
        not(col: string, op: string, value: unknown) {
          if (op === 'is' && value === null) {
            filters.push({ op: 'notIsNull', col });
            return self;
          }
          throw new Error(`unsupported not() in matchesBuilder mock: ${col} ${op} ${String(value)}`);
        },
        then(resolve: any, reject?: any) {
          const rows = Array.from(state.matches.values()).filter((r) =>
            filters.every((f) => {
              const actual = (r as any)[f.col];
              if (f.op === 'eq') return actual === f.value;
              if (f.op === 'ilike')
                return (
                  typeof actual === 'string' &&
                  actual.toLowerCase() === f.value.toLowerCase()
                );
              if (f.op === 'notIsNull')
                return actual !== null && actual !== undefined;
              return false;
            })
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
        async maybeSingle() {
          // Terminator used by findLinkedMatchWithCompleteFks to fetch a single
          // match row by id. Applies the same filter set as the awaited path.
          const rows = Array.from(state.matches.values()).filter((r) =>
            filters.every((f) => {
              const actual = (r as any)[f.col];
              if (f.op === 'eq') return actual === f.value;
              if (f.op === 'ilike')
                return (
                  typeof actual === 'string' &&
                  actual.toLowerCase() === f.value.toLowerCase()
                );
              if (f.op === 'notIsNull')
                return actual !== null && actual !== undefined;
              return false;
            })
          );
          return { data: rows[0] ?? null, error: null };
        },
      };
      return self;
    },
    insert(row: any) {
      const id = state.nextMatchId();
      const full = {
        id,
        tournament_id: row.tournament_id,
        category: row.category,
        round: row.round,
        court: row.court ?? null,
        pair1_player1_id: row.pair1_player1_id ?? null,
        pair1_player2_id: row.pair1_player2_id ?? null,
        pair2_player1_id: row.pair2_player1_id ?? null,
        pair2_player2_id: row.pair2_player2_id ?? null,
      };
      state.matches.set(id, full);
      return {
        select(_c: string) {
          return {
            async single() {
              return { data: { id }, error: null };
            },
          };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<State> = {}): State {
  let counter = 0;
  return {
    eids: new Map(),
    matches: new Map(),
    nextMatchId: () => {
      counter += 1;
      return `new-match-${counter}`;
    },
    ...overrides,
  };
}

const BASE_INPUT: MatchIdentifierInput = {
  tournamentId: 'tour-1',
  tournamentWidgetId: 'FIP-2026-1701',
  matchWidgetId: 'MQ012',
  category: 'men',
  roundLabel: 'Quarter-Finals',
  court: 'Court 1',
};

const COMPOSITE = 'FIP-2026-1701:MQ012';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('findOrCreateMatch', () => {
  it('returns existing match id when entity_external_ids has a mapping', async () => {
    const state = makeState();
    state.matches.set('existing-uuid', {
      id: 'existing-uuid',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: null,
      pair1_player1_id: null,
      pair1_player2_id: null,
      pair2_player1_id: null,
      pair2_player2_id: null,
    });
    state.eids.set(COMPOSITE, {
      entity_id: 'existing-uuid',
      external_id: COMPOSITE,
    });

    const supabase = fakeSupabase(state);
    const result = await findOrCreateMatch(supabase as any, BASE_INPUT);

    expect(result).toEqual({
      matchId: 'existing-uuid',
      created: false,
      linkedExisting: false,
    });
    // No new rows inserted
    expect(state.matches.size).toBe(1);
    expect(state.eids.size).toBe(1);
  });

  it('creates a new match + entity_external_ids row when neither widget id nor pair match exists', async () => {
    const state = makeState();
    const supabase = fakeSupabase(state);

    const result = await findOrCreateMatch(supabase as any, {
      ...BASE_INPUT,
      pair1PlayerIds: ['p-A', 'p-B'],
      pair2PlayerIds: ['p-C', 'p-D'],
    });

    expect(result.created).toBe(true);
    expect(result.linkedExisting).toBe(false);
    expect(result.matchId).toBe('new-match-1');
    expect(state.matches.size).toBe(1);
    expect(state.eids.size).toBe(1);
    expect(state.eids.get(COMPOSITE)?.entity_id).toBe('new-match-1');
    // Fresh match row should carry the player FKs we passed in
    const m = state.matches.get('new-match-1')!;
    expect(m.pair1_player1_id).toBe('p-A');
    expect(m.pair2_player2_id).toBe('p-D');
  });

  it('pair-based fallback links a pre-existing draw-only match (no widget id yet)', async () => {
    const state = makeState();
    // Seed a draw-only match: has player UUIDs, no entity_external_ids row
    state.matches.set('draw-match-uuid', {
      id: 'draw-match-uuid',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: null,
      pair1_player1_id: 'p-A',
      pair1_player2_id: 'p-B',
      pair2_player1_id: 'p-C',
      pair2_player2_id: 'p-D',
    });

    const supabase = fakeSupabase(state);
    const result = await findOrCreateMatch(supabase as any, {
      ...BASE_INPUT,
      pair1PlayerIds: ['p-A', 'p-B'],
      pair2PlayerIds: ['p-C', 'p-D'],
    });

    expect(result).toEqual({
      matchId: 'draw-match-uuid',
      created: false,
      linkedExisting: true,
    });
    // Only the seeded matches row should exist (no duplicate)
    expect(state.matches.size).toBe(1);
    // entity_external_ids should now carry the link
    expect(state.eids.size).toBe(1);
    expect(state.eids.get(COMPOSITE)?.entity_id).toBe('draw-match-uuid');
  });

  it('pair-based fallback handles reversed team order', async () => {
    const state = makeState();
    // DB has pair1={A,B}, pair2={C,D}
    state.matches.set('draw-match-uuid', {
      id: 'draw-match-uuid',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: null,
      pair1_player1_id: 'p-A',
      pair1_player2_id: 'p-B',
      pair2_player1_id: 'p-C',
      pair2_player2_id: 'p-D',
    });

    const supabase = fakeSupabase(state);
    // Widget provides team1={C,D}, team2={A,B}
    const result = await findOrCreateMatch(supabase as any, {
      ...BASE_INPUT,
      pair1PlayerIds: ['p-C', 'p-D'],
      pair2PlayerIds: ['p-A', 'p-B'],
    });

    expect(result.matchId).toBe('draw-match-uuid');
    expect(result.created).toBe(false);
    expect(result.linkedExisting).toBe(true);
    expect(state.matches.size).toBe(1);
  });

  it('skips pair-based fallback when any player UUID is null — falls through to INSERT', async () => {
    const state = makeState();
    // Seed a draw-only match with full pairs; caller has a null so we must NOT match it
    state.matches.set('draw-match-uuid', {
      id: 'draw-match-uuid',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: null,
      pair1_player1_id: 'p-A',
      pair1_player2_id: 'p-B',
      pair2_player1_id: 'p-C',
      pair2_player2_id: 'p-D',
    });

    const supabase = fakeSupabase(state);
    const result = await findOrCreateMatch(supabase as any, {
      ...BASE_INPUT,
      pair1PlayerIds: ['p-A', null],
      pair2PlayerIds: ['p-C', 'p-D'],
    });

    expect(result.created).toBe(true);
    expect(result.linkedExisting).toBe(false);
    expect(result.matchId).toBe('new-match-1');
    // Both the draw-only row and the new thin row should exist
    expect(state.matches.size).toBe(2);
    expect(state.eids.get(COMPOSITE)?.entity_id).toBe('new-match-1');
  });

  it('handles concurrent create gracefully (re-runs lookup after conflict)', async () => {
    const state = makeState();

    // Simulate another worker winning the race: just before our upsert lands,
    // pretend a concurrent process inserted the eid row pointing at a different
    // match. When our upsert runs with ignoreDuplicates=true, it will no-op.
    const winnerId = 'concurrent-winner-uuid';
    state.matches.set(winnerId, {
      id: winnerId,
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: null,
      pair1_player1_id: null,
      pair1_player2_id: null,
      pair2_player1_id: null,
      pair2_player2_id: null,
    });

    let triggered = false;
    state.onEidUpsert = () => {
      if (!triggered) {
        triggered = true;
        // Plant the winner's mapping before our upsert commits.
        state.eids.set(COMPOSITE, {
          entity_id: winnerId,
          external_id: COMPOSITE,
        });
      }
    };

    const supabase = fakeSupabase(state);
    const result = await findOrCreateMatch(supabase as any, BASE_INPUT);

    expect(result.matchId).toBe(winnerId);
    expect(result.created).toBe(false);
    expect(result.linkedExisting).toBe(false);
  });

  it('padelapi-twin fallback: links widget to a single padelapi-owned row with a case-insensitive court match', async () => {
    const state = makeState();
    // Seed a padelapi-sync'd row: full pair FKs, padelapi_id, TitleCase court.
    state.matches.set('padelapi-twin-uuid', {
      id: 'padelapi-twin-uuid',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: 'Court 1',
      padelapi_id: '8376',
      scheduled_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
      pair1_player1_id: 'p-A',
      pair1_player2_id: 'p-B',
      pair2_player1_id: 'p-C',
      pair2_player2_id: 'p-D',
    });

    const supabase = fakeSupabase(state);
    // Live poller input: UPPERCASE court (as Crionet emits), NO pair IDs.
    const result = await findOrCreateMatch(supabase as any, {
      ...BASE_INPUT,
      court: 'COURT 1',
      // pair*PlayerIds intentionally undefined — this is the Premier live-poller path
    });

    expect(result.matchId).toBe('padelapi-twin-uuid');
    expect(result.created).toBe(false);
    expect(result.linkedExisting).toBe(true);
    // No duplicate thin row should have been inserted.
    expect(state.matches.size).toBe(1);
    // Crionet widget id must now point at the padelapi-owned row.
    expect(state.eids.get(COMPOSITE)?.entity_id).toBe('padelapi-twin-uuid');
  });

  it('padelapi-twin fallback: disambiguates multiple unmapped same-court rows by scheduled_at proximity', async () => {
    const state = makeState();
    const now = Date.now();
    // Same court hosts three matches across the tournament day.
    // (a) 8 hours ago — earlier slot, already finished.
    // (b) 30 min ago — the match currently playing (closest to now).
    // (c) 6 hours from now — later slot, not started.
    state.matches.set('earlier-slot', {
      id: 'earlier-slot',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: 'Court 1',
      padelapi_id: '8001',
      scheduled_at: new Date(now - 8 * 60 * 60 * 1000).toISOString(),
      pair1_player1_id: 'p-A',
      pair1_player2_id: 'p-B',
      pair2_player1_id: 'p-C',
      pair2_player2_id: 'p-D',
    });
    state.matches.set('current-slot', {
      id: 'current-slot',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: 'Court 1',
      padelapi_id: '8002',
      scheduled_at: new Date(now - 30 * 60 * 1000).toISOString(),
      pair1_player1_id: 'p-E',
      pair1_player2_id: 'p-F',
      pair2_player1_id: 'p-G',
      pair2_player2_id: 'p-H',
    });
    state.matches.set('later-slot', {
      id: 'later-slot',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: 'Court 1',
      padelapi_id: '8003',
      scheduled_at: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
      pair1_player1_id: 'p-I',
      pair1_player2_id: 'p-J',
      pair2_player1_id: 'p-K',
      pair2_player2_id: 'p-L',
    });

    const supabase = fakeSupabase(state);
    const logger = { warn: vi.fn() };
    const result = await findOrCreateMatch(
      supabase as any,
      { ...BASE_INPUT, court: 'COURT 1' },
      { logger }
    );

    // Expect the "currently playing" slot — not the earlier one, not the later one.
    expect(result.matchId).toBe('current-slot');
    expect(result.linkedExisting).toBe(true);
    expect(logger.warn).toHaveBeenCalledOnce();
    // No new row created.
    expect(state.matches.size).toBe(3);
    expect(state.eids.get(COMPOSITE)?.entity_id).toBe('current-slot');
  });

  it('padelapi-twin fallback: skips when no court provided, falls through to INSERT', async () => {
    const state = makeState();
    // A padelapi twin exists but caller has no court — we can't court-match.
    state.matches.set('padelapi-twin-uuid', {
      id: 'padelapi-twin-uuid',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: 'Court 1',
      padelapi_id: '8376',
      scheduled_at: new Date().toISOString(),
      pair1_player1_id: 'p-A',
      pair1_player2_id: 'p-B',
      pair2_player1_id: 'p-C',
      pair2_player2_id: 'p-D',
    });

    const supabase = fakeSupabase(state);
    const result = await findOrCreateMatch(supabase as any, {
      ...BASE_INPUT,
      court: null,
    });

    // Falls through to step 4 (INSERT) since no court → no twin lookup.
    expect(result.created).toBe(true);
    expect(result.matchId).toBe('new-match-1');
    expect(state.matches.size).toBe(2);
  });

  it('prefers the unmapped candidate when pair-based fallback finds multiple matches', async () => {
    const state = makeState();
    // Two rows in the same (tournament, category, round) with identical pairs.
    state.matches.set('mapped-uuid', {
      id: 'mapped-uuid',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: null,
      pair1_player1_id: 'p-A',
      pair1_player2_id: 'p-B',
      pair2_player1_id: 'p-C',
      pair2_player2_id: 'p-D',
    });
    state.matches.set('unmapped-uuid', {
      id: 'unmapped-uuid',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: null,
      pair1_player1_id: 'p-A',
      pair1_player2_id: 'p-B',
      pair2_player1_id: 'p-C',
      pair2_player2_id: 'p-D',
    });
    // mapped-uuid has an unrelated widget-id mapping already
    state.eids.set('FIP-2026-1701:MOLD', {
      entity_id: 'mapped-uuid',
      external_id: 'FIP-2026-1701:MOLD',
    });

    const supabase = fakeSupabase(state);
    const logger = { warn: vi.fn() };
    const result = await findOrCreateMatch(
      supabase as any,
      {
        ...BASE_INPUT,
        pair1PlayerIds: ['p-A', 'p-B'],
        pair2PlayerIds: ['p-C', 'p-D'],
      },
      { logger }
    );

    expect(result.matchId).toBe('unmapped-uuid');
    expect(result.linkedExisting).toBe(true);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe('findLinkedMatchWithCompleteFks', () => {
  it('returns the match id when widget mapping exists AND all 4 FKs are populated', async () => {
    const state = makeState();
    state.matches.set('linked-uuid', {
      id: 'linked-uuid',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: null,
      pair1_player1_id: 'p-A',
      pair1_player2_id: 'p-B',
      pair2_player1_id: 'p-C',
      pair2_player2_id: 'p-D',
    });
    state.eids.set(COMPOSITE, {
      entity_id: 'linked-uuid',
      external_id: COMPOSITE,
    });

    const supabase = fakeSupabase(state);
    const result = await findLinkedMatchWithCompleteFks(
      supabase as any,
      'FIP-2026-1701',
      'MQ012'
    );
    expect(result).toBe('linked-uuid');
  });

  it('returns null when no widget mapping exists (Premier tournament, never linked)', async () => {
    const state = makeState();
    const supabase = fakeSupabase(state);
    const result = await findLinkedMatchWithCompleteFks(
      supabase as any,
      'FIP-2026-1701',
      'MQ012'
    );
    expect(result).toBeNull();
  });

  it('returns null when widget mapping exists but ANY FK is null (thin row)', async () => {
    const state = makeState();
    state.matches.set('thin-uuid', {
      id: 'thin-uuid',
      tournament_id: 'tour-1',
      category: 'men',
      round: 'Quarter-Finals',
      court: null,
      pair1_player1_id: 'p-A',
      pair1_player2_id: 'p-B',
      pair2_player1_id: 'p-C',
      pair2_player2_id: null, // ← incomplete
    });
    state.eids.set(COMPOSITE, {
      entity_id: 'thin-uuid',
      external_id: COMPOSITE,
    });

    const supabase = fakeSupabase(state);
    const result = await findLinkedMatchWithCompleteFks(
      supabase as any,
      'FIP-2026-1701',
      'MQ012'
    );
    expect(result).toBeNull();
  });

  it('returns null when widget mapping exists but the match row is missing (dangling reference)', async () => {
    const state = makeState();
    state.eids.set(COMPOSITE, {
      entity_id: 'ghost-uuid',
      external_id: COMPOSITE,
    });
    // No matches row for ghost-uuid.

    const supabase = fakeSupabase(state);
    const result = await findLinkedMatchWithCompleteFks(
      supabase as any,
      'FIP-2026-1701',
      'MQ012'
    );
    expect(result).toBeNull();
  });
});
