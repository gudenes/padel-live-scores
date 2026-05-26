import { describe, it, expect } from 'vitest'
import { computePlayerLinkStatus, type PlayerLinkInput } from '@/lib/player-link-status'

const base: PlayerLinkInput = {
  id: null,
  name: 'Test Player',
  avatar_url: null,
  ranking: null,
  padelapi_id: null,
  fip_id: null,
}

describe('computePlayerLinkStatus', () => {
  it('returns "unresolved" when id is null', () => {
    expect(computePlayerLinkStatus({ ...base, id: null })).toBe('unresolved')
    expect(computePlayerLinkStatus({ ...base, id: null, fip_id: 'P12345' })).toBe('unresolved')
  })

  it('returns "thin" when id is set but no enrichment fields', () => {
    expect(computePlayerLinkStatus({ ...base, id: 'abc' })).toBe('thin')
    expect(computePlayerLinkStatus({ ...base, id: 'abc', fip_id: 'P12345' })).toBe('thin')
  })

  it('returns "enriched" when id is set + avatar_url present', () => {
    expect(computePlayerLinkStatus({ ...base, id: 'abc', avatar_url: 'https://x.com/a.png' })).toBe('enriched')
  })

  it('returns "enriched" when id is set + ranking present', () => {
    expect(computePlayerLinkStatus({ ...base, id: 'abc', ranking: 42 })).toBe('enriched')
  })

  it('returns "enriched" when id is set + padelapi_id present', () => {
    expect(computePlayerLinkStatus({ ...base, id: 'abc', padelapi_id: '432' })).toBe('enriched')
  })

  it('returns "enriched" when multiple enrichment fields present', () => {
    expect(computePlayerLinkStatus({
      ...base,
      id: 'abc',
      avatar_url: 'https://x.com/a.png',
      ranking: 42,
      padelapi_id: '432',
    })).toBe('enriched')
  })

  it('treats empty string fields as missing (defensive)', () => {
    expect(computePlayerLinkStatus({ ...base, id: 'abc', avatar_url: '' })).toBe('thin')
  })
})
