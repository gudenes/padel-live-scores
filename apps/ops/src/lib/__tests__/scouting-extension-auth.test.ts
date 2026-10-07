import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { issueScoutingProof, verifyScoutingProof } from '../scouting-extension-auth'
const origin = 'chrome-extension://' + 'a'.repeat(32)
beforeEach(() => vi.stubEnv('AUTH_SECRET', 'test-secret-for-scouting'))
afterEach(() => vi.unstubAllEnvs())
it('binds the proof to the logged-in user, extension and expiry', () => {
  const { token, expiresAt } = issueScoutingProof('operator', origin, 1000)
  expect(verifyScoutingProof(token, 'operator', origin, 1001)).toBe(true)
  expect(verifyScoutingProof(token, 'another-user', origin, 1001)).toBe(false)
  expect(verifyScoutingProof(token, 'operator', origin.replaceAll('a', 'b'), 1001)).toBe(false)
  expect(verifyScoutingProof(token, 'operator', origin, expiresAt)).toBe(false)
  expect(verifyScoutingProof(token, 'operator', 'https://evil.test', 1001)).toBe(false)
})
it('rejects tampering, missing configuration and malformed tokens', () => {
  const { token } = issueScoutingProof('operator', origin)
  expect(verifyScoutingProof(token.slice(0, -5) + 'XXXXX', 'operator', origin)).toBe(false)
  expect(verifyScoutingProof('garbage', 'operator', origin)).toBe(false)
  expect(verifyScoutingProof(token + '.extra', 'operator', origin)).toBe(false)
  expect(() => issueScoutingProof('operator', 'https://evil.test')).toThrow()
  vi.stubEnv('AUTH_SECRET', '')
  expect(() => issueScoutingProof('operator', origin)).toThrow()
  expect(verifyScoutingProof(token, 'operator', origin)).toBe(false)
})
