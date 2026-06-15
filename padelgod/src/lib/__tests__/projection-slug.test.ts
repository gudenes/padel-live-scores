import { describe, it, expect } from 'vitest';
import { pairSlugFromNames } from '../projection-slug.js';

describe('pairSlugFromNames (padelgod mirror)', () => {
  it('joins surnames, id-sorted, diacritics stripped', () => {
    // ordered by id: a (Tapia) then b (Coello)
    expect(pairSlugFromNames([{ id: 'b', name: 'Arturo Coello' }, { id: 'a', name: 'Agustín Tapia' }]))
      .toBe('tapia-coello');
  });
  it('is order-independent (sorts by id)', () => {
    const s1 = pairSlugFromNames([{ id: 'a', name: 'Agustín Tapia' }, { id: 'b', name: 'Arturo Coello' }]);
    const s2 = pairSlugFromNames([{ id: 'b', name: 'Arturo Coello' }, { id: 'a', name: 'Agustín Tapia' }]);
    expect(s1).toBe(s2);
  });
  it('matches the Next app fixtures exactly (parity)', () => {
    expect(pairSlugFromNames([{ id: 'a', name: 'Juan Lebron' }, { id: 'b', name: 'Ale Galan' }])).toBe('lebron-galan');
    expect(pairSlugFromNames([{ id: 'a', name: 'Paula Josemaría' }, { id: 'b', name: 'Ari Sánchez' }])).toBe('josemaria-sanchez');
  });
});
