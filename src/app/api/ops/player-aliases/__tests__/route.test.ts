import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ops-auth', () => ({ checkOpsAuth: vi.fn(async () => null) }));

const upserts: any[] = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      upsert: (row: any, opts: any) => {
        upserts.push({ row, opts });
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'a1' }, error: null }) }) };
      },
    }),
  }),
}));

import { POST } from '../route';

beforeEach(() => { upserts.length = 0; });

describe('POST /api/ops/player-aliases', () => {
  it('rejects missing fields with 400', async () => {
    const res = await POST(new Request('http://x/', { method: 'POST', body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
  it('upserts an alias row and returns ok', async () => {
    const res = await POST(new Request('http://x/', {
      method: 'POST',
      body: JSON.stringify({ playerId: 'u-ruiz', alias: 'Alejandro Ruiz Granados' }),
    }));
    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].row.external_id).toBe('Alejandro Ruiz Granados');
    expect(upserts[0].row.metadata.normalized).toBe('alejandro ruiz granados');
  });
});
