import { describe, it, expect, vi } from 'vitest';
import {
  discoverWebtugaTournaments,
  loadMatchCache,
  cacheExternalId,
} from '../../lib/webtuga-cache.js';

function selectChain(rows: any[]) {
  // builds a thenable query chain where every filter returns `this`
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };
  return chain;
}

/** A supabase mock that returns different rows per table. */
function tableMock(byTable: Record<string, any[]>) {
  return {
    from: vi.fn((table: string) => {
      if (!(table in byTable)) throw new Error(`unexpected table ${table}`);
      return selectChain(byTable[table]);
    }),
  } as any;
}

describe('webtuga-cache', () => {
  it('cacheExternalId composes tournament + webtuga id', () => {
    expect(cacheExternalId('t-uuid', 2)).toBe('t-uuid:2');
  });

  it('discoverWebtugaTournaments returns tournaments inside their active window', async () => {
    const supabase = tableMock({
      entity_external_ids: [{ entity_id: 't1', external_id: 'https://a.win.webtuga.net' }],
      tournaments: [{ id: 't1', ends_at: null }], // null end → kept
    });
    const out = await discoverWebtugaTournaments(supabase);
    expect(out).toEqual([{ tournamentId: 't1', baseUrl: 'https://a.win.webtuga.net' }]);
  });

  it('discoverWebtugaTournaments drops tournaments past their active window', async () => {
    const supabase = tableMock({
      entity_external_ids: [{ entity_id: 't1', external_id: 'https://a.win.webtuga.net' }],
      tournaments: [{ id: 't1', ends_at: '2020-01-01T00:00:00Z' }], // long finished
    });
    const out = await discoverWebtugaTournaments(supabase);
    expect(out).toEqual([]);
  });

  it('loadMatchCache keys rows by webtuga id from the composite external_id', async () => {
    const supabase: any = {
      from: vi.fn(() => selectChain([
        { external_id: 't1:2', entity_id: 'm2', metadata: { orientation: 'AB', lastState: { matchId: 'm2' } } },
      ])),
    };
    const map = await loadMatchCache(supabase, 't1');
    expect(map.get(2)?.matchId).toBe('m2');
    expect(map.get(2)?.orientation).toBe('AB');
    expect(map.get(2)?.lastState?.matchId).toBe('m2');
  });
});
