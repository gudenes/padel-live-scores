import { describe, it, expect } from 'vitest';
import { runStaticReconciler } from '../../workers/static-reconciler.js';

interface SnapshotSeed {
  tournament_id: string;
  category: 'men' | 'women';
  fip_id: string | null;
  name: string | null;
  country: string | null;
  captured_at: string;
  partner_fip_id?: string | null;
  partner_name?: string | null;
}

interface PlayerSeed {
  id: string;
  fip_id: string;
  name: string | null;
  country: string | null;
  category: string | null;
}

interface DrawSnapshotSeed {
  id: string;
  tournament_id: string;
  category: 'men' | 'women';
  draw_type: 'main_draw' | 'qualifying';
  round_label: string;
  draw_position: number | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  team1_seed: number | null;
  team2_seed: number | null;
  team1_country: string | null;
  team2_country: string | null;
  /** Real widget-visible match id ("MD017") from fip_event_page source —
   *  null for legacy Crionet draw-widget rows. Reconciler prefers the
   *  real id for composite construction when both tournament + match
   *  widget ids are present. */
  match_widget_id?: string | null;
  captured_at: string;
}

interface ExistingMatchExternalId {
  entity_id: string;
  external_id: string;
}

interface ExistingTournamentDraw {
  tournament_id: string;
  category: string;
  draw_position: number;
}

interface OopSnapshotSeed {
  id: string;
  tournament_id: string;
  category: 'men' | 'women';
  day_number: number;
  round_label: string | null;
  court: string;
  court_position: number | null;
  scheduled_label: string | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  match_widget_id: string | null;
  status: 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired';
  captured_at: string;
}

interface ResultsSnapshotSeed {
  id: string;
  tournament_id: string;
  category: 'men' | 'women';
  day_number: number;
  round_label: string | null;
  court: string | null;
  match_widget_id: string | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  set_scores: string;
  winner_team: 1 | 2;
  status: 'finished' | 'walkover' | 'retired';
  captured_at: string;
}

interface WidgetIdCacheSeed {
  tournament_id: string;
  widget_id: string;
  is_active: boolean;
}

/** Pre-seeded match with all 4 pair_player_id FKs — used to exercise the
 *  composite-first short-circuit in reconcileOOP + reconcileResults
 *  (findLinkedMatchWithCompleteFks). */
interface ExistingMatchSeed {
  id: string;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
}

function fakeSupabase(
  snapshots: SnapshotSeed[],
  players: PlayerSeed[],
  draws: DrawSnapshotSeed[] = [],
  existingMatchEids: ExistingMatchExternalId[] = [],
  existingTournamentDraws: ExistingTournamentDraw[] = [],
  oopSnapshots: OopSnapshotSeed[] = [],
  resultsSnapshots: ResultsSnapshotSeed[] = [],
  widgetIdCache: WidgetIdCacheSeed[] = [],
  existingMatches: ExistingMatchSeed[] = [],
) {
  const inserted: any[] = [];
  const updated: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const matchesInserted: any[] = [];
  const matchEidsInserted: any[] = [];
  const tournamentDrawsUpserted: any[] = [];
  const unresolvedUpserted: any[] = [];
  const matchesUpdated: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const setsUpserted: any[] = [];

  // Mutable state to simulate DB for concurrent/dedup scenarios
  const matchEidState: ExistingMatchExternalId[] = [...existingMatchEids];
  const tournamentDrawState: ExistingTournamentDraw[] = [...existingTournamentDraws];

  function playersTable() {
    return {
      select: (_cols: string) => ({
        in: (col: string, values: string[]) => {
          if (col !== 'fip_id') throw new Error(`unexpected filter column: ${col}`);
          const data = players.filter((p) => values.includes(p.fip_id));
          return Promise.resolve({ data, error: null });
        },
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, value: string) => {
          if (col !== 'id') throw new Error(`unexpected update filter column: ${col}`);
          // Chain may terminate here (.update().eq()) OR continue with
          // .in('status', [...]) — the status-regression guard added
          // 2026-04-23 to prevent reconciler from overwriting terminal
          // statuses. Both shapes resolve to the same write target; mock
          // records once and returns either the terminal or the
          // chainable proxy.
          const record = () => {
            updated.push({ id: value, patch });
            return { data: null, error: null };
          };
          const terminal = {
            in: (_col: string, _vals: unknown[]) => Promise.resolve(record()),
            then: (resolve: (v: { data: null; error: null }) => void) => resolve(record()),
          };
          return terminal;
        },
      }),
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function snapshotsTable() {
    return {
      select: (_cols: string) => {
        // Supports two call shapes from the reconciler:
        //   A. .select().gte('captured_at', cutoff)
        //   B. .select().eq('tournament_id',…).eq('category',…).gte('captured_at',cutoff)
        return {
          gte: (_col: string, _value: string) =>
            Promise.resolve({ data: snapshots, error: null }),
          eq: (col1: string, val1: string) => ({
            eq: (col2: string, val2: string) => ({
              gte: (_col: string, _value: string) => {
                const filtered = snapshots.filter(
                  (s) =>
                    (col1 !== 'tournament_id' || s.tournament_id === val1) &&
                    (col2 !== 'category' || s.category === val2),
                );
                return Promise.resolve({ data: filtered, error: null });
              },
            }),
          }),
        };
      },
    };
  }

  function drawSnapshotsTable() {
    return {
      select: (_cols: string) => ({
        gte: (_col: string, _value: string) =>
          Promise.resolve({ data: draws, error: null }),
      }),
    };
  }

  function unresolvedPlayersTable() {
    return {
      upsert: (row: Record<string, unknown>, _opts: any) => {
        unresolvedUpserted.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function matchesTable() {
    return {
      // Three shapes:
      //   A. findOrCreateMatch pair-based fallback:
      //      .select(cols).eq(a).eq(b).eq(c) → Promise<{data: []}>
      //   B. finished_at backfill read (reconcileResults):
      //      .select('started_at, duration, finished_at').eq('id', matchId).maybeSingle()
      //   C. findOrCreateMatch padelapi-twin lookup (PR 2):
      //      .select(cols).eq(a).eq(b).eq(c).ilike('court', x).not('padelapi_id','is',null)
      //      → Promise<{data: []}> (no twin → caller falls through to pair or INSERT)
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          // Shape A / C continues: another .eq() chain
          eq: (_c2: string, _v2: string) => ({
            eq: (_c3: string, _v3: string) => {
              // Third .eq() terminates shape A directly, and ALSO supports
              // shape C by exposing .ilike().not() — both resolve to no rows
              // so the reconciler's existing expectations (pair-based finds
              // nothing → INSERT new match) are preserved.
              const emptyResult = () =>
                Promise.resolve({ data: [], error: null });
              return {
                then: (resolve: any, reject?: any) =>
                  emptyResult().then(resolve, reject),
                ilike: (_c: string, _v: string) => ({
                  not: (_col: string, _op: string, _val: unknown) =>
                    emptyResult(),
                }),
              };
            },
          }),
          // Shape B terminates here: finished_at backfill row lookup.
          // Default: return a row with all null time fields so the backfill
          // writes finished_at using captured_at as fallback. Specific tests
          // can assert on the resulting `matchesUpdated` entry.
          //
          // Shape D ALSO terminates here: findLinkedMatchWithCompleteFks
          // selects ('id, pair1_player1_id, pair1_player2_id, pair2_player1_id,
          //          pair2_player2_id').eq('id', x).maybeSingle(). When the
          // eq column is 'id' and we have an existingMatches seed for it,
          // return its FKs. Otherwise fall back to the finished_at shape
          // for backward compat with the results-phase tests.
          maybeSingle: () => {
            if (_col === 'id') {
              const hit = existingMatches.find((m) => m.id === _val);
              if (hit) {
                return Promise.resolve({
                  data: {
                    id: hit.id,
                    pair1_player1_id: hit.pair1_player1_id,
                    pair1_player2_id: hit.pair1_player2_id,
                    pair2_player1_id: hit.pair2_player1_id,
                    pair2_player2_id: hit.pair2_player2_id,
                    // finished_at shape fields also — harmless extra keys.
                    started_at: null,
                    duration: null,
                    finished_at: null,
                  },
                  error: null,
                });
              }
            }
            return Promise.resolve({
              data: { started_at: null, duration: null, finished_at: null },
              error: null,
            });
          },
        }),
      }),
      insert: (row: Record<string, unknown>) => ({
        select: (_cols: string) => ({
          single: () => {
            const id = `match-uuid-${matchesInserted.length + 1}`;
            const full = { id, ...row };
            matchesInserted.push(full);
            return Promise.resolve({ data: full, error: null });
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, value: string) => {
          if (col !== 'id')
            throw new Error(`unexpected matches update filter: ${col}`);
          // Chain may terminate here (plain .update().eq()) OR continue with:
          //   - .is('finished_at', null)  — the finished_at backfill write
          //   - .in('status', [...])       — the regression guard added
          //                                  2026-04-23 to prevent status
          //                                  overwrites on terminal matches
          // Return a PromiseLike that records the write on all paths.
          const recordAndResolve = () => {
            matchesUpdated.push({ id: value, patch });
            return Promise.resolve({ data: null, error: null });
          };
          return {
            is: (_c: string, _v: unknown) => recordAndResolve(),
            in: (_c: string, _v: unknown[]) => recordAndResolve(),
            then: (resolve: (v: any) => void) => recordAndResolve().then(resolve),
          };
        },
      }),
    };
  }

  function setsTable() {
    return {
      upsert: (row: Record<string, unknown>, _opts: any) => {
        setsUpserted.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function oopSnapshotsTable() {
    return {
      select: (_cols: string) => ({
        gte: (_col: string, _val: string) =>
          Promise.resolve({ data: oopSnapshots, error: null }),
      }),
    };
  }

  function resultsSnapshotsTable() {
    return {
      select: (_cols: string) => ({
        gte: (_col: string, _val: string) =>
          Promise.resolve({ data: resultsSnapshots, error: null }),
      }),
    };
  }

  function widgetIdCacheTable() {
    return {
      select: (_cols: string) => ({
        eq: (col1: string, val1: string) => ({
          eq: (col2: string, val2: boolean | string) => ({
            maybeSingle: () => {
              const hit = widgetIdCache.find(
                (r) =>
                  (col1 !== 'tournament_id' || r.tournament_id === val1) &&
                  (col2 !== 'is_active' || r.is_active === val2),
              );
              return Promise.resolve({
                data: hit ? { widget_id: hit.widget_id } : null,
                error: null,
              });
            },
          }),
        }),
      }),
    };
  }

  function entityExternalIdsTable() {
    return {
      select: (_cols: string) => ({
        eq: (col1: string, val1: string) => ({
          eq: (col2: string, val2: string) => ({
            eq: (col3: string, val3: string) => ({
              maybeSingle: () => {
                // Widget-id lookup: entity_type, source, external_id
                const hit = matchEidState.find(
                  (r) =>
                    col3 === 'external_id' && r.external_id === val3,
                );
                return Promise.resolve({
                  data: hit ? { entity_id: hit.entity_id } : null,
                  error: null,
                });
              },
            }),
          }),
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      upsert: (row: any, _opts: any) => ({
        select: (_cols: string) => {
          // ignoreDuplicates: true → return [] on conflict, row otherwise
          const composite = row.external_id;
          const existing = matchEidState.find((r) => r.external_id === composite);
          if (existing) {
            // Conflict — ignoreDuplicates returns empty array
            return Promise.resolve({ data: [], error: null });
          }
          matchEidState.push({
            entity_id: row.entity_id,
            external_id: row.external_id,
          });
          matchEidsInserted.push(row);
          return Promise.resolve({ data: [row], error: null });
        },
      }),
    };
  }

  function tournamentDrawsTable() {
    return {
      upsert: (row: Record<string, unknown>, _opts: any) => {
        const tid = row.tournament_id as string;
        const cat = row.category as string;
        const pos = row.draw_position as number;
        const existing = tournamentDrawState.find(
          (r) =>
            r.tournament_id === tid && r.category === cat && r.draw_position === pos,
        );
        if (!existing) {
          tournamentDrawState.push({ tournament_id: tid, category: cat, draw_position: pos });
        }
        tournamentDrawsUpserted.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  return {
    inserted,
    updated,
    matchesInserted,
    matchEidsInserted,
    tournamentDrawsUpserted,
    unresolvedUpserted,
    matchesUpdated,
    setsUpserted,
    get tournamentDrawState() {
      return tournamentDrawState;
    },
    schema: (_name: string) => ({
      from: (t: string) => {
        if (t === 'entry_list_snapshots') return snapshotsTable();
        if (t === 'draw_snapshots') return drawSnapshotsTable();
        if (t === 'unresolved_players') return unresolvedPlayersTable();
        if (t === 'oop_snapshots') return oopSnapshotsTable();
        if (t === 'results_snapshots') return resultsSnapshotsTable();
        if (t === 'widget_id_cache') return widgetIdCacheTable();
        throw new Error(`unexpected padelgod-schema table: ${t}`);
      },
    }),
    from: (t: string) => {
      if (t === 'players') return playersTable();
      if (t === 'matches') return matchesTable();
      if (t === 'entity_external_ids') return entityExternalIdsTable();
      if (t === 'tournament_draws') return tournamentDrawsTable();
      if (t === 'sets') return setsTable();
      if (t === 'tournaments') {
        return {
          select: (_cols: string) => ({
            in: (_col: string, ids: string[]) => {
              const data = ids.map((id) => ({ id, starts_at: null }));
              return Promise.resolve({ data, error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected public-schema table: ${t}`);
    },
  };
}

const T = '2026-04-20T10:00:00.000Z';
const TOUR = 'tour-1';

describe('runStaticReconciler — entry list phase (V1)', () => {
  it('updates an existing player when name/country differ', async () => {
    const snapshots: SnapshotSeed[] = [
      {
        tournament_id: TOUR,
        category: 'men',
        fip_id: 'fip-P1',
        name: 'Arturo Coello',
        country: 'ESP',
        captured_at: T,
      },
    ];
    const players: PlayerSeed[] = [
      {
        id: 'player-uuid-1',
        fip_id: 'fip-P1',
        name: 'A. Coello', // stale name
        country: null, // stale country
        category: 'men',
      },
    ];

    const supabase = fakeSupabase(snapshots, players);
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.playersUpserted).toBe(1);
    expect(result.playersSkipped).toBe(0);
    expect(supabase.inserted).toHaveLength(0);
    expect(supabase.updated).toHaveLength(1);
    expect(supabase.updated[0].id).toBe('player-uuid-1');
    expect(supabase.updated[0].patch.name).toBe('Arturo Coello');
    expect(supabase.updated[0].patch.country).toBe('ESP');
    expect(supabase.updated[0].patch.last_updated_by).toBe('padelgod');
  });

  it('inserts a new player when fip_id is not in the players table', async () => {
    const snapshots: SnapshotSeed[] = [
      {
        tournament_id: TOUR,
        category: 'women',
        fip_id: 'fip-NEW',
        name: 'Bea Sanchez',
        country: 'ESP',
        captured_at: T,
      },
    ];
    const players: PlayerSeed[] = [];

    const supabase = fakeSupabase(snapshots, players);
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.playersUpserted).toBe(1);
    expect(result.playersSkipped).toBe(0);
    expect(supabase.updated).toHaveLength(0);
    expect(supabase.inserted).toHaveLength(1);
    const row = supabase.inserted[0];
    expect(row.fip_id).toBe('fip-NEW');
    expect(row.name).toBe('Bea Sanchez');
    expect(row.country).toBe('ESP');
    expect(row.category).toBe('women');
    expect(row.source).toBe('fip');
    expect(row.last_updated_by).toBe('padelgod');
  });

  it('skips rows with a null fip_id', async () => {
    const snapshots: SnapshotSeed[] = [
      {
        tournament_id: TOUR,
        category: 'men',
        fip_id: null,
        name: 'Unknown Player',
        country: 'ESP',
        captured_at: T,
      },
    ];
    const players: PlayerSeed[] = [];

    const supabase = fakeSupabase(snapshots, players);
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.playersUpserted).toBe(0);
    expect(result.playersSkipped).toBe(1);
    expect(supabase.inserted).toHaveLength(0);
    expect(supabase.updated).toHaveLength(0);
  });

  it('deduplicates rows with the same fip_id within the latest snapshot', async () => {
    const snapshots: SnapshotSeed[] = [
      {
        tournament_id: TOUR,
        category: 'men',
        fip_id: 'fip-DUP',
        name: 'Duplicate Player',
        country: 'ESP',
        captured_at: T,
      },
      {
        tournament_id: TOUR,
        category: 'men',
        fip_id: 'fip-DUP',
        name: 'Duplicate Player',
        country: 'ESP',
        captured_at: T,
      },
    ];
    const players: PlayerSeed[] = [];

    const supabase = fakeSupabase(snapshots, players);
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.playersUpserted).toBe(1);
    expect(supabase.inserted).toHaveLength(1);
    expect(supabase.updated).toHaveLength(0);
  });
});

describe('runStaticReconciler — draw phase (V2)', () => {
  const TEAM1_P1 = 'Juan Lebron';
  const TEAM1_P2 = 'Federico Chingotto';
  const TEAM2_P1 = 'Ale Galan';
  const TEAM2_P2 = 'Arturo Coello';

  const entryListRoster: SnapshotSeed[] = [
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P1',
      name: TEAM1_P1,
      country: 'ESP',
      partner_fip_id: 'fip-P2',
      partner_name: TEAM1_P2,
      captured_at: T,
    },
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P2',
      name: TEAM1_P2,
      country: 'ARG',
      partner_fip_id: 'fip-P1',
      partner_name: TEAM1_P1,
      captured_at: T,
    },
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P3',
      name: TEAM2_P1,
      country: 'ESP',
      partner_fip_id: 'fip-P4',
      partner_name: TEAM2_P2,
      captured_at: T,
    },
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P4',
      name: TEAM2_P2,
      country: 'ESP',
      partner_fip_id: 'fip-P3',
      partner_name: TEAM2_P1,
      captured_at: T,
    },
  ];

  const rosterPlayers: PlayerSeed[] = [
    { id: 'uuid-P1', fip_id: 'fip-P1', name: TEAM1_P1, country: 'ESP', category: 'men' },
    { id: 'uuid-P2', fip_id: 'fip-P2', name: TEAM1_P2, country: 'ARG', category: 'men' },
    { id: 'uuid-P3', fip_id: 'fip-P3', name: TEAM2_P1, country: 'ESP', category: 'men' },
    { id: 'uuid-P4', fip_id: 'fip-P4', name: TEAM2_P2, country: 'ESP', category: 'men' },
  ];

  it('fully resolves a draw row: creates one match + two tournament_draws rows', async () => {
    const draws: DrawSnapshotSeed[] = [
      {
        id: 'draw-1',
        tournament_id: TOUR,
        category: 'men',
        draw_type: 'main_draw',
        round_label: 'F',
        draw_position: 1,
        team1_player1_name: 'J. Lebron',
        team1_player2_name: 'F. Chingotto',
        team2_player1_name: 'A. Galan',
        team2_player2_name: 'A. Coello',
        team1_seed: 1,
        team2_seed: 2,
        team1_country: 'ESP',
        team2_country: 'ESP',
        captured_at: T,
      },
    ];

    const supabase = fakeSupabase(entryListRoster, rosterPlayers, draws);
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.drawMatchesWritten).toBe(1);
    expect(result.drawTeamsWritten).toBe(2);
    expect(result.drawsUnresolved).toBe(0);
    expect(supabase.unresolvedUpserted).toHaveLength(0);

    // One match created
    expect(supabase.matchesInserted).toHaveLength(1);
    // Two tournament_draws rows
    expect(supabase.tournamentDrawsUpserted).toHaveLength(2);

    // Team 1 at position 2N-1 = 1
    const team1Row = supabase.tournamentDrawsUpserted.find((r: any) => r.draw_position === 1);
    expect(team1Row).toBeDefined();
    expect(team1Row.player1_id).toBe('uuid-P1');
    expect(team1Row.player2_id).toBe('uuid-P2');
    expect(team1Row.seed).toBe(1);

    // Team 2 at position 2N = 2
    const team2Row = supabase.tournamentDrawsUpserted.find((r: any) => r.draw_position === 2);
    expect(team2Row).toBeDefined();
    expect(team2Row.player1_id).toBe('uuid-P3');
    expect(team2Row.player2_id).toBe('uuid-P4');
    expect(team2Row.seed).toBe(2);
  });

  /**
   * Regression for the 2026-04-24 Isla de la Palma linkage gap: when the
   * draw_snapshot row has a real `match_widget_id` ("MD017") AND the
   * tournament has an active widget_id_cache row ("FIP-2026-1706"), the
   * reconciler must write the match with the REAL composite so that
   * downstream reconcileOOP / reconcileResults can find and update it.
   *
   * Before the fix, the reconciler always used the synthetic
   * "draw:men:main_draw:R32:1" form — which never matched Crionet's OOP
   * snapshots (they emit "MD017"). Result: 36/36 OOP+results rows
   * unlinked to public.matches despite all data being captured.
   */
  it('uses real widget_id composite when match_widget_id + tournament widget_id_cache are both present', async () => {
    const draws: DrawSnapshotSeed[] = [
      {
        id: 'draw-real',
        tournament_id: TOUR,
        category: 'men',
        draw_type: 'main_draw',
        round_label: 'F',
        draw_position: 1,
        team1_player1_name: 'J. Lebron',
        team1_player2_name: 'F. Chingotto',
        team2_player1_name: 'A. Galan',
        team2_player2_name: 'A. Coello',
        team1_seed: 1,
        team2_seed: 2,
        team1_country: 'ESP',
        team2_country: 'ESP',
        match_widget_id: 'MD031', // from fip_event_page source
        captured_at: T,
      },
    ];

    const supabase = fakeSupabase(
      entryListRoster,
      rosterPlayers,
      draws,
      [],
      [],
      [],
      [],
      [{ tournament_id: TOUR, widget_id: 'FIP-2026-1706', is_active: true }],
    );
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.drawMatchesWritten).toBe(1);
    expect(supabase.matchEidsInserted).toHaveLength(1);

    // Composite must be "FIP-2026-1706:MD031" — NOT the synthetic form.
    expect(supabase.matchEidsInserted[0].external_id).toBe('FIP-2026-1706:MD031');
    expect(supabase.matchEidsInserted[0].source).toBe('crionet_widget');
  });

  /**
   * Negative case: when either the draw row or the tournament widget code
   * is missing, fall back to the synthetic composite (legacy Crionet draw
   * widget path). Keeps pre-fix tournaments working without regression.
   */
  it('falls back to synthetic widget_id when match_widget_id is missing', async () => {
    const draws: DrawSnapshotSeed[] = [
      {
        id: 'draw-legacy',
        tournament_id: TOUR,
        category: 'men',
        draw_type: 'main_draw',
        round_label: 'F',
        draw_position: 1,
        team1_player1_name: 'J. Lebron',
        team1_player2_name: 'F. Chingotto',
        team2_player1_name: 'A. Galan',
        team2_player2_name: 'A. Coello',
        team1_seed: 1,
        team2_seed: 2,
        team1_country: 'ESP',
        team2_country: 'ESP',
        match_widget_id: null, // legacy crionet_draw_widget row
        captured_at: T,
      },
    ];

    // Tournament has no widget_id_cache row either — true legacy path.
    const supabase = fakeSupabase(entryListRoster, rosterPlayers, draws);
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.drawMatchesWritten).toBe(1);
    expect(supabase.matchEidsInserted[0].external_id).toBe(
      'draw:men:main_draw:F:1',
    );
  });

  it('queues unresolved raw names and skips the draw row entirely when any name fails to resolve', async () => {
    const draws: DrawSnapshotSeed[] = [
      {
        id: 'draw-1',
        tournament_id: TOUR,
        category: 'men',
        draw_type: 'main_draw',
        round_label: 'QF',
        draw_position: 3,
        team1_player1_name: 'J. Lebron',
        team1_player2_name: 'F. Chingotto',
        team2_player1_name: 'M. Nonexistent', // not in roster
        team2_player2_name: 'A. Coello',
        team1_seed: null,
        team2_seed: null,
        team1_country: 'ESP',
        team2_country: 'ESP',
        captured_at: T,
      },
    ];

    const supabase = fakeSupabase(entryListRoster, rosterPlayers, draws);
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.drawMatchesWritten).toBe(0);
    expect(result.drawTeamsWritten).toBe(0);
    expect(result.drawsUnresolved).toBe(1);

    // No match created, no tournament_draws written
    expect(supabase.matchesInserted).toHaveLength(0);
    expect(supabase.tournamentDrawsUpserted).toHaveLength(0);

    // One unresolved name queued
    expect(supabase.unresolvedUpserted).toHaveLength(1);
    expect(supabase.unresolvedUpserted[0].widget_short_name).toBe('M. Nonexistent');
    expect(supabase.unresolvedUpserted[0].tournament_id).toBe(TOUR);
    expect(supabase.unresolvedUpserted[0].status).toBe('pending');
  });

  it('dedupes tournament_draws writes across re-runs via onConflict (tournament_id, category, draw_position)', async () => {
    const draws: DrawSnapshotSeed[] = [
      {
        id: 'draw-1',
        tournament_id: TOUR,
        category: 'men',
        draw_type: 'main_draw',
        round_label: 'F',
        draw_position: 1,
        team1_player1_name: 'J. Lebron',
        team1_player2_name: 'F. Chingotto',
        team2_player1_name: 'A. Galan',
        team2_player2_name: 'A. Coello',
        team1_seed: 1,
        team2_seed: 2,
        team1_country: 'ESP',
        team2_country: 'ESP',
        captured_at: T,
      },
    ];

    // First run
    const supabase1 = fakeSupabase(entryListRoster, rosterPlayers, draws);
    await runStaticReconciler({ supabase: supabase1 as any });

    // Second run against the DB state from the first
    const existingTD = supabase1.tournamentDrawState;
    const existingEids = supabase1.matchEidsInserted.map((r) => ({
      entity_id: r.entity_id,
      external_id: r.external_id,
    }));

    const supabase2 = fakeSupabase(
      entryListRoster,
      rosterPlayers,
      draws,
      existingEids,
      existingTD,
    );
    await runStaticReconciler({ supabase: supabase2 as any });

    // After two runs, the DB state should still only have 2 tournament_draws rows
    // (one per team) thanks to the onConflict dedup.
    expect(supabase2.tournamentDrawState).toHaveLength(2);
    // And no duplicate match entity_external_ids mappings
    expect(supabase2.matchEidsInserted).toHaveLength(0); // second run hit conflict, no new mapping
  });
});

describe('runStaticReconciler — OOP phase (V3)', () => {
  const TEAM1_P1 = 'Juan Lebron';
  const TEAM1_P2 = 'Federico Chingotto';
  const TEAM2_P1 = 'Ale Galan';
  const TEAM2_P2 = 'Arturo Coello';

  const entryListRoster: SnapshotSeed[] = [
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P1',
      name: TEAM1_P1,
      country: 'ESP',
      partner_fip_id: 'fip-P2',
      partner_name: TEAM1_P2,
      captured_at: T,
    },
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P2',
      name: TEAM1_P2,
      country: 'ARG',
      partner_fip_id: 'fip-P1',
      partner_name: TEAM1_P1,
      captured_at: T,
    },
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P3',
      name: TEAM2_P1,
      country: 'ESP',
      partner_fip_id: 'fip-P4',
      partner_name: TEAM2_P2,
      captured_at: T,
    },
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P4',
      name: TEAM2_P2,
      country: 'ESP',
      partner_fip_id: 'fip-P3',
      partner_name: TEAM2_P1,
      captured_at: T,
    },
  ];

  const rosterPlayers: PlayerSeed[] = [
    { id: 'uuid-P1', fip_id: 'fip-P1', name: TEAM1_P1, country: 'ESP', category: 'men' },
    { id: 'uuid-P2', fip_id: 'fip-P2', name: TEAM1_P2, country: 'ARG', category: 'men' },
    { id: 'uuid-P3', fip_id: 'fip-P3', name: TEAM2_P1, country: 'ESP', category: 'men' },
    { id: 'uuid-P4', fip_id: 'fip-P4', name: TEAM2_P2, country: 'ESP', category: 'men' },
  ];

  it('resolves an OOP row and UPDATEs the match with court + round (findOrCreateMatch uses real widget id)', async () => {
    const oop: OopSnapshotSeed[] = [
      {
        id: 'oop-1',
        tournament_id: TOUR,
        category: 'men',
        day_number: 4,
        round_label: 'F',
        court: 'Center Court',
        court_position: 0,
        scheduled_label: 'Starting at 4:00 PM',
        team1_player1_name: 'J. Lebron',
        team1_player2_name: 'F. Chingotto',
        team2_player1_name: 'A. Galan',
        team2_player2_name: 'A. Coello',
        match_widget_id: 'M012',
        status: 'scheduled',
        captured_at: T,
      },
    ];

    const widgets: WidgetIdCacheSeed[] = [
      { tournament_id: TOUR, widget_id: 'FIP-2026-1701', is_active: true },
    ];

    const supabase = fakeSupabase(
      entryListRoster,
      rosterPlayers,
      [],
      [],
      [],
      oop,
      [],
      widgets,
    );
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.oopMatchesUpdated).toBe(1);
    expect(result.oopUnresolved).toBe(0);

    // findOrCreateMatch was called with the REAL tournament widget id (via
    // entity_external_ids upsert using composite 'FIP-2026-1701:M012').
    expect(supabase.matchEidsInserted).toHaveLength(1);
    expect(supabase.matchEidsInserted[0].external_id).toBe('FIP-2026-1701:M012');

    // Exactly one match INSERT (new match row — no pair-based candidate existed)
    expect(supabase.matchesInserted).toHaveLength(1);

    // And exactly one matches UPDATE with court + round (scheduled_at NOT written in V1).
    expect(supabase.matchesUpdated).toHaveLength(1);
    const upd = supabase.matchesUpdated[0];
    expect(upd.patch.court).toBe('Center Court');
    expect(upd.patch.round).toBe('F');
    expect(upd.patch.last_updated_by).toBe('padelgod');
    expect(upd.patch.scheduled_at).toBeUndefined();
  });

  it('copies court + court_position (→ court_order) from the snapshot onto public.matches', async () => {
    const oop: OopSnapshotSeed[] = [
      {
        id: 'oop-cbc-0',
        tournament_id: TOUR,
        category: 'men',
        day_number: 4,
        round_label: 'R32',
        court: 'COURT CBC',
        court_position: 0,
        scheduled_label: 'Starting at 11:00 AM',
        team1_player1_name: 'J. Lebron',
        team1_player2_name: 'F. Chingotto',
        team2_player1_name: 'A. Galan',
        team2_player2_name: 'A. Coello',
        match_widget_id: 'MQ007',
        status: 'scheduled',
        captured_at: T,
      },
    ];

    const widgets: WidgetIdCacheSeed[] = [
      { tournament_id: TOUR, widget_id: 'FIP-2026-1701', is_active: true },
    ];

    const supabase = fakeSupabase(
      entryListRoster,
      rosterPlayers,
      [],
      [],
      [],
      oop,
      [],
      widgets,
    );
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.oopMatchesUpdated).toBe(1);

    // One matches-update should carry both court + court_order (court_order is
    // 1-based; court_position is 0-based → + 1).
    const write = supabase.matchesUpdated.find(
      (u: { patch: Record<string, unknown> }) => 'court' in u.patch,
    )!;
    expect(write.patch.court).toBe('COURT CBC');
    expect(write.patch.court_order).toBe(1);
  });

  /**
   * Regression for 2026-04-24 FIP BRONZE Isla de la Palma: reconcileDraws
   * had already created public.matches rows keyed by the real widget
   * composite (`FIP-2026-1706:MD017`) with all 4 player FKs populated. But
   * reconcileOOP was SKIPPING those matches because short-form OOP names
   * like "N. Baptista" didn't resolve cleanly against the entry-list
   * dictionary (duplicate "Nuno Baptista" in public.players caused
   * ambiguity). Result: 5 linked Isla matches but 0 with court/round
   * populated from OOP.
   *
   * Fix: reconcileOOP now tries findLinkedMatchWithCompleteFks FIRST —
   * when the composite lookup succeeds AND the matched row has all 4 FKs
   * populated, name resolution is bypassed entirely.
   */
  it('short-circuits name resolution when composite + complete FKs already exist', async () => {
    const oop: OopSnapshotSeed[] = [
      {
        id: 'oop-shortcircuit',
        tournament_id: TOUR,
        category: 'men',
        day_number: 4,
        round_label: 'F',
        court: 'COURT CBC',
        court_position: 2,
        scheduled_label: 'Not before 6:00 PM',
        // Deliberately UNRESOLVABLE short-form names — entry list has no
        // fip_id for these. Before the fix, this row would land in
        // oopUnresolved and the match would never get court/round set.
        team1_player1_name: 'X. Totally Unknown',
        team1_player2_name: 'Y. AlsoUnknown',
        team2_player1_name: 'Z. NotInDict',
        team2_player2_name: 'W. AlsoNotHere',
        match_widget_id: 'M099',
        status: 'scheduled',
        captured_at: T,
      },
    ];

    const widgets: WidgetIdCacheSeed[] = [
      { tournament_id: TOUR, widget_id: 'FIP-2026-1701', is_active: true },
    ];

    // Pre-existing linkage FIP-2026-1701:M099 → match-existing (e.g.
    // written by reconcileDraws on an earlier tick).
    const existingEids: ExistingMatchExternalId[] = [
      { entity_id: 'match-existing', external_id: 'FIP-2026-1701:M099' },
    ];

    // Pre-existing match row with all 4 FKs populated.
    const existingMatch: ExistingMatchSeed = {
      id: 'match-existing',
      pair1_player1_id: 'uuid-A',
      pair1_player2_id: 'uuid-B',
      pair2_player1_id: 'uuid-C',
      pair2_player2_id: 'uuid-D',
    };

    const supabase = fakeSupabase(
      [],              // no entry list snapshots
      [],              // no roster players
      [],              // no draws
      existingEids,
      [],
      oop,
      [],
      widgets,
      [existingMatch], // NEW: pre-seeded match with complete FKs
    );
    const result = await runStaticReconciler({ supabase: supabase as any });

    // Short-circuit SHOULD fire → oopMatchesUpdated=1, not unresolved.
    expect(result.oopMatchesUpdated).toBe(1);
    expect(result.oopUnresolved).toBe(0);

    // The UPDATE targets the existing match-existing id.
    expect(supabase.matchesUpdated).toHaveLength(1);
    expect(supabase.matchesUpdated[0].id).toBe('match-existing');
    const patch = supabase.matchesUpdated[0].patch;
    expect(patch.court).toBe('COURT CBC');
    expect(patch.round).toBe('F');
    expect(patch.court_order).toBe(3); // court_position=2, stored 1-based

    // No new match was created (we reused the pre-existing one).
    expect(supabase.matchesInserted).toHaveLength(0);
  });

  it('does NOT write court_order when court_position is null (historical / pre-migration rows)', async () => {
    // Mirrors the shape of the previous test but with court_position = null.
    // The reconciler's null-guard should skip the court_order write so we
    // don't clobber a value padelapi may have set earlier.
    const oop: OopSnapshotSeed[] = [
      {
        id: 'oop-null-pos',
        tournament_id: TOUR,
        category: 'men',
        day_number: 4,
        round_label: 'R32',
        court: 'COURT CBC',
        court_position: null,
        scheduled_label: 'Starting at 11:00 AM',
        team1_player1_name: 'J. Lebron',
        team1_player2_name: 'F. Chingotto',
        team2_player1_name: 'A. Galan',
        team2_player2_name: 'A. Coello',
        match_widget_id: 'MQ007',
        status: 'scheduled',
        captured_at: T,
      },
    ];

    const widgets: WidgetIdCacheSeed[] = [
      { tournament_id: TOUR, widget_id: 'FIP-2026-1701', is_active: true },
    ];

    const supabase = fakeSupabase(
      entryListRoster,
      rosterPlayers,
      [],
      [],
      [],
      oop,
      [],
      widgets,
    );
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.oopMatchesUpdated).toBe(1);

    const write = supabase.matchesUpdated.find(
      (u: { patch: Record<string, unknown> }) => 'court' in u.patch,
    )!;
    expect(write.patch.court).toBe('COURT CBC');
    expect(write.patch.court_order).toBeUndefined();
  });
});

describe('runStaticReconciler — results phase (V4)', () => {
  const TEAM1_P1 = 'Juan Lebron';
  const TEAM1_P2 = 'Federico Chingotto';
  const TEAM2_P1 = 'Ale Galan';
  const TEAM2_P2 = 'Arturo Coello';

  const entryListRoster: SnapshotSeed[] = [
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P1',
      name: TEAM1_P1,
      country: 'ESP',
      partner_fip_id: 'fip-P2',
      partner_name: TEAM1_P2,
      captured_at: T,
    },
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P2',
      name: TEAM1_P2,
      country: 'ARG',
      partner_fip_id: 'fip-P1',
      partner_name: TEAM1_P1,
      captured_at: T,
    },
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P3',
      name: TEAM2_P1,
      country: 'ESP',
      partner_fip_id: 'fip-P4',
      partner_name: TEAM2_P2,
      captured_at: T,
    },
    {
      tournament_id: TOUR,
      category: 'men',
      fip_id: 'fip-P4',
      name: TEAM2_P2,
      country: 'ESP',
      partner_fip_id: 'fip-P3',
      partner_name: TEAM2_P1,
      captured_at: T,
    },
  ];

  const rosterPlayers: PlayerSeed[] = [
    { id: 'uuid-P1', fip_id: 'fip-P1', name: TEAM1_P1, country: 'ESP', category: 'men' },
    { id: 'uuid-P2', fip_id: 'fip-P2', name: TEAM1_P2, country: 'ARG', category: 'men' },
    { id: 'uuid-P3', fip_id: 'fip-P3', name: TEAM2_P1, country: 'ESP', category: 'men' },
    { id: 'uuid-P4', fip_id: 'fip-P4', name: TEAM2_P2, country: 'ESP', category: 'men' },
  ];

  const widgets: WidgetIdCacheSeed[] = [
    { tournament_id: TOUR, widget_id: 'FIP-2026-1701', is_active: true },
  ];

  it('upserts one set per parsed set_score token with correct games, status=finished and winner_pair', async () => {
    const results: ResultsSnapshotSeed[] = [
      {
        id: 'res-1',
        tournament_id: TOUR,
        category: 'men',
        day_number: 4,
        round_label: 'F',
        court: 'Center Court',
        match_widget_id: 'M012',
        team1_player1_name: 'J. Lebron',
        team1_player2_name: 'F. Chingotto',
        team2_player1_name: 'A. Galan',
        team2_player2_name: 'A. Coello',
        set_scores: '6-4 4-6 6-2',
        winner_team: 1,
        status: 'finished',
        captured_at: T,
      },
    ];

    const supabase = fakeSupabase(
      entryListRoster,
      rosterPlayers,
      [],
      [],
      [],
      [],
      results,
      widgets,
    );
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.resultsMatchesUpdated).toBe(1);
    expect(result.setsWritten).toBe(3);
    expect(result.resultsUnresolved).toBe(0);

    // Match INSERT + two UPDATEs:
    //  1. status/winner_pair patch (the main results-phase write)
    //  2. finished_at backfill (guarded with .is('finished_at', null))
    expect(supabase.matchesInserted).toHaveLength(1);
    expect(supabase.matchesUpdated).toHaveLength(2);
    const mu = supabase.matchesUpdated.find(
      (u: { patch: Record<string, unknown> }) => 'status' in u.patch,
    )!;
    expect(mu.patch.status).toBe('finished');
    expect(mu.patch.winner_pair).toBe(1);

    const finishedBackfill = supabase.matchesUpdated.find(
      (u: { patch: Record<string, unknown> }) => 'finished_at' in u.patch,
    )!;
    // No live-poller data on this match → fallback to captured_at (T).
    expect(finishedBackfill.patch.finished_at).toBe(T);

    // Three sets upserted
    expect(supabase.setsUpserted).toHaveLength(3);
    expect(supabase.setsUpserted[0]).toMatchObject({
      set_number: 1,
      pair1_games: 6,
      pair2_games: 4,
      set_score: '6-4',
      score_source: 'api',
      is_current: false,
    });
    expect(supabase.setsUpserted[1]).toMatchObject({
      set_number: 2,
      pair1_games: 4,
      pair2_games: 6,
      set_score: '4-6',
    });
    expect(supabase.setsUpserted[2]).toMatchObject({
      set_number: 3,
      pair1_games: 6,
      pair2_games: 2,
      set_score: '6-2',
    });
  });

  it('parses tiebreak notation: "7-6(3)" sets pair1=7, pair2=6, set_score="7-6" (tiebreak digit not on sets table)', async () => {
    // Also exercises the reverse-side notation "6(5)-7" in set 2: loser (pair1)
    // took 5 points in the tiebreak but the stored set_score is still "6-7".
    const results: ResultsSnapshotSeed[] = [
      {
        id: 'res-tb',
        tournament_id: TOUR,
        category: 'men',
        day_number: 4,
        round_label: 'SF',
        court: 'Court 1',
        match_widget_id: 'M007',
        team1_player1_name: 'J. Lebron',
        team1_player2_name: 'F. Chingotto',
        team2_player1_name: 'A. Galan',
        team2_player2_name: 'A. Coello',
        set_scores: '7-6(3) 6(5)-7 6-2',
        winner_team: 1,
        status: 'finished',
        captured_at: T,
      },
    ];

    const supabase = fakeSupabase(
      entryListRoster,
      rosterPlayers,
      [],
      [],
      [],
      [],
      results,
      widgets,
    );
    const result = await runStaticReconciler({ supabase: supabase as any });

    expect(result.setsWritten).toBe(3);
    expect(supabase.setsUpserted[0]).toMatchObject({
      set_number: 1,
      pair1_games: 7,
      pair2_games: 6,
      set_score: '7-6',
    });
    expect(supabase.setsUpserted[1]).toMatchObject({
      set_number: 2,
      pair1_games: 6,
      pair2_games: 7,
      set_score: '6-7',
    });

    // Schema note: `sets` has no tiebreak column. Per-game tiebreak detail is
    // Task 12's job (games table). Set-level rows carry the clean "7-6"
    // score only — verified by the matchers above (no tiebreak key present).
    expect(supabase.setsUpserted[0]).not.toHaveProperty('tiebreak_loser_points');
  });
});
