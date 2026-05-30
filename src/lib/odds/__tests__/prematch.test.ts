import { describe, it, expect } from 'vitest'
import { preMatchProb, fairOdds } from '../prematch'

describe('preMatchProb', () => {
  it('returns 0.5/0.5 when any of the four rankings is missing', () => {
    expect(preMatchProb([1, 2, 3, null])).toEqual({ p1: 0.5, p2: 0.5, fallback: true })
  })

  it('favors the lower-ranked (stronger) pair and clamps to [0.20,0.80]', () => {
    const { p1, p2, fallback } = preMatchProb([1, 2, 200, 210]) // pair1 much stronger
    expect(fallback).toBe(false)
    expect(p1).toBeCloseTo(0.8, 5)   // saturates the clamp
    expect(p2).toBeCloseTo(0.2, 5)
    expect(p1 + p2).toBeCloseTo(1, 10)
  })

  it('is ~even for equal rankings', () => {
    const { p1 } = preMatchProb([50, 60, 50, 60])
    expect(p1).toBeCloseTo(0.5, 6)
  })

  it('fairOdds is 1/p rounded to 2dp', () => {
    expect(fairOdds(0.8)).toBe(1.25)
    expect(fairOdds(0.2)).toBe(5)
  })
})
