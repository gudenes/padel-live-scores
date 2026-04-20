import { describe, it, expect, vi } from 'vitest';
import { runDrawFetcher } from '../../workers/draw-fetcher.js';

function fakeSupabase(activeTournaments: any[]) {
  const inserted: any[] = [];
  return {
    inserted,
    schema: () => ({
      from: (t: string) => {
        if (t === 'draw_snapshots') {
          return {
            insert: (rows: any) => ({
              data: (Array.isArray(rows) ? rows : [rows]).map((r: any) => ({ ...r })),
              error: null,
            }),
          };
        }
        if (t === 'scrape_jobs') {
          return {
            insert: (row: any) => ({
              select: () => ({
                single: async () => ({ data: { id: 'job-uuid', ...row }, error: null }),
              }),
            }),
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
          insert: () => ({ data: null, error: { message: 'unexpected table' } }),
        };
      },
    }),
    rpc: vi.fn(async () => ({ data: activeTournaments, error: null })),
  };
}

describe('runDrawFetcher', () => {
  it('returns 0 processed when no active tournaments', async () => {
    const supabase = fakeSupabase([]);
    const httpClient = { get: vi.fn() };

    const result = await runDrawFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(0);
  });

  it('skips draw types when widget says "Draw not available"', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 't1', tournament_name: 'X', widget_id: 'FIP-2026-1701', starts_at: null, ends_at: null, expected_days: 7 },
    ]);
    const httpClient = {
      get: vi.fn(async () => ({ data: '<div class="message">Draw not available</div>' })),
    };

    const result = await runDrawFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.totalMatchesInserted).toBe(0);
  });
});
