import { describe, expect, it } from 'vitest'
import { betaAttributionFromSearch, normalizeBetaAttribution } from '../beta-attribution'

describe('beta campaign attribution', () => {
  it('preserves campaign language independently of the displayed language', () => {
    expect(betaAttributionFromSearch('?utm_source=meta&utm_campaign=closed_beta_oct2026_en&locale=es&fbclid=secret')).toEqual({
      utm_source: 'meta', utm_campaign: 'closed_beta_oct2026_en',
    })
  })
  it('ignores malformed metadata without blocking registration', () => {
    expect(normalizeBetaAttribution({ utm_source: [], utm_campaign: 'x'.repeat(201), utm_content: 'bad\nvalue', email: 'private' })).toEqual({})
    expect(normalizeBetaAttribution(null)).toEqual({})
    expect(betaAttributionFromSearch('')).toEqual({})
  })
})
