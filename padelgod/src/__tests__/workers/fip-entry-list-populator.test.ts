import { describe, it, expect, vi } from 'vitest';
import { runFipEntryListPopulator } from '../../workers/fip-entry-list-populator.js';

// ── Test fixtures ────────────────────────────────────────────────────────
//
// The fake supabase below is deliberately small — it speaks only the two
// queries the worker actually issues:
//   1. supabase.schema('padelgod').from('entry_list_snapshots').select(...).gte(...)
//   2. supabase.from('players').select(...).in('fip_id', [...])
//   3. supabase.from('players').insert(...) | .update(...).eq('id', ...)
//
// Anything else throws so an accidental query shape change shows up
// immediately as a test failure rather than as a silent miss.

interface SnapshotSeed {
  tournament_id: string;
  category: 'men' | 'women';
  fip_id: string | null;
  name: string | null;
  country: string | null;
  captured_at: string;
}

interface ExistingPlayerSeed {
  id: string;
  fip_id: string;
  name: string | null;
  country: string | null;
  category: string | null;
}

interface Options {
  snapshots?: SnapshotSeed[];
  existingPlayers?: ExistingPlayerSeed[];
}

function fakeSupabase(opts: Options) {
  const snapshots = opts.snapshots ?? [];
  const existing: ExistingPlayerSeed[] = [...(opts.existingPlayers ?? [])];

  const inserted: Record<string, unknown>[] = [];
  const updated: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const entryListSnapshotsTable = () => ({
    select: (_cols: string) => ({
      gte: (col: string, val: string) => {
        if (col !== 'captured_at') {
          throw new Error(`unexpected entry_list_snapshots filter: ${col}`);
        }
        const data = snapshots.filter((s) => s.captured_at >= val);
        return Promise.resolve({ data, error: null });
      },
    }),
  });

  const playersTable = () => ({
    select: (_cols: string) => ({
      in: (col: string, values: string[]) => {
        if (col !== 'fip_id') {
          throw new Error(`unexpected players filter: ${col}`);
        }
        const data = existing.filter(
          (p) => p.fip_id != null && values.includes(p.fip_id),
        );
        return Promise.resolve({ data, error: null });
      },
    }),
    insert: (row: Record<string, unknown>) => {
      const id = `new-player-${inserted.length + 1}`;
      inserted.push({ id, ...row });
      // Reflect into existing so subsequent UPDATE lookups see it
      existing.push({
        id,
        fip_id: String(row.fip_id),
        name: (row.name as string) ?? null,
        country: (row.country as string) ?? null,
        category: (row.category as string) ?? null,
      });
      // The worker chains `.select('id').single()` to capture the new
      // players.id (used by the player_entered notify path). Mirror that
      // shape; the bare insert is no longer called.
      return {
        select: (_cols: string) => ({
          single: () => Promise.resolve({ data: { id }, error: null }),
        }),
      };
    },
    update: (patch: Record<string, unknown>) => ({
      eq: (col: string, val: string) => {
        if (col !== 'id') {
          throw new Error(`unexpected players UPDATE filter: ${col}`);
        }
        updated.push({ id: val, patch });
        const target = existing.find((p) => p.id === val);
        if (target) Object.assign(target, patch);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  });

  return {
    inserted,
    updated,
    schema: (name: string) => ({
      from: (t: string) => {
        if (name !== 'padelgod') {
          throw new Error(`unexpected schema: ${name}`);
        }
        if (t === 'entry_list_snapshots') return entryListSnapshotsTable();
        throw new Error(`unexpected padelgod table: ${t}`);
      },
    }),
    from: (t: string) => {
      if (t === 'players') return playersTable();
      throw new Error(`unexpected public table: ${t}`);
    },
  };
}

// ── Helpers for building snapshot rows ────────────────────────────────────

const NOW = new Date().toISOString();
const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const DAY_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const TOURNAMENT_ID = 't-isla';

function snap(
  fipId: string | null,
  name: string | null,
  country: string | null = 'ES',
  category: 'men' | 'women' = 'men',
  capturedAt: string = NOW,
): SnapshotSeed {
  return {
    tournament_id: TOURNAMENT_ID,
    category,
    fip_id: fipId,
    name,
    country,
    captured_at: capturedAt,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('runFipEntryListPopulator', () => {
  it('inserts new players when no existing row matches by fip_id', async () => {
    const supabase = fakeSupabase({
      snapshots: [
        snap('P200001', 'Juan Lebron'),
        snap('P200002', 'Ale Galan'),
      ],
      existingPlayers: [],
    });

    const result = await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.playersInserted).toBe(2);
    expect(result.playersUpdated).toBe(0);
    expect(result.playersSkippedNoFipId).toBe(0);
    expect(result.snapshotRowsConsidered).toBe(2);
    expect(result.tournamentsProcessed).toBe(1);
    expect(supabase.inserted).toHaveLength(2);
    expect(supabase.inserted[0]).toMatchObject({
      fip_id: 'P200001',
      external_id: 'P200001',
      name: 'Juan Lebron',
      country: 'ES',
      category: 'men',
      last_updated_by: 'padelgod',
    });
    // Critical: must NOT include `source` — players table doesn't have it
    expect(supabase.inserted[0]).not.toHaveProperty('source');
  });

  it('updates only fields that changed (NULL-only update)', async () => {
    const supabase = fakeSupabase({
      snapshots: [
        snap('P200001', 'Juan Lebron Bermejo', 'ES', 'men'),
      ],
      existingPlayers: [
        // Existing row has different name + country
        {
          id: 'existing-1',
          fip_id: 'P200001',
          name: 'Juan Lebron',  // older version
          country: 'AR',         // wrong country
          category: 'men',
        },
      ],
    });

    const result = await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.playersUpdated).toBe(1);
    expect(result.playersInserted).toBe(0);
    expect(supabase.updated).toHaveLength(1);
    expect(supabase.updated[0].id).toBe('existing-1');
    // Both name and country differ → both in patch
    expect(supabase.updated[0].patch).toMatchObject({
      name: 'Juan Lebron Bermejo',
      country: 'ES',
      last_updated_by: 'padelgod',
    });
    // Category didn't change → NOT in patch
    expect(supabase.updated[0].patch).not.toHaveProperty('category');
  });

  it('skips existing rows when nothing changed (idempotency)', async () => {
    const supabase = fakeSupabase({
      snapshots: [
        snap('P200001', 'Juan Lebron', 'ES', 'men'),
      ],
      existingPlayers: [
        {
          id: 'existing-1',
          fip_id: 'P200001',
          name: 'Juan Lebron',
          country: 'ES',
          category: 'men',
        },
      ],
    });

    const result = await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.playersUpdated).toBe(0);
    expect(result.playersInserted).toBe(0);
    expect(result.playersSkippedNoChange).toBe(1);
    expect(supabase.updated).toHaveLength(0);
    expect(supabase.inserted).toHaveLength(0);
  });

  it('never overwrites an existing populated value with null from the snapshot', async () => {
    // Lesson: NULL-only update means we ONLY update when the snapshot
    // has a non-null value. A snapshot with country=null must never
    // clobber an existing populated country.
    const supabase = fakeSupabase({
      snapshots: [
        snap('P200001', 'Juan Lebron', null, 'men'),  // country=null in snapshot
      ],
      existingPlayers: [
        {
          id: 'existing-1',
          fip_id: 'P200001',
          name: 'Juan Lebron',
          country: 'ES',  // existing populated — must be preserved
          category: 'men',
        },
      ],
    });

    const result = await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    // Nothing differs (snapshot null doesn't count as a diff), idempotent
    expect(result.playersUpdated).toBe(0);
    expect(result.playersSkippedNoChange).toBe(1);
    expect(supabase.updated).toHaveLength(0);
  });

  it('skips snapshot rows with null fip_id silently', async () => {
    // Lesson 1: fip_id is canonical identity — never INSERT without one.
    const supabase = fakeSupabase({
      snapshots: [
        snap(null, 'TBD Player', 'ES'),
        snap('P200001', 'Juan Lebron', 'ES'),
      ],
      existingPlayers: [],
    });

    const result = await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.playersInserted).toBe(1);
    expect(result.playersSkippedNoFipId).toBe(1);
  });

  it('keeps only the latest captured_at per (tournament, category) group', async () => {
    // Multiple snapshots accrue over time; we must not re-process
    // earlier captures. Same fip_id appearing in older + newer snapshot
    // batches would be re-processed if we didn't filter.
    const supabase = fakeSupabase({
      snapshots: [
        // Earlier batch — should be ignored
        snap('P200001', 'Old Name', 'ES', 'men', HOUR_AGO),
        // Newer batch — should win
        snap('P200001', 'New Name', 'ES', 'men', NOW),
      ],
      existingPlayers: [],
    });

    const result = await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.snapshotRowsConsidered).toBe(1); // only the latest batch
    expect(result.playersInserted).toBe(1);
    expect(supabase.inserted[0].name).toBe('New Name');
  });

  it('dedups by fip_id within a single tournament+category group', async () => {
    // A fip_id can appear twice in one snapshot batch (the player listed
    // both as their own row and as someone else's partner). First wins.
    const supabase = fakeSupabase({
      snapshots: [
        snap('P200001', 'Juan Lebron', 'ES', 'men'),
        snap('P200001', 'Juan Lebron Bermejo', 'ES', 'men'),  // dup
      ],
      existingPlayers: [],
    });

    const result = await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.playersInserted).toBe(1);
    expect(supabase.inserted).toHaveLength(1);
    expect(supabase.inserted[0].name).toBe('Juan Lebron');  // first occurrence
  });

  it('processes multiple tournaments independently in one run', async () => {
    const supabase = fakeSupabase({
      snapshots: [
        { tournament_id: 't-isla', category: 'men', fip_id: 'P200001', name: 'A', country: 'ES', captured_at: NOW },
        { tournament_id: 't-bari', category: 'men', fip_id: 'P200002', name: 'B', country: 'IT', captured_at: NOW },
        { tournament_id: 't-bari', category: 'women', fip_id: 'P200003', name: 'C', country: 'IT', captured_at: NOW },
      ],
      existingPlayers: [],
    });

    const result = await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsProcessed).toBe(2);  // isla + bari
    expect(result.snapshotRowsConsidered).toBe(3); // all three rows survive
    expect(result.playersInserted).toBe(3);
  });

  it('dryRun: true performs reads but writes nothing', async () => {
    const supabase = fakeSupabase({
      snapshots: [
        snap('P200001', 'Juan Lebron'),
        snap('P200002', 'Ale Galan'),
      ],
      existingPlayers: [
        {
          id: 'existing-1',
          fip_id: 'P200002',
          name: 'A. Galan',  // would change to "Ale Galan"
          country: 'ES',
          category: 'men',
        },
      ],
    });

    const result = await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: true,
    });

    // Counters reflect what WOULD have been written
    expect(result.playersInserted).toBe(1);
    expect(result.playersUpdated).toBe(1);
    expect(result.dryRun).toBe(true);

    // But nothing actually written
    expect(supabase.inserted).toHaveLength(0);
    expect(supabase.updated).toHaveLength(0);
  });

  it('respects 14-day lookback — drops snapshots older than the cutoff', async () => {
    const TWENTY_DAYS_AGO = new Date(
      Date.now() - 20 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const supabase = fakeSupabase({
      snapshots: [
        snap('P200001', 'Recent Player', 'ES', 'men', NOW),
        snap('P200002', 'Old Player', 'ES', 'men', TWENTY_DAYS_AGO),
      ],
      existingPlayers: [],
    });

    const result = await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    // Only the recent one survives the cutoff filter
    expect(result.snapshotRowsConsidered).toBe(1);
    expect(result.playersInserted).toBe(1);
    expect(supabase.inserted[0].name).toBe('Recent Player');
  });

  it('writes external_id alongside fip_id (legacy column kept in sync)', async () => {
    // Lesson 4: the players table has triggers on external_id; even
    // though new code reads/writes via fip_id, we keep the legacy
    // column populated so anything still reading external_id works.
    const supabase = fakeSupabase({
      snapshots: [snap('P200001', 'Juan Lebron')],
      existingPlayers: [],
    });

    await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(supabase.inserted[0]).toMatchObject({
      fip_id: 'P200001',
      external_id: 'P200001',
    });
  });

  it('handles empty snapshot table gracefully', async () => {
    const supabase = fakeSupabase({
      snapshots: [],
      existingPlayers: [],
    });

    const result = await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
    });

    expect(result.tournamentsProcessed).toBe(0);
    expect(result.snapshotRowsConsidered).toBe(0);
    expect(result.playersInserted).toBe(0);
    expect(result.playersUpdated).toBe(0);
    expect(supabase.inserted).toHaveLength(0);
    expect(supabase.updated).toHaveLength(0);
  });
});
