import { describe, it, expect } from 'vitest'
import { winColor, pairSurnames } from '@/lib/projection-view'

describe('winColor', () => {
  it('lime at >= 0.65', () => expect(winColor(0.65)).toBe('#7ED321'))
  it('gold between 0.45 and 0.65', () => expect(winColor(0.5)).toBe('#F5A623'))
  it('red below 0.45', () => expect(winColor(0.3)).toBe('#FF4655'))
  it('gold at exactly 0.45', () => expect(winColor(0.45)).toBe('#F5A623'))
  it('live just below 0.45', () => expect(winColor(0.44)).toBe('#FF4655'))
})

describe('pairSurnames', () => {
  it('joins last name tokens', () => {
    expect(pairSurnames([
      { id: '1', name: 'Alex Chozas', country: null, avatarUrl: null },
      { id: '2', name: 'Valentino Libaak', country: null, avatarUrl: null },
    ])).toBe('Chozas / Libaak')
  })
  it('falls back to full name when single token', () => {
    expect(pairSurnames([{ id: '1', name: 'Coello', country: null, avatarUrl: null }])).toBe('Coello')
  })
  it('falls back to full names when both players are single-token', () => {
    expect(pairSurnames([
      { id: '1', name: 'Coello', country: null, avatarUrl: null },
      { id: '2', name: 'Tapia', country: null, avatarUrl: null },
    ])).toBe('Coello / Tapia')
  })
})
