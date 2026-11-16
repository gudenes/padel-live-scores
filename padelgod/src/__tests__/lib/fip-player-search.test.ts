import { describe, it, expect, vi } from 'vitest';
import { searchFipPlayer } from '../../lib/fip-player-search.js';

describe('rate limiting', () => {
  it('does not try surname variants after a rate-limited response', async () => {
    const get = vi.fn().mockRejectedValue({ response: { status: 429 } });
    expect(await searchFipPlayer({ get } as any, { name: 'Claudia Jensen', category: 'women' })).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
