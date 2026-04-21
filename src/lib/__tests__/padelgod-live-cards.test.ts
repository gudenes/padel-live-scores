import { describe, it, expect } from 'vitest'
import { parseScoreAfter } from '../padelgod-live-cards'

describe('parseScoreAfter', () => {
  it('parses a standard score string', () => {
    expect(parseScoreAfter('40-30')).toEqual({ pair1Score: '40', pair2Score: '30' })
  })

  it('parses deuce', () => {
    expect(parseScoreAfter('40-40')).toEqual({ pair1Score: '40', pair2Score: '40' })
  })

  it('parses advantage (Ad-40)', () => {
    expect(parseScoreAfter('Ad-40')).toEqual({ pair1Score: 'Ad', pair2Score: '40' })
  })

  it('returns 0-0 for null', () => {
    expect(parseScoreAfter(null)).toEqual({ pair1Score: '0', pair2Score: '0' })
  })

  it('returns 0-0 for malformed input', () => {
    expect(parseScoreAfter('nonsense')).toEqual({ pair1Score: '0', pair2Score: '0' })
  })
})
