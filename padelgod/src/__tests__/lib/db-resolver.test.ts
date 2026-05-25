import { describe, it, expect } from 'vitest';
import { normalizeName } from '../../lib/db-resolver.js';

describe('normalizeName', () => {
  it('lowercases, strips accents, collapses punctuation', () => {
    expect(normalizeName('Álvaro Mélendez Amaya')).toBe('alvaro melendez amaya');
    expect(normalizeName('Aimar Goñi-Lacabe')).toBe('aimar goni lacabe');
    expect(normalizeName('  Multi   spaces  ')).toBe('multi spaces');
  });
});
