import { describe, it, expect } from 'vitest'
import { predictionVerdict } from '../projection-view'

describe('predictionVerdict', () => {
  it('returns null while the pair is still active', () => {
    expect(predictionVerdict('R16', { status: 'active', eliminatedRound: null })).toBeNull()
  })

  it('returns null when there is no frozen prediction', () => {
    expect(predictionVerdict(null, { status: 'eliminated', eliminatedRound: 'R16' })).toBeNull()
    expect(predictionVerdict(undefined, { status: 'champion', eliminatedRound: null })).toBeNull()
  })

  it('"called" when eliminated exactly at the predicted round', () => {
    expect(predictionVerdict('R16', { status: 'eliminated', eliminatedRound: 'R16' })).toBe('called')
  })

  it('"missed" when knocked out before the predicted round', () => {
    expect(predictionVerdict('QF', { status: 'eliminated', eliminatedRound: 'R32' })).toBe('missed')
  })

  it('"better" when the pair went deeper than predicted', () => {
    expect(predictionVerdict('R16', { status: 'eliminated', eliminatedRound: 'SF' })).toBe('better')
  })

  it('champion: "called" when we predicted the final', () => {
    expect(predictionVerdict('F', { status: 'champion', eliminatedRound: null })).toBe('called')
  })

  it('champion: "better" when we predicted short of the final', () => {
    expect(predictionVerdict('SF', { status: 'champion', eliminatedRound: null })).toBe('better')
  })

  it('returns null for an eliminated pair with no elimination round recorded', () => {
    expect(predictionVerdict('R16', { status: 'eliminated', eliminatedRound: null })).toBeNull()
  })
})
