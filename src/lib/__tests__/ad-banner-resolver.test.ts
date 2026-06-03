import { describe, it, expect } from 'vitest'
import { pickBanner, type AdBanner } from '@/lib/ad-banner-resolver'

function banner(p: Partial<AdBanner>): AdBanner {
  return {
    id: p.id ?? 'b', name: p.name ?? 'B', country_code: p.country_code ?? null,
    slot: 'sticky-bottom', image_url: '/x.svg', click_url: 'https://x',
    active: p.active ?? true, weight: p.weight ?? 1,
  }
}

describe('pickBanner', () => {
  const es = banner({ id: 'es', country_code: 'ES' })
  const global = banner({ id: 'g', country_code: null })

  it('prefers an exact country match over global', () => {
    expect(pickBanner([global, es], 'ES')?.id).toBe('es')
  })

  it('falls back to the global default when no country match', () => {
    expect(pickBanner([global, es], 'PT')?.id).toBe('g')
  })

  it('returns null when nothing matches and no global', () => {
    expect(pickBanner([es], 'PT')).toBeNull()
    expect(pickBanner([], 'ES')).toBeNull()
  })

  it('ignores inactive banners', () => {
    expect(pickBanner([banner({ id: 'es', country_code: 'ES', active: false })], 'ES')).toBeNull()
  })

  it('weighted rotation: rand near 0 picks the first, near 1 the last', () => {
    const a = banner({ id: 'a', country_code: 'ES', weight: 1 })
    const b = banner({ id: 'b', country_code: 'ES', weight: 3 })
    expect(pickBanner([a, b], 'ES', () => 0)?.id).toBe('a')
    expect(pickBanner([a, b], 'ES', () => 0.999)?.id).toBe('b')
  })

  it('a single candidate is always returned regardless of rand', () => {
    const a = banner({ id: 'a', country_code: 'ES' })
    expect(pickBanner([a], 'ES', () => 0.5)?.id).toBe('a')
  })
})
