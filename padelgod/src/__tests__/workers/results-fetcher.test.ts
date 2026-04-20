import { describe, it, expect, vi } from 'vitest';
import { runResultsFetcher } from '../../workers/results-fetcher.js';

function fakeSupabase(activeTournaments: any[]) {
  const inserted: any[] = [];
  return {
    inserted,
    schema: () => ({
      from: (t: string) => ({
        insert: (rows: any) => {
          if (t === 'results_snapshots') {
            const arr = Array.isArray(rows) ? rows : [rows];
            inserted.push(...arr);
            return {
              data: arr,
              error: null,
              select: () => ({ single: async () => ({ data: arr[0], error: null }) }),
            };
          }
          if (t === 'scrape_jobs') {
            return {
              data: [{ id: 'job-uuid' }],
              error: null,
              select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
            };
          }
          if (t === 'raw_payloads') {
            return {
              data: [],
              error: null,
              select: () => ({ single: async () => ({ data: {}, error: null }) }),
            };
          }
          return {
            data: null,
            error: { message: 'unexpected' },
            select: () => ({ single: async () => ({ data: null, error: null }) }),
          };
        },
        update: () => ({ eq: () => ({ data: null, error: null }) }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({ maybeSingle: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
              }),
            }),
          }),
        }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: activeTournaments, error: null })),
  };
}

describe('runResultsFetcher', () => {
  it('returns 0 processed when no active tournaments', async () => {
    const supabase = fakeSupabase([]);
    const httpClient = { get: vi.fn() };
    const result = await runResultsFetcher({ supabase: supabase as any, httpClient: httpClient as any });
    expect(result.tournamentsProcessed).toBe(0);
  });

  it('iterates days and stops on consecutive empty', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 't1', tournament_name: 'X', widget_id: 'FIP-2026-1701', starts_at: null, ends_at: null, expected_days: 4 },
    ]);
    const httpClient = {
      get: vi.fn(async () => ({ data: '<h4 class="message">No results found</h4>' })),
    };
    const result = await runResultsFetcher({ supabase: supabase as any, httpClient: httpClient as any });
    expect(result.tournamentsProcessed).toBe(1);
    expect(result.totalMatchesInserted).toBe(0);
  });
});
