import { describe, it, expect } from 'vitest';
import { parseFipWpCountries } from '../../parsers/fip-wp-countries.js';

describe('parseFipWpCountries', () => {
  it('maps term IDs to alpha-2 codes from acf.standard_cio when present', () => {
    // Singapore on padelfip.com uses the non-standard `name: "SIN"` but
    // the proper ISO alpha-3 lives on `acf.standard_cio: "SGP"`. Prefer
    // the latter so we match on the canonical mapping table.
    const map = parseFipWpCountries([
      { id: 558, name: 'SIN', acf: { standard_cio: 'SGP' } },
    ]);
    expect(map.get(558)).toBe('SG');
  });

  it('falls back to `name` when acf.standard_cio is missing or empty', () => {
    const map = parseFipWpCountries([
      { id: 33, name: 'ESP', acf: { standard_cio: '' } },
      { id: 34, name: 'BRA' },
    ]);
    expect(map.get(33)).toBe('ES');
    expect(map.get(34)).toBe('BR');
  });

  it('returns null entry for unknown 3-letter codes (signal — not a hard error)', () => {
    const map = parseFipWpCountries([
      { id: 999, name: 'XYZ' },
    ]);
    expect(map.has(999)).toBe(true);
    expect(map.get(999)).toBeNull();
  });

  it('skips entries without a numeric id', () => {
    const map = parseFipWpCountries([
      { id: 'not-a-number' as unknown as number, name: 'ESP' },
    ]);
    expect(map.size).toBe(0);
  });

  it('returns an empty map for non-array input', () => {
    expect(parseFipWpCountries(null as never).size).toBe(0);
    expect(parseFipWpCountries(undefined as never).size).toBe(0);
  });
});
