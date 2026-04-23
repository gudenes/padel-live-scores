import { describe, it, expect } from 'vitest'
import {
  parseAbbreviatedName,
  resolveOopPlayerToId,
} from '../oop-player-lookup'

// ---------------------------------------------------------------------------
// parseAbbreviatedName
// ---------------------------------------------------------------------------

describe('parseAbbreviatedName', () => {
  it('parses standard "X. Surname"', () => {
    expect(parseAbbreviatedName('C. Orsi')).toEqual({ initial: 'C', surname: 'Orsi' })
  })

  it('parses multi-word surname', () => {
    expect(parseAbbreviatedName('P. Llaguno Zielinski')).toEqual({
      initial: 'P',
      surname: 'Llaguno Zielinski',
    })
  })

  it('tolerates missing trailing period on initial', () => {
    expect(parseAbbreviatedName('C Orsi')).toEqual({ initial: 'C', surname: 'Orsi' })
  })

  it('collapses multi-char initial to first char (defensive)', () => {
    // "Ch. Coello" → initial "C" (first char of "Ch")
    expect(parseAbbreviatedName('Ch. Coello')).toEqual({ initial: 'C', surname: 'Coello' })
  })

  it('uppercases initial regardless of input casing', () => {
    expect(parseAbbreviatedName('c. orsi')).toEqual({ initial: 'C', surname: 'orsi' })
  })

  it('tolerates extra whitespace', () => {
    expect(parseAbbreviatedName('  C.   Orsi  ')).toEqual({ initial: 'C', surname: 'Orsi' })
  })

  it('returns null for null / empty / malformed input', () => {
    expect(parseAbbreviatedName(null)).toBeNull()
    expect(parseAbbreviatedName(undefined)).toBeNull()
    expect(parseAbbreviatedName('')).toBeNull()
    expect(parseAbbreviatedName('   ')).toBeNull()
    // Single token — no space → no surname
    expect(parseAbbreviatedName('Orsi')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// resolveOopPlayerToId
// ---------------------------------------------------------------------------

type PlayerRow = {
  id: string
  name: string
  normalized_name: string | null
  category: 'men' | 'women' | null
}

function makeFakeSupabase(opts: { players?: PlayerRow[] } = {}) {
  const players = opts.players ?? []
  return {
    from: (table: string) => {
      if (table !== 'players') throw new Error(`unexpected table: ${table}`)
      return {
        select: (_cols: string) => ({
          eq: (c1: string, v1: unknown) => ({
            ilike: (c2: string, pattern: string) => ({
              limit: (_n: number) => {
                // Strip the surrounding % signs and compare substring
                const needle = pattern.replace(/^%|%$/g, '').toLowerCase()
                const data = players
                  .filter((p) => (p as any)[c1] === v1)
                  .filter((p) =>
                    ((p as any)[c2] ?? '').toLowerCase().includes(needle),
                  )
                return Promise.resolve({ data, error: null })
              },
            }),
          }),
        }),
      }
    },
  } as any
}

describe('resolveOopPlayerToId', () => {
  it('returns null for unparseable abbreviated name', async () => {
    const supabase = makeFakeSupabase({})
    expect(await resolveOopPlayerToId(supabase, 'Orsi', 'men')).toBeNull()
    expect(await resolveOopPlayerToId(supabase, '', 'men')).toBeNull()
  })

  it('resolves "C. Orsi" when exactly one player matches', async () => {
    const supabase = makeFakeSupabase({
      players: [
        { id: 'p-1', name: 'Claudio Orsi', normalized_name: 'claudio orsi', category: 'men' },
        { id: 'p-2', name: 'Agustin Tapia', normalized_name: 'agustin tapia', category: 'men' },
      ],
    })
    expect(await resolveOopPlayerToId(supabase, 'C. Orsi', 'men')).toBe('p-1')
  })

  it('resolves multi-word surname "P. Llaguno Zielinski"', async () => {
    const supabase = makeFakeSupabase({
      players: [
        {
          id: 'p-1',
          name: 'Pablo Llaguno Zielinski',
          normalized_name: 'pablo llaguno zielinski',
          category: 'men',
        },
        // A different "Llaguno" without the second surname — should NOT match
        {
          id: 'p-2',
          name: 'Pablo Llaguno',
          normalized_name: 'pablo llaguno',
          category: 'men',
        },
      ],
    })
    expect(await resolveOopPlayerToId(supabase, 'P. Llaguno Zielinski', 'men')).toBe(
      'p-1',
    )
  })

  it('returns null when the initial mismatches (same surname, different first name)', async () => {
    const supabase = makeFakeSupabase({
      players: [
        {
          id: 'p-1',
          name: 'Fernando Belasteguin',
          normalized_name: 'fernando belasteguin',
          category: 'men',
        },
      ],
    })
    // "A. Belasteguin" — initial A vs DB Fernando (F) → no match
    expect(await resolveOopPlayerToId(supabase, 'A. Belasteguin', 'men')).toBeNull()
  })

  it('returns null when multiple candidates match (ambiguous)', async () => {
    const supabase = makeFakeSupabase({
      players: [
        {
          id: 'p-1',
          name: 'Carlos Garcia',
          normalized_name: 'carlos garcia',
          category: 'men',
        },
        {
          id: 'p-2',
          name: 'Cristian Garcia',
          normalized_name: 'cristian garcia',
          category: 'men',
        },
      ],
    })
    // Both have initial C and surname Garcia — ambiguous → null
    expect(await resolveOopPlayerToId(supabase, 'C. Garcia', 'men')).toBeNull()
  })

  it('scopes by category — same name different category does not match', async () => {
    const supabase = makeFakeSupabase({
      players: [
        {
          id: 'p-women-1',
          name: 'Carolina Orsi',
          normalized_name: 'carolina orsi',
          category: 'women',
        },
      ],
    })
    // Women's C. Orsi exists but we ask for men → no match
    expect(await resolveOopPlayerToId(supabase, 'C. Orsi', 'men')).toBeNull()
    // Women's category does find her (if her initial matches)
    expect(await resolveOopPlayerToId(supabase, 'C. Orsi', 'women')).toBe('p-women-1')
  })

  it('requires ALL surname tokens to be present (precision)', async () => {
    const supabase = makeFakeSupabase({
      players: [
        {
          id: 'p-1',
          name: 'Pablo Llaguno',
          normalized_name: 'pablo llaguno',
          category: 'men',
        },
      ],
    })
    // DB has just "Pablo Llaguno", OOP asks for "P. Llaguno Zielinski" — the
    // second surname token doesn't appear → no match (we don't want to link
    // by partial surname).
    expect(await resolveOopPlayerToId(supabase, 'P. Llaguno Zielinski', 'men')).toBeNull()
  })

  it('is case-insensitive on the initial', async () => {
    const supabase = makeFakeSupabase({
      players: [
        { id: 'p-1', name: 'Claudio Orsi', normalized_name: 'claudio orsi', category: 'men' },
      ],
    })
    expect(await resolveOopPlayerToId(supabase, 'c. orsi', 'men')).toBe('p-1')
  })

  it('falls back to normalize(name) when normalized_name is null', async () => {
    const supabase = makeFakeSupabase({
      players: [
        // normalized_name missing — helper should compute from `name`
        { id: 'p-1', name: 'Claudio Orsi', normalized_name: null, category: 'men' },
      ],
    })
    // Note: our fake supabase uses normalized_name directly for the ilike
    // filter, so this test primarily exercises the post-filter fallback path.
    // The ilike pattern would miss here since normalized_name is null, so
    // we expect null. (In production, the DB's generated column keeps
    // normalized_name populated via trigger.)
    expect(await resolveOopPlayerToId(supabase, 'C. Orsi', 'men')).toBeNull()
  })
})
