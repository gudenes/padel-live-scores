import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ops-auth', () => ({ checkOpsAuth: vi.fn(async () => null) }));

const playerInserts: any[] = [];
const aliasUpserts: any[] = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'players') {
        return {
          insert: (row: any) => ({
            select: () => ({
              single: () => {
                const id = 'new-' + (playerInserts.length + 1);
                playerInserts.push({ id, ...row });
                return Promise.resolve({ data: { id }, error: null });
              },
            }),
          }),
        };
      }
      if (table === 'entity_external_ids') {
        return {
          upsert: (row: any, opts: any) => {
            aliasUpserts.push({ row, opts });
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error('unexpected table ' + table);
    },
  }),
}));

import { POST } from '../route';

beforeEach(() => { playerInserts.length = 0; aliasUpserts.length = 0; });

describe('POST /api/ops/players', () => {
  it('rejects missing name with 400', async () => {
    const res = await POST(new Request('http://x/', { method: 'POST', body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
  it('creates a player row and auto-aliases the source name', async () => {
    const res = await POST(new Request('http://x/', {
      method: 'POST',
      body: JSON.stringify({ name: 'Martin Muedini', country: 'AL', category: 'men', sourceName: 'Martin Muedini' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('new-1');
    expect(playerInserts[0].name).toBe('Martin Muedini');
    expect(playerInserts[0].country).toBe('AL');
    expect(playerInserts[0].category).toBe('men');
    expect(aliasUpserts).toHaveLength(1);
    expect(aliasUpserts[0].row.external_id).toBe('Martin Muedini');
  });
});
