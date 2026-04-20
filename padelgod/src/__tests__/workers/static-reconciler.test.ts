import { describe, it, expect } from 'vitest';
import { runStaticReconciler } from '../../workers/static-reconciler.js';

interface SnapshotSeed {
  tournament_id: string;
  category: 'men' | 'women';
  fip_id: string | null;
  name: string | null;
  country: string | null;
  captured_at: string;
}

interface PlayerSeed {
  id: string;
  fip_id: string;
  name: string | null;
  country: string | null;
  category: string | null;
}

function fakeSupabase(snapshots: SnapshotSeed[], players: PlayerSeed[]) {
  const inserted: any[] = [];
  const updated: Array<{ id: string; patch: Record<string, unknown> }> = [];

  // Implements the subset of the PostgREST chain used by runStaticReconciler.
  function playersTable() {
    return {
      // .select('...').in('fip_id', [...])
      select: (_cols: string) => ({
        in: (col: string, values: string[]) => {
          if (col !== 'fip_id') throw new Error(`unexpected filter column: ${col}`);
          const data = players.filter((p) => values.includes(p.fip_id));
          return Promise.resolve({ data, error: null });
        },
      }),
      // .update({...}).eq('id', <uuid>)
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, value: string) => {
          if (col !== 'id') throw new Error(`unexpected update filter column: ${col}`);
          updated.push({ id: value, patch });
          return Promise.resolve({ data: null, error: null });
        },
      }),
      // .insert({...})
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function snapshotsTable() {
    return {
      // .select('...').gte('captured_at', cutoff)
      select: (_cols: string) => ({
        gte: (_col: string, _value: string) => {
          return Promise.resolve({ data: snapshots, error: null });
        },
      }),
    };
  }

  return {
    inserted,
    updated,
    schema: (_name: string) => ({
      from: (t: string) => {
        if (t === 'entry_list_snapshots') return snapshotsTable();
        throw new Error(`unexpected padelgod-schema table: ${t}`);
      },
    }),
    from: (t: string) => {
      if (t === 'players') return playersTable();
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
    // Same fip_id appears twice in the latest snapshot (e.g. player is in both
    // men MD and some other context). We should only write once.
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
