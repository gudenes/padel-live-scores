import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/lib/password'

describe('password helpers', () => {
  it('hashes a password and produces a string with a bcrypt prefix', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(typeof hash).toBe('string')
    expect(hash.startsWith('$2')).toBe(true) // bcrypt prefix
    expect(hash.length).toBeGreaterThan(50)
  })

  it('verifies the correct password against its hash', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('wrong password', hash)).toBe(false)
  })

  it('verifyPassword returns false for null/empty hashes (OAuth-only users)', async () => {
    expect(await verifyPassword('anything', null)).toBe(false)
    expect(await verifyPassword('anything', '')).toBe(false)
  })
})
