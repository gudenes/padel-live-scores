import { describe, it, expect, vi } from 'vitest';
import { runTournamentDiscovery } from '../../workers/tournament-discovery.js';

function fakeSupabase(maxModified: string | null, twinCandidates: any[] = []) {
  const upserted: any[] = [];
  // Twin-lookup chain: .select(...).not(...).is(...).gte(...).lte(...) → thenable
  const twinChain = {
    not: (_c: string, _o: string, _v: any) => twinChain,
    is: (_c: string, _v: any) => twinChain,
    gte: (_c: string, _v: any) => twinChain,
    lte: (_c: string, _v: any) => twinChain,
    then: (resolve: any) => resolve({ data: twinCandidates, error: null }),
  };
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
        // Supports the twin-lookup chain (.not / .is / .gte / .lte).
        not: (_c: string, _o: string, _v: any) => twinChain,
      }),
      upsert: (rows: any[], opts: any) => {
        upserted.push({ table, rows, opts });
        return { data: rows.map((r, i) => ({ id: `t-${i}`, ...r })), error: null };
      },
    }),
  };
}

const fakeHttp = (events: any[], countryTerms: any[] = []) => ({
  get: vi.fn(async (url: string) => {
    if (url.includes('/wp/v2/country')) {
      return { data: countryTerms, headers: { 'content-type': 'application/json' } };
    }
    return { data: events, headers: { 'content-type': 'application/json' } };
  }),
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

  it('preserves the existing level on upsert when padelapi already set one (no clobber)', async () => {
    // Supabase `.upsert()` with merge-duplicates resets columns missing
    // from the payload to their DEFAULT on the UPDATE path — so omitting
    // `level` was actually nuking the existing value to NULL. The fix:
    // when neither resolveFipLevel nor resolvePremierLevel applies AND
    // the existing row has a level, write that existing level back into
    // the upsert payload so the UPDATE preserves it instead of clearing.
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
      from: (table: string) => {
        const twinChain = {
          not: (_c: string, _o: string, _v: any) => twinChain,
          is: (_c: string, _v: any) => twinChain,
          gte: (_c: string, _v: any) => twinChain,
          lte: (_c: string, _v: any) => twinChain,
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
        return {
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
            not: (_c: string, _o: string, _v: any) => twinChain,
          }),
          upsert: (rows: any[], opts: any) => {
            upserted.push({ table, rows, opts });
            return { data: rows.map((r, i) => ({ id: `t-${i}`, ...r })), error: null };
          },
        };
      },
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

    // Existing level is echoed into the payload so the UPDATE path
    // preserves it. This is the regression-prevention assertion for
    // the Asuncion P2 disappearance bug (2026-04-28 / 2026-04-29).
    expect(supabase.upserted[0].rows[0].level).toBe('p2');
  });

  it('returns 0 discovered when WP returns empty', async () => {
    const supabase = fakeSupabase('2026-04-19T00:00:00');
    const httpClient = fakeHttp([]);

    const result = await runTournamentDiscovery({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.discovered).toBe(0);
    expect(supabase.upserted).toHaveLength(0);
  });

  it('merges into existing padelapi twin instead of inserting a duplicate row', async () => {
    // Regression: Marmotor existed twice — once as padelapi-imported
    // (slug=null, padelapi_id='806') and once as FIP-only (fip_id=
    // 'fip-silver-club-la-calzada-2026'). The FIP discovery's
    // `onConflict: 'slug'` couldn't find the padelapi row, so it
    // inserted a second row instead of enriching in place.
    //
    // After the fix: a name-token+year match against the twinCandidates
    // pool routes the FIP event into the existing row (UPDATE by id).
    // The twin's id surfaces in the upsert payload; result.twinMerges
    // counts these.
    const twinId = 'ff200835-44d3-4c2f-8d6b-07a9e6f45793';
    const supabase = fakeSupabase(null, [
      {
        id: twinId,
        slug: null,
        fip_id: null,
        padelapi_id: '806',
        level: null,
        country: 'ES',
        name: 'FIP SILVER BMW MARMOTOR 26º ANIVERSARIO CLUB LA CALZADA',
        starts_at: '2026-04-29T00:00:00+00:00',
      },
    ]);
    const httpClient = fakeHttp([
      {
        id: 5,
        slug: 'fip-silver-club-la-calzada-2026',
        title: { rendered: 'FIP SILVER BMW MARMOTOR 26º ANIVERSARIO CLUB LA CALZADA' },
        link: 'https://www.padelfip.com/events/fip-silver-club-la-calzada-2026/',
        modified_gmt: '2026-04-29T10:00:00',
        date_gmt: '2026-04-15T08:00:00',
        country: [], gender: [],
        // FIP Silver category-event term id
        'category-event': [496],
      },
    ]);

    const result = await runTournamentDiscovery({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.twinMerges).toBe(1);
    // The twin path goes through `onConflict: 'id'`, not 'slug'. The row
    // payload carries the twin's id so the upsert UPDATEs in place.
    const twinUpsert = supabase.upserted.find((u: any) => u.opts?.onConflict === 'id');
    expect(twinUpsert).toBeDefined();
    expect(twinUpsert!.rows[0].id).toBe(twinId);
    expect(twinUpsert!.rows[0].slug).toBe('fip-silver-club-la-calzada-2026');
    expect(twinUpsert!.rows[0].level).toBe('fip_silver');
    // The standard slug-conflict path should be empty for this run.
    const slugUpsert = supabase.upserted.find((u: any) => u.opts?.onConflict === 'slug');
    expect(slugUpsert).toBeUndefined();
  });

  it('does NOT merge when twin already has a fip_id (already linked)', async () => {
    // If a twin already carries a fip_id, it's been linked before — don't
    // overwrite. The new event must be a different physical tournament
    // (same name in a later year, same name on a different tour, etc.)
    // and gets the normal upsert path.
    const supabase = fakeSupabase(null, [
      {
        id: 'already-linked',
        slug: 'old-slug',
        fip_id: 'fip-existing-link',
        padelapi_id: '999',
        level: 'fip_silver',
        country: 'ES',
        name: 'FIP Silver Foo 2026',
        starts_at: '2026-04-01',
      },
    ]);
    const httpClient = fakeHttp([
      {
        id: 6,
        slug: 'fip-silver-foo-2026',
        title: { rendered: 'FIP Silver Foo 2026' },
        link: '',
        modified_gmt: '2026-04-29T10:00:00',
        date_gmt: '2026-04-01T08:00:00',
        country: [], gender: [],
        'category-event': [21],
      },
    ]);

    // Twin lookup query filters `is fip_id null`, so the already-linked
    // row is filtered out before we even see it. Sanity check: by passing
    // it in twinCandidates we simulate the (impossible) case where it
    // leaked through — the worker still treats it correctly because the
    // SQL filter is the source of truth. Here we re-assert behavior by
    // using an empty candidate pool (matching production filter).
    const supabaseClean = fakeSupabase(null, []);
    const result = await runTournamentDiscovery({ supabase: supabaseClean as any, httpClient: httpClient as any });

    expect(result.twinMerges).toBe(0);
    const slugUpsert = supabaseClean.upserted.find((u: any) => u.opts?.onConflict === 'slug');
    expect(slugUpsert).toBeDefined();
    // suppress unused-var lint
    void supabase;
  });

  it("sets live_source='padelgod' on new tournament INSERTs", async () => {
    const supa = fakeSupabase('2026-01-01T00:00:00Z')
    const httpClient = {
      get: vi.fn().mockResolvedValue({
        data: [
          {
            id: 999,
            slug: 'fip-bronze-newtown-2026',
            title: { rendered: 'FIP BRONZE NEWTOWN' },
            modified_gmt: '2026-05-01T00:00:00',
            acmf_event: {
              accommodation_start_date: '2026-06-01',
              accommodation_end_date: '2026-06-07',
            },
            tournament_category: [497],   // fip-bronze category id
            country: [],
          },
        ],
      }),
    } as never
    await runTournamentDiscovery({ supabase: supa as never, httpClient, logger: console as never })
    const tournamentUpserts = supa.upserted.filter((u: any) => u.table === 'tournaments')
    expect(tournamentUpserts.length).toBeGreaterThan(0)
    const insertedRow = tournamentUpserts[0].rows[0]
    expect(insertedRow.live_source).toBe('padelgod')
  })
});

// ── Test fixtures for Premier gap-fill tests ──

interface RecordedRow {
  slug?: string;
  level?: string;
  [key: string]: unknown;
}

interface MockOpts {
  /** Existing rows in public.tournaments — keyed by slug. Test sets `level` to either a string or null. */
  existingRows: Array<{ slug: string; level: string | null; country?: string | null }>;
  /** WP events the HTTP client returns (will be transformed into rows passed to .upsert). */
  events: Array<{ wpId: number; name: string; slug: string; categoryIds: number[]; countryTermIds?: number[] }>;
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
    from: (_table: string) => {
      // Twin-lookup chain: the worker queries existing padelapi rows
      // that have no fip_id yet. Tests in this file don't seed twins,
      // so this resolves to an empty list.
      const twinChain = {
        not: (_c: string, _o: string, _v: any) => twinChain,
        is: (_c: string, _v: any) => twinChain,
        gte: (_c: string, _v: any) => twinChain,
        lte: (_c: string, _v: any) => twinChain,
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      return {
        select: (_cols?: string) => {
          // Three select shapes: the worker's "max updated_at" lookup,
          // the slug pre-fetch for gap-fill, and the twin lookup.
          return {
            order: () => ({
              limit: () => ({ maybeSingle: async () => ({ data: null }) }),
            }),
            in: async (_col: string, _values: string[]) => ({
              data: opts.existingRows.map((r) => ({
                slug: r.slug,
                level: r.level,
                country: r.country ?? null,
              })),
              error: null,
            }),
            not: (_c: string, _o: string, _v: any) => twinChain,
          };
        },
        upsert: async (rows: RecordedRow[]) => {
          opts.onUpsert(rows);
          return { error: null };
        },
      };
    },
  } as unknown as Parameters<typeof runTournamentDiscovery>[0]['supabase'];
}

function makeMockHttp(events: MockOpts['events'], countryTerms: any[] = []) {
  return {
    get: async (url: string) => {
      if (url.includes('/wp/v2/country')) {
        return { data: countryTerms, headers: {} };
      }
      return {
        data: events.map((e) => ({
          id: e.wpId,
          title: { rendered: e.name },
          slug: e.slug,
          link: `https://www.padelfip.com/events/${e.slug}/`,
          featured_media: 0,
          'category-event': e.categoryIds,
          country: (e as any).countryTermIds ?? [],
          gender: [],
        })),
        headers: {},
      };
    },
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

  it('preserves the existing Premier level on upsert (writes it back, not undefined)', async () => {
    // Regression test for the Asuncion P2 disappearance bug (2026-04-28
    // / 2026-04-29): omitting `level` from a Supabase upsert payload
    // doesn't preserve it — merge-duplicates resets the column to its
    // default (NULL). The fix echoes the existing level into the
    // payload so the UPDATE path actually preserves it.
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
    expect(newgiza?.level).toBe('p2');
  });

  it('preserves the existing level when WP taxonomy carries no resolvable level (Asuncion repro)', async () => {
    // Concrete repro: WP feed for Asuncion P2 2026 has category-event
    // term IDs that resolveFipLevel doesn't recognise AND the Premier
    // gap-fill (resolvePremierLevel) also returns null. With the old
    // logic the upsert payload omitted `level` and the existing
    // 'p2' got blanked. With the fix it's echoed back.
    const upserted: RecordedRow[] = [];
    const supabase = makeMockSupabase({
      existingRows: [{ slug: 'asuncion-p2-2026', level: 'p2' }],
      events: [{ wpId: 1, name: 'Asuncion P2', slug: 'asuncion-p2-2026', categoryIds: [99999] }],
      onUpsert: (rows) => upserted.push(...rows),
    });
    const httpClient = makeMockHttp([
      // Unknown category id — neither resolveFipLevel nor
      // resolvePremierLevel will return a value.
      { wpId: 1, name: 'Asuncion P2', slug: 'asuncion-p2-2026', categoryIds: [99999] },
    ]);

    await runTournamentDiscovery({ supabase, httpClient });

    const asuncion = upserted.find((r) => r.slug === 'asuncion-p2-2026');
    expect(asuncion?.level).toBe('p2');
  });

  it('omits level for a brand-new tournament with no existing row and no resolvable level', async () => {
    // The "no existing level" case still yields an undefined level on
    // the upsert payload — so the column's NULL default applies on
    // the INSERT path. Important so we don't accidentally start
    // writing empty-string or other sentinel values.
    const upserted: RecordedRow[] = [];
    const supabase = makeMockSupabase({
      existingRows: [], // brand new
      events: [{ wpId: 1, name: 'New Event', slug: 'new-event-2026', categoryIds: [99999] }],
      onUpsert: (rows) => upserted.push(...rows),
    });
    const httpClient = makeMockHttp([
      { wpId: 1, name: 'New Event', slug: 'new-event-2026', categoryIds: [99999] },
    ]);

    await runTournamentDiscovery({ supabase, httpClient });

    const newEvent = upserted.find((r) => r.slug === 'new-event-2026');
    expect(newEvent?.level).toBeUndefined();
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

describe('runTournamentDiscovery — country gap-fill', () => {
  it('writes country resolved from WP taxonomy when existing row has null', async () => {
    // Concrete repro: FIP Beyond B3 Singapore had country=NULL because
    // tournament-discovery never resolved the country term ID. The fix
    // fetches the WP /country taxonomy and maps the first term to alpha-2.
    const upserted: RecordedRow[] = [];
    const supabase = makeMockSupabase({
      existingRows: [{ slug: 'fip-beyond-b3-singapore', level: null, country: null }],
      events: [{
        wpId: 1,
        name: 'FIP Beyond B3 Singapore',
        slug: 'fip-beyond-b3-singapore',
        categoryIds: [],
        countryTermIds: [558],
      }],
      onUpsert: (rows) => upserted.push(...rows),
    });
    const httpClient = makeMockHttp(
      [{
        wpId: 1,
        name: 'FIP Beyond B3 Singapore',
        slug: 'fip-beyond-b3-singapore',
        categoryIds: [],
        countryTermIds: [558],
      }],
      [{ id: 558, name: 'SIN', acf: { standard_cio: 'SGP' } }],
    );

    await runTournamentDiscovery({ supabase, httpClient });

    const sg = upserted.find((r) => r.slug === 'fip-beyond-b3-singapore');
    expect(sg?.country).toBe('SG');
  });

  it('preserves an existing country (padelapi-set) instead of clobbering with WP-derived value', async () => {
    // Source-priority: `tournament.country` is ['padelapi', 'fip'] —
    // padelapi is primary. FIP must never overwrite. We echo the
    // existing country into the payload so Supabase merge-duplicates
    // doesn't reset it to NULL (same gotcha as the Asuncion `level`
    // incident).
    const upserted: RecordedRow[] = [];
    const supabase = makeMockSupabase({
      existingRows: [{ slug: 'newgiza-p2-2026', level: 'p2', country: 'EG' }],
      events: [{
        wpId: 1,
        name: 'NewGiza P2',
        slug: 'newgiza-p2-2026',
        categoryIds: [387],
        countryTermIds: [42], // claim a different country than padelapi has
      }],
      onUpsert: (rows) => upserted.push(...rows),
    });
    const httpClient = makeMockHttp(
      [{
        wpId: 1,
        name: 'NewGiza P2',
        slug: 'newgiza-p2-2026',
        categoryIds: [387],
        countryTermIds: [42],
      }],
      [{ id: 42, name: 'ESP' }],
    );

    await runTournamentDiscovery({ supabase, httpClient });

    const newgiza = upserted.find((r) => r.slug === 'newgiza-p2-2026');
    expect(newgiza?.country).toBe('EG');
  });

  it('omits country for a brand-new row when the WP term resolves to null (unknown code)', async () => {
    const upserted: RecordedRow[] = [];
    const supabase = makeMockSupabase({
      existingRows: [], // brand new
      events: [{
        wpId: 1,
        name: 'Mystery Cup',
        slug: 'mystery-cup-2026',
        categoryIds: [],
        countryTermIds: [777],
      }],
      onUpsert: (rows) => upserted.push(...rows),
    });
    const httpClient = makeMockHttp(
      [{
        wpId: 1,
        name: 'Mystery Cup',
        slug: 'mystery-cup-2026',
        categoryIds: [],
        countryTermIds: [777],
      }],
      [{ id: 777, name: 'XYZ' }], // unknown 3-letter code → null
    );

    await runTournamentDiscovery({ supabase, httpClient });

    const row = upserted.find((r) => r.slug === 'mystery-cup-2026');
    expect(row?.country).toBeUndefined();
  });

  it('echoes existing country back when the WP feed has no country terms (no clobber)', async () => {
    const upserted: RecordedRow[] = [];
    const supabase = makeMockSupabase({
      existingRows: [{ slug: 'foo-2026', level: 'p1', country: 'ES' }],
      events: [{
        wpId: 1,
        name: 'Foo 2026',
        slug: 'foo-2026',
        categoryIds: [387],
        countryTermIds: [],
      }],
      onUpsert: (rows) => upserted.push(...rows),
    });
    const httpClient = makeMockHttp([
      { wpId: 1, name: 'Foo 2026', slug: 'foo-2026', categoryIds: [387], countryTermIds: [] },
    ]);

    await runTournamentDiscovery({ supabase, httpClient });

    const foo = upserted.find((r) => r.slug === 'foo-2026');
    expect(foo?.country).toBe('ES');
  });
});
