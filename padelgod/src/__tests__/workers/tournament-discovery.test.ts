import { describe, it, expect, vi } from 'vitest';
import { runTournamentDiscovery } from '../../workers/tournament-discovery.js';

function fakeSupabase(maxModified: string | null) {
  const upserted: any[] = [];
  return {
    upserted,
    schema: (_s: string) => ({
      from: (_t: string) => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
        }),
        update: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    }),
    from: (table: string) => ({
      select: (_cols: string) => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({
              data: maxModified ? { updated_at: maxModified } : null,
              error: null,
            }),
          }),
        }),
        // Supports the slug-based pre-fetch for Premier gap-fill.
        in: async (_col: string, _values: string[]) => ({ data: [], error: null }),
      }),
      upsert: (rows: any[], opts: any) => {
        upserted.push({ table, rows, opts });
        return { data: rows.map((r, i) => ({ id: `t-${i}`, ...r })), error: null };
      },
    }),
  };
}

const fakeHttp = (events: any[]) => ({
  get: vi.fn(async (_url: string) => ({
    data: events,
    headers: { 'content-type': 'application/json' },
  })),
});

describe('runTournamentDiscovery', () => {
  it('upserts events returned by the WP API and stamps level from category-event', async () => {
    const supabase = fakeSupabase(null);
    const httpClient = fakeHttp([
      {
        id: 1,
        slug: 'fip-gold-x-2026',
        title: { rendered: 'FIP Gold X 2026' },
        link: 'https://www.padelfip.com/events/fip-gold-x-2026/',
        modified_gmt: '2026-04-19T10:00:00',
        date_gmt: '2026-04-01T08:00:00',
        country: [10],
        gender: [37],
        'category-event': [19],
        'event-year': [705],
      },
    ]);

    const result = await runTournamentDiscovery({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.discovered).toBe(1);
    expect(supabase.upserted).toHaveLength(1);
    expect(supabase.upserted[0].rows[0]).toMatchObject({
      slug: 'fip-gold-x-2026',
      name: 'FIP Gold X 2026',
      level: 'fip_gold',
    });
  });

  it('stamps the lower-tier level for non-Gold FIP categories', async () => {
    const supabase = fakeSupabase(null);
    const httpClient = fakeHttp([
      {
        id: 2,
        slug: 'fip-promises-paris-2026',
        title: { rendered: 'FIP Promises Paris 2026' },
        link: 'https://www.padelfip.com/events/fip-promises-paris-2026/',
        modified_gmt: '2026-04-19T10:00:00',
        date_gmt: '2026-04-01T08:00:00',
        'category-event': [707], // promises-europe
      },
      {
        id: 3,
        slug: 'hexagon-cup-2026',
        title: { rendered: 'Hexagon Cup 2026' },
        link: 'https://www.padelfip.com/events/hexagon-cup-2026/',
        modified_gmt: '2026-04-19T10:00:00',
        date_gmt: '2026-04-01T08:00:00',
        'category-event': [730],
      },
    ]);

    await runTournamentDiscovery({ supabase: supabase as any, httpClient: httpClient as any });

    const rows = supabase.upserted[0].rows;
    expect(rows[0].level).toBe('fip_promises');
    expect(rows[1].level).toBe('fip_hexagon');
  });

  it('omits level for a Premier-tier row when padelapi has already set a value', async () => {
    // fakeSupabase returns [] from the .in() slug-fetch, so existingLevel is
    // undefined (row not found). But we want to exercise the "don't clobber"
    // branch here. Use a custom supabase that returns the row with level='p2'.
    const upserted: any[] = [];
    const supabase = {
      upserted,
      schema: (_s: string) => ({
        from: (_t: string) => ({
          insert: () => ({
            select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
          }),
          update: () => ({ eq: () => ({ data: null, error: null }) }),
        }),
      }),
      from: (table: string) => ({
        select: (_cols: string) => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          // Pre-fetch returns row that already has level set by padelapi.
          in: async (_col: string, _values: string[]) => ({
            data: [{ slug: 'brussels-p2-2026', level: 'p2' }],
            error: null,
          }),
        }),
        upsert: (rows: any[], opts: any) => {
          upserted.push({ table, rows, opts });
          return { data: rows.map((r, i) => ({ id: `t-${i}`, ...r })), error: null };
        },
      }),
    };

    const httpClient = fakeHttp([
      {
        id: 4,
        slug: 'brussels-p2-2026',
        title: { rendered: 'Brussels P2 2026' },
        link: 'https://www.padelfip.com/events/brussels-p2-2026/',
        modified_gmt: '2026-04-19T10:00:00',
        date_gmt: '2026-04-01T08:00:00',
        // FIP tags Premier events under premier-padel (23) + p2 (387).
        // padelapi already owns level='p2' → gap-fill must not clobber it.
        'category-event': [23, 387],
      },
    ]);

    await runTournamentDiscovery({ supabase: supabase as any, httpClient: httpClient as any });

    expect(supabase.upserted[0].rows[0]).not.toHaveProperty('level');
  });

  it('returns 0 discovered when WP returns empty', async () => {
    const supabase = fakeSupabase('2026-04-19T00:00:00');
    const httpClient = fakeHttp([]);

    const result = await runTournamentDiscovery({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.discovered).toBe(0);
    expect(supabase.upserted).toHaveLength(0);
  });
});

// ── Test fixtures for Premier gap-fill tests ──

interface RecordedRow {
  slug?: string;
  level?: string;
  [key: string]: unknown;
}

interface MockOpts {
  /** Existing rows in public.tournaments — keyed by slug. Test sets `level` to either a string or null. */
  existingRows: Array<{ slug: string; level: string | null }>;
  /** WP events the HTTP client returns (will be transformed into rows passed to .upsert). */
  events: Array<{ wpId: number; name: string; slug: string; categoryIds: number[] }>;
  /** Captures the rows the worker upserts. */
  onUpsert: (rows: RecordedRow[]) => void;
}

function makeMockSupabase(opts: MockOpts) {
  return {
    schema: (_s: string) => ({
      from: (_t: string) => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
        }),
        update: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    }),
    from: (_table: string) => ({
      select: (_cols?: string) => {
        // Two select shapes: the worker's "max updated_at" lookup and our
        // own slug-fetch for gap-fill. Differentiate by the chained method.
        return {
          order: () => ({
            limit: () => ({ maybeSingle: async () => ({ data: null }) }),
          }),
          in: async (_col: string, _values: string[]) => ({
            data: opts.existingRows.map((r) => ({ slug: r.slug, level: r.level })),
            error: null,
          }),
        };
      },
      upsert: async (rows: RecordedRow[]) => {
        opts.onUpsert(rows);
        return { error: null };
      },
    }),
  } as unknown as Parameters<typeof runTournamentDiscovery>[0]['supabase'];
}

function makeMockHttp(events: MockOpts['events']) {
  return {
    get: async () => ({
      data: events.map((e) => ({
        id: e.wpId,
        title: { rendered: e.name },
        slug: e.slug,
        link: `https://www.padelfip.com/events/${e.slug}/`,
        featured_media: 0,
        'category-event': e.categoryIds,
        country: [],
        gender: [],
      })),
      headers: {},
    }),
  } as unknown as Parameters<typeof runTournamentDiscovery>[0]['httpClient'];
}

describe('runTournamentDiscovery — Premier gap-fill', () => {
  it('writes level for a Premier row when existing row has null', async () => {
    const upserted: RecordedRow[] = [];
    const supabase = makeMockSupabase({
      existingRows: [{ slug: 'newgiza-p2-2026', level: null }],
      events: [{ wpId: 1, name: 'NewGiza P2', slug: 'newgiza-p2-2026', categoryIds: [387] }],
      onUpsert: (rows) => upserted.push(...rows),
    });
    const httpClient = makeMockHttp([
      { wpId: 1, name: 'NewGiza P2', slug: 'newgiza-p2-2026', categoryIds: [387] },
    ]);

    await runTournamentDiscovery({ supabase, httpClient });

    const newgiza = upserted.find((r) => r.slug === 'newgiza-p2-2026');
    expect(newgiza?.level).toBe('p2');
  });

  it('does NOT include level on the upsert when existing row already has one', async () => {
    const upserted: RecordedRow[] = [];
    const supabase = makeMockSupabase({
      existingRows: [{ slug: 'newgiza-p2-2026', level: 'p2' }],
      events: [{ wpId: 1, name: 'NewGiza P2', slug: 'newgiza-p2-2026', categoryIds: [387] }],
      onUpsert: (rows) => upserted.push(...rows),
    });
    const httpClient = makeMockHttp([
      { wpId: 1, name: 'NewGiza P2', slug: 'newgiza-p2-2026', categoryIds: [387] },
    ]);

    await runTournamentDiscovery({ supabase, httpClient });

    const newgiza = upserted.find((r) => r.slug === 'newgiza-p2-2026');
    // Premier row already has level — leave it alone.
    expect(newgiza?.level).toBeUndefined();
  });

  it('writes level normally for non-Premier (resolveFipLevel path)', async () => {
    const upserted: RecordedRow[] = [];
    const supabase = makeMockSupabase({
      existingRows: [{ slug: 'fip-bronze-test-2026', level: null }],
      events: [{ wpId: 1, name: 'Test Bronze', slug: 'fip-bronze-test-2026', categoryIds: [497] }],
      onUpsert: (rows) => upserted.push(...rows),
    });
    const httpClient = makeMockHttp([
      { wpId: 1, name: 'Test Bronze', slug: 'fip-bronze-test-2026', categoryIds: [497] },
    ]);

    await runTournamentDiscovery({ supabase, httpClient });

    const bronze = upserted.find((r) => r.slug === 'fip-bronze-test-2026');
    expect(bronze?.level).toBe('fip_bronze');
  });
});
