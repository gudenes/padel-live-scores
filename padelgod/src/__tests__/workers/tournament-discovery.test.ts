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
      select: (cols: string) => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({
              data: maxModified ? { updated_at: maxModified } : null,
              error: null,
            }),
          }),
        }),
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
  it('upserts events returned by the WP API', async () => {
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
    });
  });

  it('returns 0 discovered when WP returns empty', async () => {
    const supabase = fakeSupabase('2026-04-19T00:00:00');
    const httpClient = fakeHttp([]);

    const result = await runTournamentDiscovery({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.discovered).toBe(0);
    expect(supabase.upserted).toHaveLength(0);
  });
});
