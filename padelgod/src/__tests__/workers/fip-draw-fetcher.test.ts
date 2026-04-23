import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFipDrawFetcher } from '../../workers/fip-draw-fetcher.js';

const FIXTURE_DIR = join(__dirname, '../fixtures/fip-draw');

// Build a minimal Supabase fake that exercises the insert path of the
// worker without hitting a real DB. Mirrors the pattern used by
// `draw-fetcher.test.ts` but tracks insertions by table so the worker
// test can assert on exactly which draw_snapshots rows were appended.
function fakeSupabase(opts: { activeTournaments: any[] }) {
  const insertedDrawSnapshots: any[] = [];
  const insertedScrapeJobs: any[] = [];

  const supabase = {
    insertedDrawSnapshots,
    insertedScrapeJobs,
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
});
