import { describe, it, expect, vi } from 'vitest';
import { runOopFetcher } from '../../workers/oop-fetcher.js';

function fakeSupabase(activeTournaments: any[]) {
  const inserted: any[] = [];
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
                      maybeSingle: async () => ({ data: { id: 'job-uuid' }, error: null }),
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
});
