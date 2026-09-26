import { describe, it, expect } from 'vitest'
import { buildShareUrl } from '../share-url'

const ID = '77ab6a3d-7484-46d2-b873-f90df0a4a1a0'

describe('buildShareUrl', () => {
  it('omits the prefix for the default locale', () => {
    // localePrefix is 'as-needed': /en/player/<id> is a 307, /player/<id> is
    // the real URL. Shipping the prefixed one means sharing a redirect.
    expect(buildShareUrl('en', ID)).toBe(`https://padelnachos.com/player/${ID}`)
  })

  it('includes the prefix for every other locale', () => {
    expect(buildShareUrl('es', ID)).toBe(`https://padelnachos.com/es/player/${ID}`)
    expect(buildShareUrl('pt', ID)).toBe(`https://padelnachos.com/pt/player/${ID}`)
    expect(buildShareUrl('it', ID)).toBe(`https://padelnachos.com/it/player/${ID}`)
    expect(buildShareUrl('fr', ID)).toBe(`https://padelnachos.com/fr/player/${ID}`)
  })

  it('falls back to no prefix for an unknown locale', () => {
    // A junk locale must not produce /xx/player/... — the unprefixed URL
    // always resolves, so it is the safe fallback.
    expect(buildShareUrl('xx', ID)).toBe(`https://padelnachos.com/player/${ID}`)
  })

  it('carries no query string', () => {
    // The profile URL picks up ?tab= and ?season= as the user navigates.
    // Sharing those would hand someone a view they never chose to share.
    expect(buildShareUrl('es', ID)).not.toContain('?')
  })
})
