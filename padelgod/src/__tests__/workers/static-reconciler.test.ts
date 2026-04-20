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

function fakeSupabase(
  snapshots: SnapshotSeed[],
  players: PlayerSeed[],
  draws: DrawSnapshotSeed[] = [],
  existingMatchEids: ExistingMatchExternalId[] = [],
  existingTournamentDraws: ExistingTournamentDraw[] = [],
) {
  const inserted: any[] = [];
  const updated: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const matchesInserted: any[] = [];
  const matchEidsInserted: any[] = [];
  const tournamentDrawsUpserted: any[] = [];
  const unresolvedUpserted: any[] = [];

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
          updated.push({ id: value, patch });
          return Promise.resolve({ data: null, error: null });
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
      // findOrCreateMatch does a select().tournament_id.category.round path for
      // the pair-based fallback. Simpler path for the draw phase: no pre-existing
      // matches, so select returns empty.
      select: (_cols: string) => ({
        eq: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
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
    get tournamentDrawState() {
      return tournamentDrawState;
    },
    schema: (_name: string) => ({
      from: (t: string) => {
        if (t === 'entry_list_snapshots') return snapshotsTable();
        if (t === 'draw_snapshots') return drawSnapshotsTable();
        if (t === 'unresolved_players') return unresolvedPlayersTable();
        throw new Error(`unexpected padelgod-schema table: ${t}`);
      },
    }),
    from: (t: string) => {
      if (t === 'players') return playersTable();
      if (t === 'matches') return matchesTable();
      if (t === 'entity_external_ids') return entityExternalIdsTable();
      if (t === 'tournament_draws') return tournamentDrawsTable();
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
