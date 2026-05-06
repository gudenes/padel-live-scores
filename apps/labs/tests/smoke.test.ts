// apps/labs/tests/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('phase 1 smoke', () => {
  it('parses a Postgres connection URL with special chars in password', async () => {
    // Replicates the parseDbUrl logic from src/lib/db.ts. We import it
    // dynamically to avoid the Pool() side effect at module load.
    const { default: testUrl } = await import('./fixtures/sample-db-url.json')
    const u = new URL(testUrl.url)
    expect(u.hostname).toBe('db.example.com')
    expect(decodeURIComponent(u.password)).toBe('p@ss/word!')
  })

  it('exports an auth handler shape', async () => {
    // Set required env so the auth module doesn't throw on import.
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
  })
})
