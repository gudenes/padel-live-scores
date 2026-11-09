import { describe, expect, it } from 'vitest'
import { dedupePremierTournaments, preferredPremierTournamentId, premierEditions as rows, resolvePremierPreviousEdition as resolve, visiblePremierEditions } from '../premier-editions'

function edition(series: string, year: number) {
  return rows.find(row => row.series === series && row.year === year)!
}

describe('Premier edition identity', () => {
  it.each([
    ['dubai', 2026, 2025], ['milano', 2025, 2024],
    ['paris', 2025, 2024], ['paris', 2024, 2023],
    ['madrid', 2024, 2023], ['valladolid', 2026, 2025],
    ['rotterdam', 2026, 2025], ['kuwait', 2026, 2024],
    ['finals', 2026, 2025], ['finals', 2025, 2024],
  ])('%s %i links to %i independently of sponsor or tier', (series, year, previousYear) => {
    const result = resolve(edition(series as string, year as number).id)
    expect(result.previous?.series).toBe(series)
    expect(result.previous?.year).toBe(previousYear)
  })

  it('both Madrid 2026 records link to 2025, never 2024 or each other', () => {
    expect(visiblePremierEditions().filter(r => r.series === 'madrid' && r.year === 2026).map(r => r.id))
      .toEqual(['8083ac24-da11-4a8f-84c5-708c21307e9f'])
    for (const row of rows.filter(r => r.series === 'madrid' && r.year === 2026)) {
      expect(resolve(row.id).previous?.id).toBe(edition('madrid', 2025).id)
    }
  })

  it('both Mexico 2025 records link to the Major, not Acapulco P1', () => {
    for (const row of rows.filter(r => r.series === 'mexico-major' && r.year === 2025)) {
      expect(resolve(row.id).previous?.id).toBe(edition('mexico-major', 2024).id)
    }
    expect(resolve(edition('acapulco-p1', 2024).id).previous).toBeNull()
  })

  it('links Mexico 2026 to the explicitly selected GNP Acapulco Major 2025', () => {
    expect(resolve(edition('mexico-major', 2026).id).previous?.id).toBe('c3fc9afd-adff-49ba-88bc-abaabc098732')
    const visible = visiblePremierEditions()
    expect(visible.filter(r => r.series === 'mexico-major' && r.year === 2025).map(r => r.id))
      .toEqual(['c3fc9afd-adff-49ba-88bc-abaabc098732'])
    expect(resolve('92b0a5cb-99a7-43f5-a24e-8d453a2759d6').previous?.year).toBe(2024)
  })

  it('uses the reviewed Finals 2025 record with matches', () => {
    expect(resolve(edition('finals', 2026).id).previous?.id).toBe('29fbd066-1879-4f15-b9b6-8f9535a6b647')
  })

  it('leaves non-Premier lookup unchanged, and does not guess new Premier records', () => {
    expect(resolve('new-fip', 'fip_silver').handled).toBe(false)
    expect(resolve('new-premier', 'p1')).toMatchObject({ handled: true, previous: null, reason: 'unlisted' })
  })

  it('has unique IDs and links only to earlier years in the same series', () => {
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
    for (const row of rows) {
      const { previous } = resolve(row.id)
      if (previous) {
        expect(previous.series).toBe(row.series)
        expect(previous.year).toBeLessThan(row.year)
        expect(previous.ends_at < row.starts_at).toBe(true)
      }
    }
  })
})

// These are the reviewed survivors from the live-data audit, not source priorities.
describe('reviewed duplicate tournament presentation', () => {
  const pairs = [
    ['3f3ac22c-20a0-4999-aaf2-d6451cefa65c', '8083ac24-da11-4a8f-84c5-708c21307e9f'],
    ['92b0a5cb-99a7-43f5-a24e-8d453a2759d6', 'c3fc9afd-adff-49ba-88bc-abaabc098732'],
    ['b62cb0c0-f777-405c-ad57-1490bf31755c', '29fbd066-1879-4f15-b9b6-8f9535a6b647'],
  ]

  it.each(pairs)('maps %s to its reviewed survivor', (alias, preferred) => {
    expect(preferredPremierTournamentId(alias)).toBe(preferred)
    expect(preferredPremierTournamentId(preferred)).toBe(preferred)
  })

  it.each(pairs)('removes %s only when the preferred row was fetched', (alias, preferred) => {
    const old = { id: alias, name: 'legacy' }
    const survivor = { id: preferred, name: 'live database name', matches: 110 }
    const unrelated = { id: 'new-event', name: 'New event' }
    expect(dedupePremierTournaments([old, unrelated, survivor])).toEqual([unrelated, survivor])
    expect(dedupePremierTournaments([survivor, old])).toEqual([survivor])
    expect(dedupePremierTournaments([old, unrelated])).toEqual([old, unrelated])
    expect(dedupePremierTournaments([survivor])[0]).toBe(survivor)
  })

  it('leaves unknown IDs and distinct Acapulco events intact', () => {
    const distinct = [edition('acapulco-p1', 2024), edition('mexico-major', 2024), { id: 'new-fip' }]
    expect(dedupePremierTournaments(distinct)).toEqual(distinct)
    expect(preferredPremierTournamentId('new-fip')).toBe('new-fip')
  })
})
