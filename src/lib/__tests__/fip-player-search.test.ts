import { describe, it, expect, vi } from 'vitest'
import {
  searchFipPlayer,
  buildSearchUrl,
  candidateQueries,
  nameTokensOverlap,
  isPlausibleNameMatch,
} from '../fip-player-search'

// Sample API payloads — shape verified live against
// https://www.padelfip.com/wp-json/fip/v1/player/search
const CLEO_CARVALHO = {
  player_id: 'P100312',
  name: 'Cleo',
  surname: 'Carvalho',
  nationality: 'BRA',
  gender: 'male',
  rank: 1736,
  points: 5,
  year: 2026,
  week_no: 17,
  url: 'https://www.padelfip.com/player/cleo-carvalho/',
  category: 'master',
  thumbnail: '',
  country_flag: 'https://www.padelfip.com/wp-content/uploads/2023/02/Brazil_Fip.jpg',
  country_name: 'BRA',
}

const CLEO_FRASER = {
  player_id: 'P206463',
  name: 'Cleo Alexander Joseph',
  surname: 'Fraser',
  nationality: 'POL',
  gender: 'male',
  rank: 3002,
  points: 0,
  year: 2026,
  week_no: 17,
  url: 'https://www.padelfip.com/player/cleo-alexander-joseph-fraser/',
  category: 'master',
  thumbnail: '',
  country_flag: '',
  country_name: 'POL',
}

function mockFetch(responses: unknown[]): typeof fetch {
  let call = 0
  return (async () => {
    const body = responses[call++] ?? []
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response
  }) as typeof fetch
}

/** Capture requested URLs so tests can assert fallback behaviour. */
function recordingFetch(responses: unknown[]): { fetchFn: typeof fetch; urls: string[] } {
  const urls: string[] = []
  let call = 0
  const fetchFn = (async (url: string) => {
    urls.push(String(url))
    const body = responses[call++] ?? []
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response
  }) as unknown as typeof fetch
  return { fetchFn, urls }
}

function mockFetchStatus(status: number): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => [],
    text: async () => '',
  } as Response)) as typeof fetch
}

describe('candidateQueries', () => {
  it('returns a single-item array for a single-token name', () => {
    expect(candidateQueries('Puppo')).toEqual(['Puppo'])
  })

  it('returns full name + surname for a 2-token name', () => {
    expect(candidateQueries('Luciano Puppo')).toEqual(['Luciano Puppo', 'Puppo'])
  })

  it('returns full + last-2 + last + individual tokens for 4-token names', () => {
    // For 4+ token names, individual-token fallbacks matter: some compound
    // surnames are stored by FIP with only the middle token, so trying
    // `Campuzano` (token 3) on its own can match when `Campuzano Vazquez` fails.
    expect(candidateQueries('Genaro Manuel Campuzano Vazquez'))
      .toEqual([
        'Genaro Manuel Campuzano Vazquez',
        'Campuzano Vazquez',
        'Vazquez',
        'Genaro',
        'Manuel',
        'Campuzano',
      ])
  })

  it('returns Bareiro as an individual-token fallback for a 4-token Paraguayan compound name', () => {
    // Real FIP case — "Olga Arami Bareiro Mora" is stored as surname "Bareiro".
    // Neither `Olga Arami Bareiro Mora` nor `Bareiro Mora` nor `Mora` hit;
    // `Bareiro` alone does.
    const q = candidateQueries('Olga Arami Bareiro Mora')
    expect(q).toContain('Bareiro')
  })

  it('skips short tokens (≤3 chars) as individual fallbacks', () => {
    // "de" / "la" / "da" would return too many unrelated hits.
    const q = candidateQueries('Juan de la Cruz Lopez')
    expect(q).not.toContain('de')
    expect(q).not.toContain('la')
  })

  it('deduplicates when last-2 equals full name (2-token input)', () => {
    // For "Luciano Puppo", last-2 = "Luciano Puppo" which equals full — not added twice
    const q = candidateQueries('Luciano Puppo')
    expect(new Set(q).size).toBe(q.length)
  })

  it('returns empty array for empty/whitespace input', () => {
    expect(candidateQueries('')).toEqual([])
    expect(candidateQueries('   ')).toEqual([])
  })

  it('collapses internal whitespace', () => {
    expect(candidateQueries('Juan  Pablo   Garcia'))
      .toEqual(['Juan Pablo Garcia', 'Pablo Garcia', 'Garcia'])
  })
})

describe('buildSearchUrl', () => {
  it('URL-encodes the name', () => {
    expect(buildSearchUrl({ name: 'Cleo Carvalho' }))
      .toBe('https://www.padelfip.com/wp-json/fip/v1/player/search?q=Cleo%20Carvalho')
  })

  it('handles names with accents', () => {
    expect(buildSearchUrl({ name: 'Adrián Baamonde' }))
      .toBe('https://www.padelfip.com/wp-json/fip/v1/player/search?q=Adri%C3%A1n%20Baamonde')
  })

  it('trims whitespace', () => {
    expect(buildSearchUrl({ name: '  Cleo Carvalho  ' }))
      .toBe('https://www.padelfip.com/wp-json/fip/v1/player/search?q=Cleo%20Carvalho')
  })
})

describe('searchFipPlayer', () => {
  it('returns the single result when API returns one player', async () => {
    const r = await searchFipPlayer(
      { name: 'Cleo Carvalho', country: 'BRA', category: 'men' },
      { fetchFn: mockFetch([[CLEO_CARVALHO]]) }
    )
    expect(r).not.toBeNull()
    expect(r!.playerId).toBe('P100312')
    expect(r!.fullName).toBe('Cleo Carvalho')
    expect(r!.gender).toBe('male')
  })

  it('filters multiple results by nationality (normalized)', async () => {
    // Search returns 2; PDF says BRA → filter out the POL result
    const r = await searchFipPlayer(
      { name: 'Cleo', country: 'BRA', category: 'men' },
      { fetchFn: mockFetch([[CLEO_CARVALHO, CLEO_FRASER]]) }
    )
    expect(r!.playerId).toBe('P100312')
  })

  it('accepts 2-letter ISO country from caller and normalizes against 3-letter API response', async () => {
    const r = await searchFipPlayer(
      { name: 'Cleo', country: 'BR', category: 'men' },
      { fetchFn: mockFetch([[CLEO_CARVALHO, CLEO_FRASER]]) }
    )
    expect(r!.playerId).toBe('P100312')
  })

  it('filters by gender when category provided', async () => {
    // Two male results + category=women → no match
    const r = await searchFipPlayer(
      { name: 'Cleo', country: 'BRA', category: 'women' },
      { fetchFn: mockFetch([[CLEO_CARVALHO, CLEO_FRASER]]) }
    )
    expect(r).toBeNull()
  })

  it('uses ranking proximity to pick best when multiple pass filters', async () => {
    // Both would pass nationality+gender filter, pick the one closer to hinted rank
    const r = await searchFipPlayer(
      { name: 'Cleo', category: 'men', rankingHint: 3000 }, // closer to 3002 (Fraser) than 1736
      { fetchFn: mockFetch([[CLEO_CARVALHO, CLEO_FRASER]]) }
    )
    expect(r!.playerId).toBe('P206463')
  })

  it('returns null when query has zero hits', async () => {
    const r = await searchFipPlayer(
      { name: 'Nonexistent Player' },
      { fetchFn: mockFetch([[]]) }
    )
    expect(r).toBeNull()
  })

  it('returns null when filters eliminate all candidates', async () => {
    // Only result is BRA; caller wants ARG
    const r = await searchFipPlayer(
      { name: 'Cleo Carvalho', country: 'ARG', category: 'men' },
      { fetchFn: mockFetch([[CLEO_CARVALHO]]) }
    )
    expect(r).toBeNull()
  })

  it('returns null on HTTP error', async () => {
    const r = await searchFipPlayer(
      { name: 'Cleo Carvalho' },
      { fetchFn: mockFetchStatus(500) }
    )
    expect(r).toBeNull()
  })

  it('treats unknown gender in API as not matching a category filter', async () => {
    // Hypothetical: API returns a row with gender='unknown' — must not false-match
    const weird = { ...CLEO_CARVALHO, gender: 'mixed' }
    const r = await searchFipPlayer(
      { name: 'Cleo Carvalho', category: 'men' },
      { fetchFn: mockFetch([[weird]]) }
    )
    expect(r).toBeNull()
  })

  it('skips country filter when caller provides no country', async () => {
    // Two candidates, no country filter, no ranking hint → return the first
    const r = await searchFipPlayer(
      { name: 'Cleo', category: 'men' },
      { fetchFn: mockFetch([[CLEO_CARVALHO, CLEO_FRASER]]) }
    )
    expect(r).not.toBeNull()
    expect(['P100312', 'P206463']).toContain(r!.playerId)
  })

  it('falls back to shorter query when full-name query returns non-array error', async () => {
    // FIP returns { error: "No result Found" } for long queries. Expect client
    // to try the next candidate ("Campuzano Vazquez") and hit.
    const hit = {
      player_id: 'P203372',
      name: 'Genaro Manuel',
      surname: 'Campuzano Vazquez',
      nationality: 'PAR',
      gender: 'male',
      rank: 2172,
      points: 3,
      year: 2026, week_no: 17,
      url: '', category: 'master', thumbnail: '', country_flag: '', country_name: 'PAR',
    }
    const { fetchFn, urls } = recordingFetch([
      { error: 'No result Found' },   // full-name query returns error object
      [hit],                           // last-2 query returns the hit
    ])
    const r = await searchFipPlayer(
      { name: 'Genaro Manuel Campuzano Vazquez', country: 'PAR', category: 'men' },
      { fetchFn }
    )
    expect(r!.playerId).toBe('P203372')
    expect(urls.length).toBe(2)
    expect(urls[0]).toContain('Genaro%20Manuel%20Campuzano%20Vazquez')
    expect(urls[1]).toContain('Campuzano%20Vazquez')
  })

  it('falls back a second time when last-2 returns empty, lands on surname-only', async () => {
    const hit = {
      player_id: 'P208174',
      name: 'Fatima Yuri',
      surname: 'Kudo Ykkatai',
      nationality: 'PAR',
      gender: 'female',
      rank: 809, points: 10, year: 2026, week_no: 17,
      url: '', category: 'master', thumbnail: '', country_flag: '', country_name: 'PAR',
    }
    const { fetchFn, urls } = recordingFetch([
      { error: 'No result Found' },   // full-name error
      [],                               // last-2 empty array
      [hit],                            // surname-only hit
    ])
    const r = await searchFipPlayer(
      { name: 'Fatima Yuri Kudo Ykkatai', country: 'PAR', category: 'women' },
      { fetchFn }
    )
    expect(r!.playerId).toBe('P208174')
    expect(urls.length).toBe(3)
  })

  it('continues to the next candidate query when filters eliminate all hits from an earlier query', async () => {
    // Real Ijuí case: "Olga Arami Bareiro Mora" (PAR, women). Candidate queries try
    // `Mora` before `Bareiro`. `Mora` returns 20 Spanish men+women, none matching
    // the PAR+female filter. The loop must continue and try `Bareiro`, which
    // returns the real player (Olga Bareiro PAR female).
    const unrelatedMora = {
      player_id: 'P000', name: 'Amanda Lopez', surname: 'Moral',
      nationality: 'ESP', gender: 'female', rank: 60, points: 0, year: 2026, week_no: 17,
      url: '', category: 'master', thumbnail: '', country_flag: '', country_name: 'ESP',
    }
    const realHit = {
      player_id: 'P209603', name: 'Olga', surname: 'Bareiro',
      nationality: 'PAR', gender: 'female', rank: 618, points: 16, year: 2026, week_no: 17,
      url: '', category: 'master', thumbnail: '', country_flag: '', country_name: 'PAR',
    }
    // candidateQueries('Olga Arami Bareiro Mora') =
    //   ['Olga Arami Bareiro Mora', 'Bareiro Mora', 'Mora', 'Olga', 'Arami', 'Bareiro']
    const { fetchFn, urls } = recordingFetch([
      { error: 'No result Found' },  // full name
      { error: 'No result Found' },  // 'Bareiro Mora'
      [unrelatedMora],                // 'Mora' — filter eliminates
      [],                             // 'Olga' — too many results not shown, assume empty for test
      [],                             // 'Arami'
      [realHit],                      // 'Bareiro' — hits the real player
    ])
    const r = await searchFipPlayer(
      { name: 'Olga Arami Bareiro Mora', country: 'PAR', category: 'women' },
      { fetchFn }
    )
    expect(r?.playerId).toBe('P209603')
    expect(urls.length).toBeGreaterThanOrEqual(4)
  })

  it('returns null when every candidate query hits are eliminated by filters', async () => {
    // All queries succeed but all results are wrong nationality/gender → null.
    const polOnly = {
      player_id: 'P999', name: 'Cleo', surname: 'Carvalho',
      nationality: 'POL', gender: 'male', rank: 50, points: 0, year: 2026, week_no: 17,
      url: '', category: 'master', thumbnail: '', country_flag: '', country_name: 'POL',
    }
    // candidateQueries('Cleo Carvalho') = ['Cleo Carvalho', 'Carvalho']
    const { fetchFn, urls } = recordingFetch([[polOnly], [polOnly]])
    const r = await searchFipPlayer(
      { name: 'Cleo Carvalho', country: 'BRA', category: 'men' },
      { fetchFn }
    )
    expect(r).toBeNull()
    expect(urls.length).toBe(2)
  })

  it('populates fullName from name + surname', async () => {
    const r = await searchFipPlayer(
      { name: 'Genaro Manuel Campuzano Vazquez', country: 'PAR', category: 'men' },
      { fetchFn: mockFetch([[{
        player_id: 'P203372',
        name: 'Genaro Manuel',
        surname: 'Campuzano Vazquez',
        nationality: 'PAR',
        gender: 'male',
        rank: 2172,
        points: 3,
        year: 2026, week_no: 17,
        url: '', category: 'master', thumbnail: '', country_flag: '', country_name: 'PAR',
      }]]) }
    )
    expect(r!.fullName).toBe('Genaro Manuel Campuzano Vazquez')
  })

  it('rejects same-surname-only matches (regression: Asuncion P2 women, Nuria→Elvira)', async () => {
    // Real bug: input "Nuria Rodriguez Camacho" not in FIP (no fip_id yet);
    // the surname-only candidate query "Camacho" returns "Elvira Camacho
    // Marente" who passes country (ESP) and gender (female) filters. Without
    // a name-overlap guard the snapshot stored Elvira at Nuria's row,
    // poisoning downstream draw resolution. Now we expect the wrong-player
    // hit to be filtered out and the search to return null.
    const elvira = {
      player_id: 'P201666',
      name: 'Elvira',
      surname: 'Camacho Marente',
      nationality: 'ESP',
      gender: 'female',
      rank: 95, points: 540, year: 2026, week_no: 18,
      url: '', category: 'master', thumbnail: '', country_flag: '', country_name: 'ESP',
    }
    // candidateQueries('Nuria Rodriguez Camacho') = ['Nuria Rodriguez Camacho', 'Rodriguez Camacho', 'Camacho']
    const { fetchFn, urls } = recordingFetch([
      [],                 // full name — no hits
      [],                 // 'Rodriguez Camacho' — no hits
      [elvira],           // 'Camacho' — wrong same-surname player
    ])
    const r = await searchFipPlayer(
      { name: 'Nuria Rodriguez Camacho', country: 'ESP', category: 'women', rankingHint: 36 },
      { fetchFn }
    )
    expect(r).toBeNull()
    expect(urls.length).toBe(3)
  })

  it('rejects wrong same-surname match where input shares only a connecting word ("Fernández")', async () => {
    // Real bug: input "Marta Borrero Fernández" got resolved to wholly
    // different "Claudia Fernandez Sanchez" via the surname-only fallback.
    const claudia = {
      player_id: 'P200006',
      name: 'Claudia',
      surname: 'Fernandez Sanchez',
      nationality: 'ESP',
      gender: 'female',
      rank: 6, points: 12620, year: 2026, week_no: 18,
      url: '', category: 'master', thumbnail: '', country_flag: '', country_name: 'ESP',
    }
    const { fetchFn } = recordingFetch([[], [], [claudia]])
    const r = await searchFipPlayer(
      { name: 'Marta Borrero Fernández', country: 'ESP', category: 'women', rankingHint: 44 },
      { fetchFn }
    )
    expect(r).toBeNull()
  })

  it('still accepts a legitimate match with 2-token overlap (Olga Bareiro via surname-only fallback)', async () => {
    // Regression check for the existing "next candidate query" behaviour:
    // surname-only fallback that returns the RIGHT player must still pass.
    const realHit = {
      player_id: 'P209603', name: 'Olga', surname: 'Bareiro',
      nationality: 'PAR', gender: 'female', rank: 618, points: 16, year: 2026, week_no: 17,
      url: '', category: 'master', thumbnail: '', country_flag: '', country_name: 'PAR',
    }
    const { fetchFn } = recordingFetch([[], [], [], [], [], [realHit]])
    const r = await searchFipPlayer(
      { name: 'Olga Arami Bareiro Mora', country: 'PAR', category: 'women' },
      { fetchFn }
    )
    expect(r?.playerId).toBe('P209603')
  })
})

describe('nameTokensOverlap', () => {
  it('counts shared ≥3-char tokens (case- and accent-insensitive)', () => {
    expect(nameTokensOverlap('Nuria Rodriguez Camacho', 'Elvira Camacho Marente')).toBe(1)
    expect(nameTokensOverlap('Olga Arami Bareiro Mora', 'Olga Bareiro')).toBe(2)
    expect(nameTokensOverlap('Marta Borrero Fernández', 'Claudia Fernandez Sanchez')).toBe(1)
  })

  it('ignores short connecting words like "de", "la", "do"', () => {
    // "de" and "la" should not contribute to overlap
    expect(nameTokensOverlap('Maria de la Paz', 'Pedro de la Cruz')).toBe(0)
  })

  it('returns 0 for empty inputs', () => {
    expect(nameTokensOverlap('', 'Anyone')).toBe(0)
    expect(nameTokensOverlap('Anyone', '')).toBe(0)
  })
})

describe('isPlausibleNameMatch', () => {
  it('requires ≥2 overlapping tokens for multi-token inputs', () => {
    expect(isPlausibleNameMatch('Nuria Rodriguez Camacho', 'Elvira Camacho Marente')).toBe(false)
    expect(isPlausibleNameMatch('Nuria Rodriguez Camacho', 'Nuria Rodriguez')).toBe(true)
    expect(isPlausibleNameMatch('Olga Arami Bareiro Mora', 'Olga Bareiro')).toBe(true)
  })

  it('requires all tokens to overlap for single-token inputs', () => {
    // Single-token input falls back to "all tokens must overlap" — preserves
    // backwards-compat with existing tests like `name: 'Cleo'`.
    expect(isPlausibleNameMatch('Cleo', 'Cleo Carvalho')).toBe(true)
    expect(isPlausibleNameMatch('Cleo', 'Mario Garcia')).toBe(false)
  })

  it('rejects when only short connecting tokens overlap', () => {
    expect(isPlausibleNameMatch('Maria de la Paz', 'Pedro de la Cruz')).toBe(false)
  })

  it('handles diacritics and case', () => {
    expect(isPlausibleNameMatch('Marta Borrero Fernández', 'Marta Borrero Fernandez')).toBe(true)
    expect(isPlausibleNameMatch('GIULIA DAL POZZO', 'Giulia dal pozzo')).toBe(true)
  })
})
