import { describe, it, expect } from 'vitest'

describe('phase 1 smoke', () => {
  it('exports an auth handler shape', async () => {
    process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5432/db'
    process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret'
    process.env.AUTH_GOOGLE_ID ??= 'test'
    process.env.AUTH_GOOGLE_SECRET ??= 'test'
    process.env.RESEND_API_KEY ??= 'test'

    const mod = await import('../src/lib/auth')
    expect(typeof mod.auth).toBe('function')
    expect(mod.handlers).toBeDefined()
    expect(typeof mod.handlers.GET).toBe('function')
    expect(typeof mod.handlers.POST).toBe('function')
    expect(typeof mod.signIn).toBe('function')
    expect(typeof mod.signOut).toBe('function')
  })

  it('exposes password helpers', async () => {
    const mod = await import('../src/lib/password')
    expect(typeof mod.hashPassword).toBe('function')
    expect(typeof mod.verifyPassword).toBe('function')
  })

  it('exposes reset-token helpers', async () => {
    const mod = await import('../src/lib/reset-tokens')
    expect(typeof mod.generateRawToken).toBe('function')
    expect(typeof mod.hashToken).toBe('function')
    expect(typeof mod.createResetToken).toBe('function')
    expect(typeof mod.consumeResetToken).toBe('function')
  })

  it('exposes the operator allow-list check', async () => {
    const mod = await import('../src/lib/operators')
    expect(typeof mod.isUserOperator).toBe('function')
  })
})
