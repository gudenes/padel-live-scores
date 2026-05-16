import { describe, it, expect } from 'vitest'
import { buildSeoSummary, type BroadcasterForSummary } from '@/lib/where-to-watch/build-seo-summary'

const movistarES: BroadcasterForSummary = { name: 'Movistar Plus+', country_iso2: 'es' }
const redBull = (iso: string): BroadcasterForSummary => ({ name: 'Red Bull TV', country_iso2: iso })
const skySport = (iso: string): BroadcasterForSummary => ({ name: 'Sky Sport', country_iso2: iso })
const directv = (iso: string): BroadcasterForSummary => ({ name: 'DirecTV', country_iso2: iso })

describe('buildSeoSummary', () => {
  it('returns empty data on no broadcasters', () => {
    const out = buildSeoSummary({ broadcasters: [] })
    expect(out.named).toEqual([])
    expect(out.remainingCount).toBe(0)
  })

  it('groups broadcasters by name and sorts by country count (most first)', () => {
    const out = buildSeoSummary({
      broadcasters: [
        movistarES,
        redBull('es'), redBull('it'), redBull('de'), redBull('gb'), redBull('us'),
        skySport('it'), skySport('de'),
      ],
    })
    expect(out.named.map(b => b.name)).toEqual(['Red Bull TV', 'Sky Sport', 'Movistar Plus+'])
  })

  it('shows up to 4 countries per broadcaster, then sets extraCountryCount', () => {
    const out = buildSeoSummary({
      broadcasters: [
        redBull('es'), redBull('it'), redBull('de'), redBull('gb'),
        redBull('us'), redBull('ar'), redBull('br'), redBull('mx'),
      ],
    })
    expect(out.named[0].countriesShown).toEqual(['Spain', 'Italy', 'Germany', 'United Kingdom'])
    expect(out.named[0].extraCountryCount).toBe(4)
  })

  it('caps to 5 named broadcasters; remainder counted in remainingCount', () => {
    // 7 distinct broadcaster names, 1 country each
    const broadcasters: BroadcasterForSummary[] = [
      { name: 'A', country_iso2: 'es' },
      { name: 'B', country_iso2: 'es' },
      { name: 'C', country_iso2: 'es' },
      { name: 'D', country_iso2: 'es' },
      { name: 'E', country_iso2: 'es' },
      { name: 'F', country_iso2: 'es' },
      { name: 'G', country_iso2: 'es' },
    ]
    const out = buildSeoSummary({ broadcasters })
    expect(out.named).toHaveLength(5)
    expect(out.named.map(b => b.name)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(out.remainingCount).toBe(2)
  })

  it('counts remaining as TOTAL broadcasters beyond the cap, not country rows', () => {
    // F appears in 2 countries — counts as 1 broadcaster in the remainder
    const broadcasters: BroadcasterForSummary[] = [
      { name: 'A', country_iso2: 'es' },
      { name: 'B', country_iso2: 'es' },
      { name: 'C', country_iso2: 'es' },
      { name: 'D', country_iso2: 'es' },
      { name: 'E', country_iso2: 'es' },
      { name: 'F', country_iso2: 'es' }, { name: 'F', country_iso2: 'it' },
      { name: 'G', country_iso2: 'es' },
    ]
    const out = buildSeoSummary({ broadcasters })
    expect(out.remainingCount).toBe(2) // F + G, not F-es + F-it + G
  })

  it('respects custom maxNamedBroadcasters / maxCountriesPerBroadcaster', () => {
    const out = buildSeoSummary({
      broadcasters: [
        redBull('es'), redBull('it'), redBull('de'),
        skySport('it'), skySport('de'),
        directv('ar'),
      ],
      maxNamedBroadcasters: 2,
      maxCountriesPerBroadcaster: 2,
    })
    expect(out.named).toHaveLength(2)
    expect(out.named[0].name).toBe('Red Bull TV')
    expect(out.named[0].countriesShown).toEqual(['Spain', 'Italy'])
    expect(out.named[0].extraCountryCount).toBe(1)
    expect(out.remainingCount).toBe(1) // DirecTV
  })

  it('uppercases unknown ISO codes', () => {
    const out = buildSeoSummary({
      broadcasters: [{ name: 'Local TV', country_iso2: 'zz' }],
    })
    expect(out.named[0].countriesShown).toEqual(['ZZ'])
  })
})
