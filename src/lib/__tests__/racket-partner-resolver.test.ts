// src/lib/__tests__/racket-partner-resolver.test.ts
import { describe, it, expect } from 'vitest'
import { resolveRacketDestination } from '../racket-partner-resolver'

const partner = {
  id: 'partner-1',
  name: 'Toro Doro',
  country_code: 'BR',
  fallback_url: 'https://www.torodoro.com.br/',
}

describe('resolveRacketDestination', () => {
  it('returns the per-racket override when partner + per-racket URL are present', () => {
    const result = resolveRacketDestination({
      country: 'BR',
      partner,
      perRacketUrl: 'https://www.torodoro.com.br/produto/head-coello-pro',
      originalProductUrl: 'https://head.com/coello-pro',
    })
    expect(result).toEqual({
      url: 'https://www.torodoro.com.br/produto/head-coello-pro',
      partnerId: 'partner-1',
      resolvedKind: 'per_racket',
    })
  })

  it('falls back to the partner homepage when no per-racket URL is set', () => {
    const result = resolveRacketDestination({
      country: 'BR',
      partner,
      perRacketUrl: null,
      originalProductUrl: 'https://head.com/coello-pro',
    })
    expect(result).toEqual({
      url: 'https://www.torodoro.com.br/',
      partnerId: 'partner-1',
      resolvedKind: 'partner_fallback',
    })
  })

  it('returns the original product URL when no partner exists for the country', () => {
    const result = resolveRacketDestination({
      country: 'US',
      partner: null,
      perRacketUrl: null,
      originalProductUrl: 'https://head.com/coello-pro',
    })
    expect(result).toEqual({
      url: 'https://head.com/coello-pro',
      partnerId: null,
      resolvedKind: 'original',
    })
  })

  it('returns the original product URL when country cookie is missing', () => {
    const result = resolveRacketDestination({
      country: null,
      partner: null,
      perRacketUrl: null,
      originalProductUrl: 'https://head.com/coello-pro',
    })
    expect(result.url).toBe('https://head.com/coello-pro')
    expect(result.resolvedKind).toBe('original')
    expect(result.partnerId).toBeNull()
  })

  it('ignores a per-racket URL when no partner is present (defensive)', () => {
    const result = resolveRacketDestination({
      country: 'BR',
      partner: null,
      perRacketUrl: 'https://www.torodoro.com.br/produto/x',
      originalProductUrl: 'https://head.com/x',
    })
    expect(result.url).toBe('https://head.com/x')
    expect(result.resolvedKind).toBe('original')
  })

  it('falls through to original when country does not match partner country (defensive)', () => {
    const result = resolveRacketDestination({
      country: 'AR',
      partner, // BR
      perRacketUrl: 'https://www.torodoro.com.br/produto/x',
      originalProductUrl: 'https://head.com/x',
    })
    expect(result.resolvedKind).toBe('original')
    expect(result.url).toBe('https://head.com/x')
    expect(result.partnerId).toBeNull()
  })
})
