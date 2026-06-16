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
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };
  return chain;
}

describe('webtuga-cache', () => {
  it('cacheExternalId composes tournament + webtuga id', () => {
    expect(cacheExternalId('t-uuid', 2)).toBe('t-uuid:2');
  });

  it('discoverWebtugaTournaments maps base-url rows', async () => {
    const supabase: any = {
      from: vi.fn(() => selectChain([
        { entity_id: 't1', external_id: 'https://a.win.webtuga.net' },
      ])),
    };
    const out = await discoverWebtugaTournaments(supabase);
    expect(out).toEqual([{ tournamentId: 't1', baseUrl: 'https://a.win.webtuga.net' }]);
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
