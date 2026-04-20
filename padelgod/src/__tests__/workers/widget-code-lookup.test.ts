import { describe, it, expect, vi } from 'vitest';
import { runWidgetCodeLookup } from '../../workers/widget-code-lookup.js';

function fakeSupabase(needingResolution: any[]) {
  const inserted: any[] = [];
  return {
    inserted,
    schema: (_s: string) => ({
      from: (t: string) => ({
        insert: (row: any) => {
          if (t === 'widget_id_cache') {
            inserted.push(row);
            return Promise.resolve({ data: row, error: null });
          }
          if (t === 'scrape_jobs') {
            const jobRow = { id: 'job-uuid', ...row };
            return {
              select: () => ({
                single: async () => ({ data: jobRow, error: null }),
              }),
            };
          }
          if (t === 'raw_payloads') {
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            };
          }
          return Promise.resolve({ data: null, error: { message: 'unexpected' } });
        },
        update: () => ({
          eq: async () => ({ data: null, error: null }),
        }),
        select: () => ({
          single: async () => ({ data: {}, error: null }),
        }),
      }),
    }),
    rpc: vi.fn(async (_name: string) => ({ data: needingResolution, error: null })),
  };
}

describe('runWidgetCodeLookup', () => {
  it('writes widget_id_cache row when search returns exactly one match', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 'tour-uuid-1', tournament_name: 'Brussels P2', year: 2026 },
    ]);
    const httpClient = {
      post: vi.fn(async () => ({
        data: `<div class="card tournament-card">
          <div class="card-header tournament-card-header tournament-card-header-live">
            <div class="tournament-name">BRUSSELS P2</div>
            <span class="tournament-code">1701</span>
          </div>
        </div>`,
      })),
    };

    const result = await runWidgetCodeLookup({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.resolved).toBe(1);
    expect(supabase.inserted[0]).toMatchObject({
      tournament_id: 'tour-uuid-1',
      widget_id: 'FIP-2026-1701',
      extraction_method: 'search',
    });
  });

  it('skips and logs when search returns zero matches', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 'tour-uuid-2', tournament_name: 'Unknown Event', year: 2026 },
    ]);
    const httpClient = {
      post: vi.fn(async () => ({
        data: '<div class="text-center text-light">No tournaments found</div>',
      })),
    };

    const result = await runWidgetCodeLookup({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.resolved).toBe(0);
    expect(result.skipped).toBe(1);
    expect(supabase.inserted).toHaveLength(0);
  });
});
