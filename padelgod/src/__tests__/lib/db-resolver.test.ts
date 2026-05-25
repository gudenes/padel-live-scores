import { describe, it, expect } from 'vitest';
import { normalizeName } from '../../lib/db-resolver.js';
import { subsetSimilarity, typoTolerantSimilarity } from '../../lib/db-resolver.js';
import { loadDbPlayerIndex, loadAliasIndex } from '../../lib/db-resolver.js';

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

// Test-only fake supabase client. Only supports the .from().select().eq()
// chain shape used by loadDbPlayerIndex and loadAliasIndex. Do not reuse
// for queries that add .order() / .limit() / .range() — extend it instead.
function fakeSupabase(playerRows: any[], aliasRows: any[]) {
  return {
    from: (table: string) => {
      if (table === 'players') {
        return {
          select: () => ({
            eq: () => ({
              then: (res: any) => Promise.resolve({ data: playerRows, error: null }).then(res),
            }),
          }),
        };
      }
      if (table === 'entity_external_ids') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                // .range() is what paginatedSelect calls; return a single page
                // with all aliasRows so the helper stops after the first fetch.
                range: () => Promise.resolve({ data: aliasRows, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error('unexpected table: ' + table);
    },
  } as any;
}

describe('loadDbPlayerIndex', () => {
  it('keys by normalized name, groups duplicates', async () => {
    const supabase = fakeSupabase(
      [
        { id: 'u1', fip_id: 'P1', name: 'Juan Garcia', normalized_name: 'juan garcia', country: 'ES', ranking: 50, category: 'men' },
        { id: 'u2', fip_id: 'P2', name: 'Juan Garcia', normalized_name: 'juan garcia', country: 'AR', ranking: 200, category: 'men' },
        { id: 'u3', fip_id: 'P3', name: 'Alejandro Ruiz', normalized_name: 'alejandro ruiz', country: 'ES', ranking: 23, category: 'men' },
      ],
      []
    );
    const idx = await loadDbPlayerIndex(supabase, 'men');
    expect(idx.get('juan garcia')?.length).toBe(2);
    expect(idx.get('alejandro ruiz')?.length).toBe(1);
  });
});

describe('loadAliasIndex', () => {
  it('returns normalized-alias → playerId map for player aliases only', async () => {
    const supabase = fakeSupabase(
      [],
      [
        { entity_id: 'u-ruiz', external_id: 'Alejandro Ruiz Granados', metadata: null },
        { entity_id: 'u-gala', external_id: 'David Gala Sanchez', metadata: null },
      ]
    );
    const idx = await loadAliasIndex(supabase);
    expect(idx.get('alejandro ruiz granados')).toBe('u-ruiz');
    expect(idx.get('david gala sanchez')).toBe('u-gala');
    expect(idx.size).toBe(2);
  });
});

describe('loader error handling', () => {
  it('loadDbPlayerIndex throws with category in message when supabase errors', async () => {
    const errSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            then: (res: any) => Promise.resolve({ data: null, error: { message: 'connection refused' } }).then(res),
          }),
        }),
      }),
    } as any;
    await expect(loadDbPlayerIndex(errSupabase, 'men')).rejects.toThrow(/men.*connection refused/);
  });

  it('loadAliasIndex throws with descriptive prefix when supabase errors', async () => {
    // loadAliasIndex now uses paginatedSelect, which calls buildQuery once
    // per page. Return an error on the first call.
    const errSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              range: () => Promise.resolve({ data: null, error: { message: 'pg_timeout' } }),
            }),
          }),
        }),
      }),
    } as any;
    await expect(loadAliasIndex(errSupabase)).rejects.toThrow(/entity_external_ids.*pg_timeout/);
  });
});
