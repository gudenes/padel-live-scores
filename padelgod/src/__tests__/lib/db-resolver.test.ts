import { describe, it, expect } from 'vitest';
import { normalizeName } from '../../lib/db-resolver.js';
import { subsetSimilarity, typoTolerantSimilarity } from '../../lib/db-resolver.js';

describe('normalizeName', () => {
  it('lowercases, strips accents, collapses punctuation', () => {
    expect(normalizeName('Álvaro Mélendez Amaya')).toBe('alvaro melendez amaya');
    expect(normalizeName('Aimar Goñi-Lacabe')).toBe('aimar goni lacabe');
    expect(normalizeName('  Multi   spaces  ')).toBe('multi spaces');
  });
});

describe('subsetSimilarity', () => {
  it('returns 1.0 when shorter is a subset of longer', () => {
    // The Alejandro Ruiz Granados → Alejandro Ruiz case
    expect(subsetSimilarity('Alejandro Ruiz Granados', 'Alejandro Ruiz')).toBe(1);
    expect(subsetSimilarity('David Gala', 'David Gala Sanchez')).toBe(1);
  });
  it('returns <1 when tokens partially overlap', () => {
    // 1 of 2 short-side tokens overlap → 0.5
    expect(subsetSimilarity('Pol Hernandez', 'Pedro Hernandez')).toBe(0.5);
  });
  it('returns 0 when no overlap', () => {
    expect(subsetSimilarity('Franco Stupaczuk', 'Juan Lebron')).toBe(0);
  });
});

describe('typoTolerantSimilarity', () => {
  it('tolerates 1-char edit on tokens ≥4 chars', () => {
    // "Giannina" → "Gianina" (Levenshtein 1, both ≥4 chars)
    expect(typoTolerantSimilarity('Giannina Lopez', 'Gianina Lopez')).toBe(1);
  });
  it('does NOT tolerate edits on short tokens (avoid initials false-positives)', () => {
    // "Jon" vs "Joe" differ by 1 char but both length-3 — must NOT match
    expect(typoTolerantSimilarity('Jon Sanz', 'Joe Sanz')).toBe(0.5); // only Sanz matches
  });
});
