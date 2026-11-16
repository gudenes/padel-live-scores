import { describe, it, expect, vi } from 'vitest';
import { searchFipPlayer } from '../lib/fip-player-search.js';

const coello = { player_id: 'P000010', name: 'Arturo', surname: 'Coello', nationality: 'ESP', gender: 'male', rank: 1, points: 20283, url: 'https://www.padelfip.com/player/arturo-coello/', thumbnail: '', country_flag: '' };

describe('FIP player lookup query-form REST route', () => {
  it('preserves the full query and resolves the matching player', async () => {
    const get = vi.fn(async () => ({ data: [coello] }));
    const result = await searchFipPlayer({ get } as any, { name: 'Arturo Coello', country: 'ES', category: 'men' });
    const url = new URL((get.mock.calls as unknown as string[][])[0][0]);
    expect(url.origin + url.pathname).toBe('https://www.padelfip.com/');
    expect(url.searchParams.get('rest_route')).toBe('/fip/v1/player/search');
    expect(url.searchParams.get('q')).toBe('Arturo Coello');
    expect(result?.playerId).toBe('P000010');
  });

  it('encodes punctuation without creating extra query parameters', async () => {
    const get = vi.fn(async () => ({ data: [] }));
    await searchFipPlayer({ get } as any, { name: 'José & Martín' });
    const url = new URL((get.mock.calls as unknown as string[][])[0][0]);
    expect(url.searchParams.get('q')).toBe('José & Martín');
    expect([...url.searchParams.keys()]).toEqual(['rest_route', 'q']);
  });

  it('still rejects a different player with the same surname', async () => {
    const get = vi.fn(async () => ({ data: [coello] }));
    expect(await searchFipPlayer({ get } as any, { name: 'Diego Coello', country: 'ES', category: 'men' })).toBeNull();
  });
});
