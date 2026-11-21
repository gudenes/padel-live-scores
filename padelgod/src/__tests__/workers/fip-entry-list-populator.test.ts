import { describe, it, expect, vi } from 'vitest';
// Profile adoption behavior is covered by the full-name resolver tests.
vi.mock('../../lib/fip-draw-player.js', () => ({ attachFipIdToDrawProfile: async () => null }));
import {
  runFipEntryListPopulator,
  shouldSkipEntriesShrink,
  isTournamentStarted,
} from '../../workers/fip-entry-list-populator.js';

// ── Test fixtures ────────────────────────────────────────────────────────
//
// The fake supabase below is deliberately small — it speaks only the two
// queries the worker actually issues:
//   1. supabase.schema('padelgod').from('entry_list_snapshots').select(...)
//        .gte(...).order(...).order(...).range(start, end)   (paginated)
//   2. supabase.from('players').select(...).in('fip_id', [...])   (chunked)
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
  seed?: number | null;
  partner_fip_id?: string | null;
  partner_name?: string | null;
  draw_type?: string | null;
}

interface ExistingPlayerSeed {
  id: string;
  fip_id: string;
  name: string | null;
  country: string | null;
  category: string | null;
  points?: number | null;
}

interface Options {
  snapshots?: SnapshotSeed[];
  existingPlayers?: ExistingPlayerSeed[];
  /** Pre-existing tournament_entries row counts, keyed `${tid}::${cat}`. */
  existingEntryCounts?: Record<string, number>;
  /** Simulated PostgREST db_max_rows: a `.range()` page never returns more. */
  maxRowsPerRequest?: number;
  /** tournaments.starts_at by id. Missing id → row absent (unknown start). */
  tournamentStarts?: Record<string, string | null>;
  /** Make the tournaments starts_at read return an error. */
  tournamentsReadFails?: boolean;
}

function fakeSupabase(opts: Options) {
  const snapshots = opts.snapshots ?? [];
  const existing: ExistingPlayerSeed[] = [...(opts.existingPlayers ?? [])];

  const inserted: Record<string, unknown>[] = [];
  const updated: Array<{ id: string; patch: Record<string, unknown> }> = [];
  // tournament_entries capture: replace-per-bucket delete + bulk insert.
  const entryDeletes: Array<{ tournament_id: string; category: string }> = [];
  const entryInserts: Record<string, unknown>[] = [];
  // Claim ledger for notification_events_sent — persists across runs that
  // reuse this same fake, mirroring the real once-ever-per-key behaviour.
  const claimedKeys = new Set<string>();
  // Query-shape telemetry for the pagination / chunking tests.
  const snapshotRanges: Array<[number, number]> = [];
  const playerInSizes: number[] = [];
  const maxRowsPerRequest = opts.maxRowsPerRequest ?? Infinity;
  const entryCounts = { ...(opts.existingEntryCounts ?? {}) };

  // claimNotificationEvent does: .upsert({event_key,category},{ignoreDuplicates})
  //   .select('event_key') → returns [row] on first claim, [] on duplicate.
  const notificationEventsSentTable = () => ({
    upsert: (row: Record<string, unknown>, _opts: unknown) => ({
      select: (_cols: string) => {
        const key = String(row.event_key);
        if (claimedKeys.has(key)) {
          return Promise.resolve({ data: [], error: null });
        }
        claimedKeys.add(key);
        return Promise.resolve({ data: [{ event_key: key }], error: null });
      },
    }),
  });

  const entryListSnapshotsTable = () => ({
    select: (_cols: string) => ({
      gte: (col: string, val: string) => {
        if (col !== 'captured_at') {
          throw new Error(`unexpected entry_list_snapshots filter: ${col}`);
        }
        const all = snapshots
          .filter((s) => s.captured_at >= val)
          .sort((a, b) => (a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : 0))
          .map((s) => ({
            tournament_id: s.tournament_id,
            category: s.category,
            fip_id: s.fip_id,
            name: s.name,
            country: s.country,
            captured_at: s.captured_at,
            seed: s.seed ?? null,
            partner_fip_id: s.partner_fip_id ?? null,
            partner_name: s.partner_name ?? null,
            draw_type: s.draw_type ?? null,
          }));
        const builder = {
          // Unranged read (the pre-fix shape): PostgREST silently returns
          // only the first db_max_rows rows — oldest first, like prod.
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: all.slice(0, maxRowsPerRequest), error: null }),
          order: (_c: string, _o?: unknown) => builder,
          range: (start: number, end: number) => {
            snapshotRanges.push([start, end]);
            const cappedEnd = Math.min(end, start + maxRowsPerRequest - 1);
            return Promise.resolve({ data: all.slice(start, cappedEnd + 1), error: null });
          },
        };
        return builder;
      },
    }),
  });

  const playersTable = () => ({
    select: (_cols: string) => ({
      in: (col: string, values: string[]) => {
        if (col !== 'fip_id') {
          throw new Error(`unexpected players filter: ${col}`);
        }
        playerInSizes.push(values.length);
        const data = existing
          .filter((p) => p.fip_id != null && values.includes(p.fip_id))
          .map((p) => ({ ...p, points: p.points ?? null }));
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

  const tournamentEntriesTable = () => ({
    select: (_cols: string, _opts: unknown) => ({
      eq: (_c1: string, tid: string) => ({
        eq: (_c2: string, cat: string) =>
          Promise.resolve({ count: entryCounts[`${tid}::${cat}`] ?? 0, error: null }),
      }),
    }),
    delete: () => ({
      eq: (col1: string, val1: string) => ({
        eq: (col2: string, val2: string) => {
          if (col1 !== 'tournament_id' || col2 !== 'category') {
            throw new Error(
              `unexpected tournament_entries delete filter: ${col1}, ${col2}`,
            );
          }
          entryDeletes.push({ tournament_id: val1, category: val2 });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
    insert: (rows: Record<string, unknown>[]) => {
      for (const row of rows) entryInserts.push(row);
      return Promise.resolve({ data: null, error: null });
    },
  });

  const client = {
    inserted,
    updated,
    entryDeletes,
    entryInserts,
    snapshotRanges,
    playerInSizes,
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
      if (t === 'notification_events_sent') return notificationEventsSentTable();
      if (t === 'tournament_entries') return tournamentEntriesTable();
      if (t === 'tournaments') {
        return {
          select: (_cols: string) => ({
            in: (_col: string, ids: string[]) =>
              opts.tournamentsReadFails
                ? Promise.resolve({ data: null, error: { message: 'boom' } })
                : Promise.resolve({
                    data: ids
                      .filter((id) => id in (opts.tournamentStarts ?? {}))
                      .map((id) => ({ id, starts_at: opts.tournamentStarts![id] })),
                    error: null,
                  }),
          }),
        };
      }
      throw new Error(`unexpected public table: ${t}`);
    },
  };

  // Existing tests use the whole return value as the supabase client
  // (`const supabase = fakeSupabase(...)`), reading `.inserted`/`.updated`
  // off it. The tournament_entries tests destructure `{ supabase, entryInserts,
  // entryDeletes }`. Expose both shapes: the client keys live at the top level,
  // and `supabase` self-references the client.
  return Object.assign(client, { supabase: client });
}

// Capturing notify deps: records every notify-event POST so tests can assert
// the coalesced per-tournament fan-out shape.
function captureNotify() {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const deps = {
    baseUrl: 'https://app.test',
    cronSecret: 'sec',
    logger: { warn() {}, info() {} } as unknown,
    fetchImpl: ((url: string, init: { body: string }) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({ ok: true, text: () => Promise.resolve('') });
    }) as unknown,
  };
  const entryPosts = () =>
    posts.filter((p) => p.url.endsWith('/api/push/notify-event'));
  return { deps, posts, entryPosts };
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

  // Momo González (P000011) conflation guard: a snapshot whose fip_id points
  // at an established record but whose parsed name is a DIFFERENT person
  // (shares only a surname) must NOT overwrite the canonical name. name is
  // FIP-primary per source-priority — entry-list PDF text never owns it when
  // the names are incompatible.
  it('does NOT overwrite an established name with an incompatible snapshot name', async () => {
    const supabase = fakeSupabase({
      snapshots: [snap('P000011', 'Juan Pereiro González', 'ES')],
      existingPlayers: [
        { id: 'momo', fip_id: 'P000011', name: 'Jeronimo Gonzalez', country: 'ES', category: 'men' },
      ],
    });

    const result = await runFipEntryListPopulator({ supabase: supabase as any, dryRun: false });

    expect(result.playersUpdated).toBe(0);
    expect(result.playersSkippedNoChange).toBe(1);
    for (const u of supabase.updated) expect(u.patch).not.toHaveProperty('name');
  });

  // The complementary case: a fuller form of the SAME person (subset, ≥2
  // shared tokens) is a legitimate enrichment and DOES update.
  it('still enriches a name when the snapshot is a compatible fuller form', async () => {
    const supabase = fakeSupabase({
      snapshots: [snap('P200001', 'Juan Lebron Bermejo', 'ES')],
      existingPlayers: [
        { id: 'lebron', fip_id: 'P200001', name: 'Juan Lebron', country: 'ES', category: 'men' },
      ],
    });

    const result = await runFipEntryListPopulator({ supabase: supabase as any, dryRun: false });

    expect(result.playersUpdated).toBe(1);
    expect(supabase.updated[0].patch).toMatchObject({ name: 'Juan Lebron Bermejo' });
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

  // ── player_entered coalescing (the "New tournament entry" dedup) ──────────

  it('coalesces all newly-entered players in a tournament into ONE notify-event', async () => {
    const supabase = fakeSupabase({
      snapshots: [snap('P1', 'A'), snap('P2', 'B'), snap('P3', 'C')],
      existingPlayers: [],
    });
    const { deps, entryPosts } = captureNotify();

    await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
      notify: deps as any,
      eventsEnabled: true,
    });

    const posts = entryPosts();
    // One push for the whole tournament — NOT one per player.
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({
      category: 'player_entered',
      entityType: 'player',
      dedupeKey: `player_entered:${TOURNAMENT_ID}`,
      url: `/tournaments/${TOURNAMENT_ID}?tab=entries`,
      personalizePerFollower: true,
      metadata: { tournamentId: TOURNAMENT_ID },
    });
    expect([...(posts[0].body.entityIds as string[])].sort()).toEqual([
      'new-player-1',
      'new-player-2',
      'new-player-3',
    ]);
  });

  it('lands the player_entered push on the entries tab (entries tab)', async () => {
    // The Entries tab is the natural landing spot for a "New tournament
    // entry" push — deep-link straight to it instead of the tournament's
    // default tab.
    const supabase = fakeSupabase({
      snapshots: [snap('P200001', 'Juan Lebron')],
      existingPlayers: [],
    });
    const { deps, entryPosts } = captureNotify();

    await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
      notify: deps as any,
      eventsEnabled: true,
    });

    const posts = entryPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].body.url).toBe(`/tournaments/${TOURNAMENT_ID}?tab=entries`);
  });

  it('fires a separate notify-event per tournament', async () => {
    const supabase = fakeSupabase({
      snapshots: [
        { ...snap('P1', 'A'), tournament_id: 't-a' },
        { ...snap('P2', 'B'), tournament_id: 't-a' },
        { ...snap('P3', 'C'), tournament_id: 't-b' },
      ],
      existingPlayers: [],
    });
    const { deps, entryPosts } = captureNotify();

    await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
      notify: deps as any,
      eventsEnabled: true,
    });

    const posts = entryPosts();
    expect(posts).toHaveLength(2);
    const byUrl = Object.fromEntries(
      posts.map((p) => [p.body.url as string, (p.body.entityIds as string[]).length]),
    );
    expect(byUrl['/tournaments/t-a?tab=entries']).toBe(2);
    expect(byUrl['/tournaments/t-b?tab=entries']).toBe(1);
  });

  it('does not re-fire for players already claimed in a prior run', async () => {
    const supabase = fakeSupabase({
      snapshots: [snap('P1', 'A'), snap('P2', 'B')],
      existingPlayers: [
        { id: 'pl-1', fip_id: 'P1', name: 'A', country: 'ES', category: 'men' },
        { id: 'pl-2', fip_id: 'P2', name: 'B', country: 'ES', category: 'men' },
      ],
    });
    const { deps, entryPosts } = captureNotify();

    // First run claims both players → one coalesced push.
    await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
      notify: deps as any,
      eventsEnabled: true,
    });
    // Second run: both keys already claimed → nothing new → no push.
    await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
      notify: deps as any,
      eventsEnabled: true,
    });

    const posts = entryPosts();
    expect(posts).toHaveLength(1);
    expect([...(posts[0].body.entityIds as string[])].sort()).toEqual(['pl-1', 'pl-2']);
  });

  it('sends nothing when eventsEnabled is off (ships dark)', async () => {
    const supabase = fakeSupabase({
      snapshots: [snap('P1', 'A')],
      existingPlayers: [],
    });
    const { deps, entryPosts } = captureNotify();

    await runFipEntryListPopulator({
      supabase: supabase as any,
      dryRun: false,
      notify: deps as any,
      eventsEnabled: false,
    });

    expect(entryPosts()).toHaveLength(0);
  });

  // ── tournament_entries writes ─────────────────────────────────────────────
  //
  // captured_at MUST stay relative to NOW. The worker only reads snapshots
  // newer than SNAPSHOT_LOOKBACK_DAYS (14), so a hardcoded date silently
  // stops matching once it ages past the window — these two tests were
  // pinned to 2026-07-01 and went red on 2026-07-15, months before anyone
  // traced it back here.

  it('writes one tournament_entries row per pair, resolved with team_points', async () => {
    const { supabase, entryInserts, entryDeletes } = fakeSupabase({
      snapshots: [
        { tournament_id: 't1', category: 'men', fip_id: 'A', name: 'Galán', country: 'ES', captured_at: NOW, seed: 1, partner_fip_id: 'B', partner_name: 'Chingotto', draw_type: 'main_draw' },
        { tournament_id: 't1', category: 'men', fip_id: 'B', name: 'Chingotto', country: 'AR', captured_at: NOW, seed: 1, partner_fip_id: 'A', partner_name: 'Galán', draw_type: 'main_draw' },
      ],
      existingPlayers: [
        { id: 'p-A', fip_id: 'A', name: 'Galán', country: 'ES', category: 'men', points: 15000 },
        { id: 'p-B', fip_id: 'B', name: 'Chingotto', country: 'AR', category: 'men', points: 13000 },
      ],
    });
    await runFipEntryListPopulator({ supabase: supabase as any, dryRun: false });
    expect(entryDeletes).toContainEqual({ tournament_id: 't1', category: 'men' });
    expect(entryInserts).toHaveLength(1);
    expect(entryInserts[0]).toMatchObject({
      tournament_id: 't1', category: 'men', draw_type: 'main_draw', seed: 1,
      player1_id: 'p-A', player2_id: 'p-B', team_points: 28000,
    });
  });

  it('does not touch tournament_entries on dry-run', async () => {
    const { supabase, entryInserts, entryDeletes } = fakeSupabase({
      snapshots: [
        { tournament_id: 't1', category: 'men', fip_id: 'A', name: 'Galán', country: 'ES', captured_at: NOW, seed: 1, partner_fip_id: 'B', partner_name: 'Chingotto', draw_type: 'main_draw' },
      ],
    });
    await runFipEntryListPopulator({ supabase: supabase as any, dryRun: true });
    expect(entryDeletes).toHaveLength(0);
    expect(entryInserts).toHaveLength(0);
  });

  // ── Regression: Mexico Major 2026-11-21 ─────────────────────────────────
  // The snapshot window (~50k rows) exceeded PostgREST's 10k cap; the
  // unranged read was truncated to an old partial slice and the Entries tab
  // was replace-written with 2 of 73 pairs. These pin the paginated read.

  function pairRows(tid: string, n: number, capturedAt: string, prefix: string) {
    const rows: SnapshotSeed[] = [];
    for (let i = 0; i < n; i++) {
      const a = `${prefix}${i}a`;
      const b = `${prefix}${i}b`;
      rows.push(
        { tournament_id: tid, category: 'men', fip_id: a, name: `A${i}`, country: 'ES', captured_at: capturedAt, seed: i + 1, partner_fip_id: b, partner_name: `B${i}`, draw_type: 'main_draw' },
        { tournament_id: tid, category: 'men', fip_id: b, name: `B${i}`, country: 'ES', captured_at: capturedAt, seed: i + 1, partner_fip_id: a, partner_name: `A${i}`, draw_type: 'main_draw' },
      );
    }
    return rows;
  }

  it('reads every page past the row cap — the latest capture is not truncated', async () => {
    const old = pairRows('t-old', 800, DAY_AGO, 'O'); // 1600 older rows fill page 1+
    const latest = pairRows('t-mx', 73, NOW, 'M'); // the capture that used to be cut off
    const { supabase, entryInserts, snapshotRanges } = fakeSupabase({
      snapshots: [...old, ...latest],
      maxRowsPerRequest: 1000,
    });
    await runFipEntryListPopulator({ supabase: supabase as any, dryRun: false });
    expect(snapshotRanges.length).toBeGreaterThan(1);
    const mx = entryInserts.filter((r) => r.tournament_id === 't-mx');
    expect(mx).toHaveLength(73);
  });

  it('chunks the players lookup so no single .in() carries >200 fip_ids', async () => {
    const { supabase, playerInSizes } = fakeSupabase({
      snapshots: pairRows('t1', 300, NOW, 'C'), // 600 distinct fip_ids
    });
    await runFipEntryListPopulator({ supabase: supabase as any, dryRun: true });
    expect(playerInSizes.reduce((a, b) => a + b, 0)).toBe(600);
    expect(Math.max(...playerInSizes)).toBeLessThanOrEqual(200);
  });

  it('shrink guard: refuses to replace a stored list with far fewer pairs', async () => {
    const { supabase, entryDeletes, entryInserts } = fakeSupabase({
      snapshots: pairRows('t1', 2, NOW, 'S'),
      existingEntryCounts: { 't1::men': 73 },
    });
    const res = await runFipEntryListPopulator({ supabase: supabase as any, dryRun: false });
    expect(entryDeletes).toHaveLength(0);
    expect(entryInserts).toHaveLength(0);
    expect(res.entryBucketsSkippedShrink).toBe(1);
    expect(res.entryBucketsWritten).toBe(0);
  });

  it('shrink guard: lets a truncated list recover (2 stored → 73 fresh)', async () => {
    const { supabase, entryInserts } = fakeSupabase({
      snapshots: pairRows('t1', 73, NOW, 'R'),
      existingEntryCounts: { 't1::men': 2 },
    });
    const res = await runFipEntryListPopulator({ supabase: supabase as any, dryRun: false });
    expect(entryInserts).toHaveLength(73);
    expect(res.entryBucketsWritten).toBe(1);
  });

  it('shouldSkipEntriesShrink thresholds', () => {
    expect(shouldSkipEntriesShrink(73, 2)).toBe(true);
    expect(shouldSkipEntriesShrink(73, 37)).toBe(false); // ≥ 50% kept
    expect(shouldSkipEntriesShrink(73, 36)).toBe(true);
    expect(shouldSkipEntriesShrink(7, 1)).toBe(false); // small lists always replace
    expect(shouldSkipEntriesShrink(2, 73)).toBe(false);
  });

  // ── player_entered only before the tournament starts ────────────────────
  const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  async function runWithNotify(opts: Options) {
    const supabase = fakeSupabase(opts);
    const { deps, entryPosts } = captureNotify();
    const res = await runFipEntryListPopulator({
      supabase: supabase as any, dryRun: false, notify: deps as any, eventsEnabled: true,
    });
    return { res, posts: entryPosts() };
  }

  it('skips player_entered for a tournament that has already started', async () => {
    const { res, posts } = await runWithNotify({
      snapshots: [snap('P1', 'A'), snap('P2', 'B')],
      tournamentStarts: { [TOURNAMENT_ID]: DAY_AGO },
    });
    expect(posts).toHaveLength(0);
    expect(res.playerEnteredSkippedStarted).toBe(2);
  });

  it('does not claim the key for a started tournament (no permanent burn)', async () => {
    const supabase = fakeSupabase({
      snapshots: [snap('P1', 'A')],
      tournamentStarts: { [TOURNAMENT_ID]: DAY_AGO },
    });
    const { deps } = captureNotify();
    await runFipEntryListPopulator({ supabase: supabase as any, dryRun: false, notify: deps as any, eventsEnabled: true });
    // A claim would have gone through notification_events_sent; a fresh
    // claim attempt for the same key must still succeed.
    const r = await (supabase as any).from('notification_events_sent')
      .upsert({ event_key: `player_entered:${TOURNAMENT_ID}:new-player-1`, category: 'player_entered' }, {})
      .select('event_key');
    expect(r.data).toHaveLength(1);
  });

  it('still sends player_entered for an upcoming tournament', async () => {
    const { res, posts } = await runWithNotify({
      snapshots: [snap('P1', 'A')],
      tournamentStarts: { [TOURNAMENT_ID]: FUTURE },
    });
    expect(posts).toHaveLength(1);
    expect(res.playerEnteredSkippedStarted).toBe(0);
  });

  it('gates per tournament: started one silent, upcoming one sends', async () => {
    const { posts } = await runWithNotify({
      snapshots: [
        { ...snap('P1', 'A'), tournament_id: 't-started' },
        { ...snap('P2', 'B'), tournament_id: 't-upcoming' },
      ],
      tournamentStarts: { 't-started': DAY_AGO, 't-upcoming': FUTURE },
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ metadata: { tournamentId: 't-upcoming' } });
  });

  it('fails closed: tournaments read error → no player_entered sends', async () => {
    const { res, posts } = await runWithNotify({
      snapshots: [snap('P1', 'A')],
      tournamentsReadFails: true,
    });
    expect(posts).toHaveLength(0);
    expect(res.playerEnteredSkippedStarted).toBe(1);
  });

  it('isTournamentStarted', () => {
    const now = new Date('2026-11-21T15:00:00Z');
    expect(isTournamentStarted('2026-11-21T00:00:00Z', now)).toBe(true);
    expect(isTournamentStarted('2026-11-22T00:00:00Z', now)).toBe(false);
    expect(isTournamentStarted(null, now)).toBe(false);
    expect(isTournamentStarted('garbage', now)).toBe(false);
  });
});
