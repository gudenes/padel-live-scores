import { describe, it, expect, vi } from 'vitest';
import { runEntryListFetcher } from '../../workers/entry-list-fetcher.js';

function fakeSupabase(activeTournaments: any[]) {
  const inserted: any[] = [];
  return {
    inserted,
    schema: () => ({
      from: (t: string) => {
        if (t === 'entry_list_snapshots') {
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
    rpc: vi.fn(async (_name: string) => ({ data: activeTournaments, error: null })),
  };
}

const fakeRow = (fipId: string, name: string) => `
  <div class="entry-list-row" data-fip-id="${fipId}">
    <div class="player-name">${name}</div>
    <div class="player-country"><img src="/flags/ESP.jpg" alt="ESP"/></div>
  </div>
`;

describe('runEntryListFetcher', () => {
  it('fetches both categories for one tournament and inserts snapshots', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 'tour-1', tournament_name: 'X', widget_id: 'FIP-2026-1701', starts_at: null, ends_at: null, expected_days: 7 },
    ]);
    const httpClient = {
      get: vi.fn()
        .mockResolvedValueOnce({ data: `<div class="entry-list">${fakeRow('P1', 'COELLO, Arturo')}</div>` })
        .mockResolvedValueOnce({ data: `<div class="entry-list">${fakeRow('P9', 'SANCHEZ, Bea')}</div>` }),
    };

    const result = await runEntryListFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.totalPlayersInserted).toBe(2);
    expect(supabase.inserted).toHaveLength(2);
    expect(supabase.inserted[0].category).toBe('men');
    expect(supabase.inserted[1].category).toBe('women');
  });

  it('returns 0 processed when no active tournaments', async () => {
    const supabase = fakeSupabase([]);
    const httpClient = { get: vi.fn() };

    const result = await runEntryListFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(0);
    expect(httpClient.get).not.toHaveBeenCalled();
  });
});
