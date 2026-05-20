import { describe, it, expect, beforeEach } from 'vitest'
import { check, _reset } from '../src/lib/rate-limit'

describe('rate-limit', () => {
  beforeEach(() => _reset())

  it('allows up to 5 attempts in a 15-min window', () => {
    for (let i = 0; i < 5; i++) {
      expect(check('1.2.3.4', 5, 15 * 60_000)).toEqual({ allowed: true, remaining: 4 - i })
    }
  })

  it('blocks the 6th attempt within the window', () => {
    for (let i = 0; i < 5; i++) check('1.2.3.4', 5, 15 * 60_000)
    const r = check('1.2.3.4', 5, 15 * 60_000)
    expect(r.allowed).toBe(false)
  })

  it('keys are independent per IP', () => {
    for (let i = 0; i < 5; i++) check('1.2.3.4', 5, 15 * 60_000)
    expect(check('1.2.3.4', 5, 15 * 60_000).allowed).toBe(false)
    expect(check('5.6.7.8', 5, 15 * 60_000).allowed).toBe(true)
  })

  it('resets after the window elapses', () => {
    for (let i = 0; i < 5; i++) check('1.2.3.4', 5, 100)
    expect(check('1.2.3.4', 5, 100).allowed).toBe(false)
    const now = Date.now()
    while (Date.now() - now < 150) { /* spin */ }
    expect(check('1.2.3.4', 5, 100).allowed).toBe(true)
  })
})
