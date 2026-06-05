import { describe, it, expect } from 'vitest'
import { splitGameScore } from './score'

describe('splitGameScore', () => {
  it('splits "40-30" into {a:"40", b:"30"}', () => {
    expect(splitGameScore('40-30')).toEqual({ a: '40', b: '30' })
  })
  it('handles AD', () => {
    expect(splitGameScore('AD-40')).toEqual({ a: 'AD', b: '40' })
  })
  it('returns null for null/empty', () => {
    expect(splitGameScore(null)).toBeNull()
    expect(splitGameScore('')).toBeNull()
  })
  it('trims whitespace', () => {
    expect(splitGameScore(' 15 - 0 ')).toEqual({ a: '15', b: '0' })
  })
})
