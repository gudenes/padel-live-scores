import { describe, it, expect } from 'vitest'
import { isMassDelete } from '../../workers/coach-linker.js'

describe('isMassDelete', () => {
  it('0/0 is false', () => expect(isMassDelete(0, 0)).toBe(false))
  it('60/100 is false (existing <= 100)', () => expect(isMassDelete(60, 100)).toBe(false))
  it('60/101 is true', () => expect(isMassDelete(60, 101)).toBe(true))
  it('50/101 is false', () => expect(isMassDelete(50, 101)).toBe(false))
})
