import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  runFipDrawFetcher,
  __resetFipDrawFetcherCaches,
} from '../../workers/fip-draw-fetcher.js';

const FIXTURE_DIR = join(__dirname, '../fixtures/fip-draw');

// Build a minimal Supabase fake that exercises the insert path of the
// worker without hitting a real DB. Mirrors the pattern used by
// `draw-fetcher.test.ts` but tracks insertions by table so the worker
// test can assert on exactly which draw_snapshots rows were appended.
//
// `storedPostIds` seeds the entity_external_ids sidecar so the postID-reuse
// path can be exercised: a map of tournament_id → stored fip_post_id.
function fakeSupabase(opts: {
  activeTournaments: any[];
  storedPostIds?: Record<string, string>;
}) {
  const insertedDrawSnapshots: any[] = [];
  const insertedScrapeJobs: any[] = [];
  const postIdUpserts: any[] = [];
  const storedPostIds: Record<string, string> = { ...(opts.storedPostIds ?? {}) };

  const supabase = {
    insertedDrawSnapshots,
    insertedScrapeJobs,
    postIdUpserts,
    storedPostIds,
    // entity_external_ids lives on the non-schema (public) accessor.
    from: (t: string) => {
      if (t === 'entity_external_ids') {
        return {
          select: () => ({
            eq: (_c1: string, _v1: string) => ({
              eq: (_c2: string, entityId: string) => ({
                eq: (_c3: string, _v3: string) => ({
                  maybeSingle: async () => {
                    const external = storedPostIds[entityId];
                    return external
                      ? { data: { external_id: external }, error: null }
                      : { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
          upsert: (rows: any) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            for (const r of arr) {
              postIdUpserts.push(r);
              storedPostIds[r.entity_id] = r.external_id;
            }
            return Promise.resolve({ data: arr, error: null });
          },
        };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      };
    },
    schema: () => ({
      from: (t: string) => {
        if (t === 'draw_snapshots') {
          return {
            insert: (rows: any) => {
              const arr = Array.isArray(rows) ? rows : [rows];
              insertedDrawSnapshots.push(...arr);
              return { data: arr, error: null };
            },
          };
        }
        if (t === 'scrape_jobs') {
          return {
            insert: (row: any) => ({
              select: () => ({
                single: async () => {
                  insertedScrapeJobs.push(row);
                  return { data: { id: `job-${insertedScrapeJobs.length}`, ...row }, error: null };
                },
              }),
            }),
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { id: `job-${insertedScrapeJobs.length}` },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          };
        }
        if (t === 'raw_payloads') {
          return {
            insert: (row: any) => ({
              select: () => ({
                single: async () => ({ data: { id: 'payload-uuid', ...row }, error: null }),
              }),
            }),
          };
        }
        return {
          insert: () => ({ data: null, error: { message: `unexpected table: ${t}` } }),
        };
      },
    }),
    rpc: vi.fn(async () => ({ data: opts.activeTournaments, error: null })),
  };
  return supabase;
}

/**
 * Build an axios-like fake that returns canned responses per URL.
 *   - GET https://.../events/brussels-p2-2026/?tab=Cuadros → event-page HTML
 *   - POST https://.../admin-ajax.php (with drawType=MD) → MD JSON fixture
 *   - POST https://.../admin-ajax.php (with drawType=WD) → WD JSON fixture
 *   - POST https://.../admin-ajax.php (with drawType=MQ) → MQ JSON fixture
 *   - POST https://.../admin-ajax.php (with drawType=WQ) → WQ JSON fixture
 */
function fakeHttpClient() {
  const eventPageHtml = readFileSync(join(FIXTURE_DIR, 'brussels-event-page.html'), 'utf-8');
  const fixtures: Record<string, any> = {
    MD: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-MD.json'), 'utf-8')),
    WD: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-WD.json'), 'utf-8')),
    MQ: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-MQ.json'), 'utf-8')),
    WQ: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-WQ.json'), 'utf-8')),
  };
  return {
    calls: [] as Array<{ method: 'get' | 'post'; url: string; body?: string }>,
    get: vi.fn(async function (this: any, url: string) {
      this.calls.push({ method: 'get', url });
      return { data: eventPageHtml };
    }),
    post: vi.fn(async function (this: any, url: string, body: string) {
      this.calls.push({ method: 'post', url, body });
      // Parse form body to get drawType
      const params = new URLSearchParams(body);
      const drawType = (params.get('drawType') ?? '') as keyof typeof fixtures;
      if (!(drawType in fixtures)) {
        return { data: { error: 400, html: '', drawType, pdf: null } };
      }
      return { data: fixtures[drawType] };
    }),
  };
}

describe('runFipDrawFetcher', () => {
  beforeEach(() => {
    __resetFipDrawFetcherCaches();
  });

  it('returns zeros when the RPC returns no active tournaments', async () => {
    const supabase = fakeSupabase({ activeTournaments: [] });
    const httpClient = fakeHttpClient();
    const result = await runFipDrawFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });
    expect(result).toEqual({
      tournamentsProcessed: 0,
      tournamentsSkipped: 0,
      tournamentsSkippedFinished: 0,
      totalMatchesInserted: 0,
    });
    // No HTTP calls at all.
    expect(httpClient.calls).toHaveLength(0);
  });

  it('fetches event page + all 4 draws and inserts rows for Brussels', async () => {
    const supabase = fakeSupabase({
      activeTournaments: [
        {
          tournament_id: 'brussels-uuid',
          tournament_name: 'Brussels P2 2026',
          slug: 'brussels-p2-2026',
          starts_at: '2026-04-20T00:00:00Z',
          ends_at: '2026-04-27T00:00:00Z',
        },
      ],
    });
    const httpClient = fakeHttpClient();

    const result = await runFipDrawFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
      // Pin "now" inside the fixture's event window so the finished-tail
      // skip doesn't fire (fixture ends_at is in the past relative to today).
      now: () => Date.parse('2026-04-22T00:00:00Z'),
    });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.tournamentsSkipped).toBe(0);

    // One GET for the event page, four POSTs for MD/WD/MQ/WQ.
    const gets = httpClient.calls.filter((c) => c.method === 'get');
    const posts = httpClient.calls.filter((c) => c.method === 'post');
    expect(gets).toHaveLength(1);
    expect(gets[0]!.url).toContain('/events/brussels-p2-2026/');
    expect(posts).toHaveLength(4);

    // AJAX POSTs use the admin-ajax URL + pass the nonce + postID from the
    // event page. Verify one representative call.
    const mdPost = posts.find((c) => c.body?.includes('drawType=MD'))!;
    expect(mdPost.url).toBe('https://www.padelfip.com/wp-admin/admin-ajax.php');
    const mdParams = new URLSearchParams(mdPost.body);
    expect(mdParams.get('action')).toBe('handle_ajax_request');
    expect(mdParams.get('gender')).toBe('M');
    expect(mdParams.get('postID')).toMatch(/^\d+$/);
    expect(mdParams.get('security')).toMatch(/^[a-f0-9]+$/);

    // Inserted rows: Brussels has 31 MD + 31 WD + 28 MQ + 12 WQ = 102 rows.
    expect(supabase.insertedDrawSnapshots).toHaveLength(102);
    expect(result.totalMatchesInserted).toBe(102);

    // Every row carries source='fip_event_page' and has a match_widget_id.
    for (const row of supabase.insertedDrawSnapshots) {
      expect(row.source).toBe('fip_event_page');
      expect(row.match_widget_id).toMatch(/^(MD|WD|MQ|WQ)\d+$/);
      expect(row.tournament_id).toBe('brussels-uuid');
    }

    // Check category/draw_type split consistency.
    const md = supabase.insertedDrawSnapshots.filter((r) => r.match_widget_id.startsWith('MD'));
    expect(md).toHaveLength(31);
    expect(md[0].category).toBe('men');
    expect(md[0].draw_type).toBe('main_draw');

    const wq = supabase.insertedDrawSnapshots.filter((r) => r.match_widget_id.startsWith('WQ'));
    expect(wq).toHaveLength(12);
    expect(wq[0].category).toBe('women');
    expect(wq[0].draw_type).toBe('qualifying');

    // WQ011 — the currently-unlinked qualifier — must appear with a
    // match_widget_id AND team fip ids. This is the whole point of the
    // new source.
    const wq011 = supabase.insertedDrawSnapshots.find((r) => r.match_widget_id === 'WQ011');
    expect(wq011, 'WQ011 must end up in draw_snapshots').toBeDefined();
    expect(wq011.team1_fip_id).toMatch(/^P\d+$/);
    expect(wq011.team2_fip_id).toMatch(/^P\d+$/);

    // Country codes must be normalized alpha-2 at insert time (NOT raw
    // FIP names like "Spain"). Regression test for the 2026-04-23 dry-run
    // where normalizeCountry was mis-applied, turning every row's country
    // into null and emitting one Railway-classified-as-error log per team.
    const nonNullCountries = supabase.insertedDrawSnapshots
      .flatMap((r) => [r.team1_country, r.team2_country])
      .filter((c) => c !== null);
    expect(nonNullCountries.length).toBeGreaterThan(0);
    for (const c of nonNullCountries) {
      expect(c, `expected alpha-2 but got "${c}"`).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('skips a tournament when the event page has no padelfip_ajax config', async () => {
    const supabase = fakeSupabase({
      activeTournaments: [
        {
          tournament_id: 'bad-uuid',
          tournament_name: 'Ghost Event',
          slug: 'ghost-event',
          starts_at: null,
          ends_at: null,
        },
      ],
    });
    const httpClient = {
      calls: [] as Array<{ method: 'get' | 'post'; url: string; body?: string }>,
      get: vi.fn(async function (this: any, url: string) {
        this.calls.push({ method: 'get', url });
        return { data: '<html><body>event not found</body></html>' };
      }),
      post: vi.fn(),
    };

    const result = await runFipDrawFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.tournamentsProcessed).toBe(0);
    expect(result.tournamentsSkipped).toBe(1);
    expect(result.totalMatchesInserted).toBe(0);
    // Event page fetched once; no AJAX POSTs attempted.
    expect(httpClient.calls).toHaveLength(1);
    expect(httpClient.post).not.toHaveBeenCalled();
    expect(supabase.insertedDrawSnapshots).toHaveLength(0);
  });

  // ── Bandwidth optimization ────────────────────────────────────────────

  it('first-time/cold: fetches event page once, stores postID, POSTs draws', async () => {
    const supabase = fakeSupabase({
      activeTournaments: [
        {
          tournament_id: 'brussels-uuid',
          tournament_name: 'Brussels P2 2026',
          slug: 'brussels-p2-2026',
          starts_at: '2026-04-20T00:00:00Z',
          ends_at: '2026-04-27T00:00:00Z',
        },
      ],
      // No stored postID → cold path.
    });
    const httpClient = fakeHttpClient();

    const result = await runFipDrawFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
      now: () => Date.parse('2026-04-22T00:00:00Z'),
    });

    expect(result.tournamentsProcessed).toBe(1);
    // Event page fetched exactly once.
    const gets = httpClient.calls.filter((c) => c.method === 'get');
    expect(gets).toHaveLength(1);
    // 4 draw POSTs.
    expect(httpClient.calls.filter((c) => c.method === 'post')).toHaveLength(4);

    // postID upserted into entity_external_ids with source='fip_post_id'.
    expect(supabase.postIdUpserts).toHaveLength(1);
    expect(supabase.postIdUpserts[0]).toMatchObject({
      entity_type: 'tournament',
      entity_id: 'brussels-uuid',
      source: 'fip_post_id',
      external_id: '290219',
    });
  });

  it('cache hit: stored postID + fresh cached nonce skips the event-page GET', async () => {
    const tournaments = [
      {
        tournament_id: 'brussels-uuid',
        tournament_name: 'Brussels P2 2026',
        slug: 'brussels-p2-2026',
        starts_at: '2026-04-20T00:00:00Z',
        ends_at: '2026-04-27T00:00:00Z',
      },
    ];
    const now = () => Date.parse('2026-04-22T00:00:00Z');

    // First run warms the cache (cold path fetches the page once).
    const supabase1 = fakeSupabase({ activeTournaments: tournaments });
    const http1 = fakeHttpClient();
    await runFipDrawFetcher({ supabase: supabase1 as any, httpClient: http1 as any, now });
    expect(http1.calls.filter((c) => c.method === 'get')).toHaveLength(1);

    // Second run: postID is now stored AND the module nonce cache is fresh.
    const supabase2 = fakeSupabase({
      activeTournaments: tournaments,
      storedPostIds: { 'brussels-uuid': '290219' },
    });
    const http2 = fakeHttpClient();
    const result = await runFipDrawFetcher({
      supabase: supabase2 as any,
      httpClient: http2 as any,
      now,
    });

    expect(result.tournamentsProcessed).toBe(1);
    // NO event-page GET this run — served from cache.
    expect(http2.calls.filter((c) => c.method === 'get')).toHaveLength(0);
    // Draws still POSTed.
    expect(http2.calls.filter((c) => c.method === 'post')).toHaveLength(4);
    expect(supabase2.insertedDrawSnapshots.length).toBeGreaterThan(0);
  });

  it('finished-tail: skips events ended >24h ago, processes one ending today', async () => {
    const now = () => Date.parse('2026-04-27T12:00:00Z');
    const supabase = fakeSupabase({
      activeTournaments: [
        {
          tournament_id: 'old-uuid',
          tournament_name: 'Finished Long Ago',
          slug: 'finished-long-ago',
          starts_at: '2026-04-17T00:00:00Z',
          ends_at: '2026-04-24T00:00:00Z', // 3+ days before `now`
        },
        {
          tournament_id: 'brussels-uuid',
          tournament_name: 'Brussels P2 2026',
          slug: 'brussels-p2-2026',
          starts_at: '2026-04-20T00:00:00Z',
          ends_at: '2026-04-27T20:00:00Z', // ends today
        },
      ],
    });
    const httpClient = fakeHttpClient();

    const result = await runFipDrawFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
      now,
    });

    expect(result.tournamentsSkippedFinished).toBe(1);
    expect(result.tournamentsProcessed).toBe(1);

    // Only Brussels was fetched — no GET/POST for the finished event.
    for (const c of httpClient.calls) {
      expect(c.url).not.toContain('finished-long-ago');
    }
    expect(httpClient.calls.filter((c) => c.method === 'get')).toHaveLength(1);
  });

  it('onlyTournamentIds bypasses the finished-tail skip (operator refresh)', async () => {
    const now = () => Date.parse('2026-04-27T12:00:00Z');
    const supabase = fakeSupabase({
      activeTournaments: [
        {
          tournament_id: 'old-uuid',
          tournament_name: 'Finished Long Ago',
          slug: 'finished-long-ago',
          starts_at: '2026-04-17T00:00:00Z',
          ends_at: '2026-04-24T00:00:00Z',
        },
      ],
    });
    const httpClient = fakeHttpClient();

    const result = await runFipDrawFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
      now,
      onlyTournamentIds: new Set(['old-uuid']),
    });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.tournamentsSkippedFinished).toBe(0);
    expect(httpClient.calls.filter((c) => c.method === 'get')).toHaveLength(1);
  });

  it('stale-nonce recovery: 403 on POST triggers one event-page refetch + retry', async () => {
    const now = () => Date.parse('2026-04-22T00:00:00Z');

    // Seed a fresh cached nonce + stored postID so the run starts on the
    // cache-hit path (no initial GET). The cached nonce is stale at FIP's
    // side → the first draw POST 403s, forcing a refetch.
    const tournaments = [
      {
        tournament_id: 'brussels-uuid',
        tournament_name: 'Brussels P2 2026',
        slug: 'brussels-p2-2026',
        starts_at: '2026-04-20T00:00:00Z',
        ends_at: '2026-04-27T00:00:00Z',
      },
    ];

    // Warm-up run to populate cachedNonce.
    const warm = fakeSupabase({ activeTournaments: tournaments });
    const warmHttp = fakeHttpClient();
    await runFipDrawFetcher({ supabase: warm as any, httpClient: warmHttp as any, now });

    // Real run: cache hit (no GET), but POSTs 403 until a refetch happens.
    const supabase = fakeSupabase({
      activeTournaments: tournaments,
      storedPostIds: { 'brussels-uuid': '290219' },
    });
    const eventPageHtml = readFileSync(
      join(FIXTURE_DIR, 'brussels-event-page.html'),
      'utf-8'
    );
    const fixtures: Record<string, any> = {
      MD: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-MD.json'), 'utf-8')),
      WD: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-WD.json'), 'utf-8')),
      MQ: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-MQ.json'), 'utf-8')),
      WQ: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-WQ.json'), 'utf-8')),
    };
    let refetched = false;
    const httpClient = {
      calls: [] as Array<{ method: 'get' | 'post'; url: string; body?: string }>,
      get: vi.fn(async function (this: any, url: string) {
        this.calls.push({ method: 'get', url });
        refetched = true;
        return { data: eventPageHtml };
      }),
      post: vi.fn(async function (this: any, url: string, body: string) {
        this.calls.push({ method: 'post', url, body });
        // Before the refetch, every POST 403s (stale nonce). After, serve.
        if (!refetched) {
          const err: any = new Error('Request failed with status code 403');
          err.response = { status: 403 };
          throw err;
        }
        const params = new URLSearchParams(body);
        const drawType = (params.get('drawType') ?? '') as keyof typeof fixtures;
        return { data: fixtures[drawType] ?? { error: 400, html: '' } };
      }),
    };

    const result = await runFipDrawFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
      now,
    });

    // The recovery refetched the event page exactly once.
    expect(httpClient.calls.filter((c) => c.method === 'get')).toHaveLength(1);
    // After recovery, draws landed.
    expect(result.tournamentsProcessed).toBe(1);
    expect(supabase.insertedDrawSnapshots.length).toBeGreaterThan(0);
  });

  it('all-empty draws on the cache path do NOT invalidate the nonce cache', async () => {
    // Regression: an all-empty result (a not-yet-published draw — valid HTTP
    // 200, empty payload.html) must NOT be misread as a stale nonce. If it
    // were, the shared module cache would be nulled and the NEXT tournament
    // in the same run would fall to the cold path (an extra event-page GET).
    const now = () => Date.parse('2026-04-22T00:00:00Z');

    const tournaments = [
      // First: a future/early event whose draws are all empty.
      {
        tournament_id: 'empty-uuid',
        tournament_name: 'Not Yet Published',
        slug: 'not-yet-published',
        starts_at: '2026-04-21T00:00:00Z',
        ends_at: '2026-04-28T00:00:00Z',
      },
      // Second: a normal event that should still hit the fast path.
      {
        tournament_id: 'brussels-uuid',
        tournament_name: 'Brussels P2 2026',
        slug: 'brussels-p2-2026',
        starts_at: '2026-04-20T00:00:00Z',
        ends_at: '2026-04-27T00:00:00Z',
      },
    ];

    // Warm-up run to populate the module nonce cache.
    const warm = fakeSupabase({ activeTournaments: [tournaments[1]] });
    const warmHttp = fakeHttpClient();
    await runFipDrawFetcher({ supabase: warm as any, httpClient: warmHttp as any, now });

    // Both tournaments have stored postIDs → both start on the fast path.
    const supabase = fakeSupabase({
      activeTournaments: tournaments,
      storedPostIds: { 'empty-uuid': '111111', 'brussels-uuid': '290219' },
    });
    const fixtures: Record<string, any> = {
      MD: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-MD.json'), 'utf-8')),
      WD: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-WD.json'), 'utf-8')),
      MQ: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-MQ.json'), 'utf-8')),
      WQ: JSON.parse(readFileSync(join(FIXTURE_DIR, 'fip-draw-WQ.json'), 'utf-8')),
    };
    const httpClient = {
      calls: [] as Array<{ method: 'get' | 'post'; url: string; body?: string }>,
      get: vi.fn(async function (this: any, url: string) {
        this.calls.push({ method: 'get', url });
        return { data: readFileSync(join(FIXTURE_DIR, 'brussels-event-page.html'), 'utf-8') };
      }),
      post: vi.fn(async function (this: any, url: string, body: string) {
        this.calls.push({ method: 'post', url, body });
        const params = new URLSearchParams(body);
        // The empty event returns valid-but-empty payloads (no html) for all
        // four codes. Brussels serves real draws.
        if (params.get('postID') === '111111') {
          return { data: { success: true, data: { html: '' } } };
        }
        const drawType = (params.get('drawType') ?? '') as keyof typeof fixtures;
        return { data: fixtures[drawType] ?? { error: 400, html: '' } };
      }),
    };

    const result = await runFipDrawFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
      now,
    });

    // Neither tournament needed an event-page GET — the cache stayed valid
    // through the all-empty event.
    expect(httpClient.calls.filter((c) => c.method === 'get')).toHaveLength(0);
    // Both processed; Brussels still inserted its draws via the fast path.
    expect(result.tournamentsProcessed).toBe(2);
    expect(supabase.insertedDrawSnapshots.length).toBeGreaterThan(0);
  });
});
