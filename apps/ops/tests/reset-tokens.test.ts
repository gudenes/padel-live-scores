import { describe, it, expect } from 'vitest'
import { generateRawToken, hashToken } from '../src/lib/reset-tokens'

describe('reset-tokens helpers', () => {
  it('generateRawToken produces a 64-char url-safe string', () => {
    const t = generateRawToken()
    expect(typeof t).toBe('string')
    expect(t.length).toBeGreaterThanOrEqual(43)
    expect(t.length).toBeLessThanOrEqual(86)
    expect(/^[A-Za-z0-9_-]+$/.test(t)).toBe(true)
  })

  it('two raw tokens are different', () => {
    expect(generateRawToken()).not.toBe(generateRawToken())
  })

  it('hashToken is deterministic and SHA-256 length', () => {
    const t = 'fixed-input-token'
    const h1 = hashToken(t)
    const h2 = hashToken(t)
    expect(h1).toBe(h2)
    expect(h1.length).toBe(64) // sha256 hex
    expect(/^[0-9a-f]+$/.test(h1)).toBe(true)
  })

  it('hashToken differs for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })
})
