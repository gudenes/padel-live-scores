import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runOopFetcher } from '../../workers/oop-fetcher.js';

const BRUSSELS_OOP_HTML = readFileSync(
  join(__dirname, '../fixtures/crionet-oop-brussels.html'),
  'utf8',
);

function fakeSupabase(
  activeTournaments: any[],
  opts: { scrapeJobLookupData?: { id: string } | null } = {},
) {
  const inserted: any[] = [];
  const lookupData =
    opts.scrapeJobLookupData === undefined ? { id: 'job-uuid' } : opts.scrapeJobLookupData;
  return {
    inserted,
    schema: () => ({
      from: (t: string) => {
        if (t === 'oop_snapshots') {
          return {
            insert: (rows: any) => {
              const arr = Array.isArray(rows) ? rows : [rows];
              inserted.push(...arr);
              return { data: arr, error: null };
            },
          };
        }
        if (t === 'scrape_jobs') {
          return {
            insert: (row: any) => ({
              select: () => ({
                single: async () => ({ data: { id: 'job-uuid', ...row }, error: null }),
              }),
            }),
            update: (data: any) => ({ eq: () => ({ data: null, error: null }) }),
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: lookupData, error: null }),
                    }),
                  }),
                }),
              }),
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
          insert: () => ({ data: null, error: { message: 'unexpected table' } }),
        };
      },
    }),
    from: (t: string) => {
      if (t === 'tournament_courts') {
        return { upsert: async () => ({ error: null }) };
      }
      if (t === 'matches') {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (t === 'entity_external_ids') {
        return { upsert: async () => ({ error: null }) };
      }
      return { upsert: async () => ({ error: null }) };
    },
    rpc: vi.fn(async () => ({ data: activeTournaments, error: null })),
  };
}

describe('runOopFetcher', () => {
  it('returns 0 processed when no active tournaments', async () => {
    const supabase = fakeSupabase([]);
    const httpClient = { get: vi.fn() };

    const result = await runOopFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(0);
  });

  it('iterates expected_days and stops on consecutive empty days', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 't1', tournament_name: 'X', widget_id: 'FIP-2026-1701', starts_at: null, ends_at: null, expected_days: 4 },
    ]);
    const httpClient = {
      get: vi.fn(async () => ({ data: '<h4 class="message">No schedule available</h4>' })),
    };

    const result = await runOopFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.totalMatchesInserted).toBe(0);
  });

  it('inserts snapshots using runScrapeJob id when scrape_jobs re-lookup returns null', async () => {
    // Production incident: scrape_jobs (tournament_id, target_url) lookup
    // times out after the job row is already written. The fetcher used to
    // swallow that and skip oop_snapshots insert even though parse succeeded.
    const supabase = fakeSupabase(
      [
        {
          tournament_id: 't1',
          tournament_name: 'X',
          widget_id: 'FIP-2026-1701',
          starts_at: null,
          ends_at: null,
          expected_days: 1,
        },
      ],
      { scrapeJobLookupData: null },
    );
    const httpClient = {
      get: vi.fn(async (url: string) => {
        if (String(url).includes('/1?')) return { data: BRUSSELS_OOP_HTML };
        return { data: '<h4 class="message">No schedule available</h4>' };
      }),
    };

    const result = await runOopFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.totalMatchesInserted).toBeGreaterThan(0);
    expect(supabase.inserted.every((r) => r.scrape_job_id === 'job-uuid')).toBe(true);
    expect(supabase.inserted.some((r) => r.match_widget_id === 'MQ007')).toBe(true);
  });
});
