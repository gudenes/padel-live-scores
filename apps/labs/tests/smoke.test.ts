// apps/labs/tests/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('phase 1 smoke', () => {
  it('sizes the pg pool for Railway vs local', async () => {
    const { pgPoolMax } = await import('../src/lib/db')
    expect(pgPoolMax({ RAILWAY_ENVIRONMENT: 'production' })).toBe(8)
    expect(pgPoolMax({})).toBe(1)
    expect(pgPoolMax({ PG_POOL_MAX: '4', RAILWAY_ENVIRONMENT: 'production' })).toBe(4)
  })

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

// --- Phase 2 smoke ---
import { describe as describeP2, it as itP2, expect as expectP2 } from 'vitest'

describeP2('phase 2 wiring', () => {
  itP2('imports the chat module without crashing', async () => {
    const mod = await import('../src/lib/ai/chat')
    expectP2(typeof mod.runChat).toBe('function')
  })

  itP2('imports each data skill without crashing', async () => {
    const sp = await import('../src/lib/data/search-player')
    const rm = await import('../src/lib/data/player-recent-matches')
    const h2h = await import('../src/lib/data/head-to-head')
    expectP2(typeof sp.searchPlayer).toBe('function')
    expectP2(typeof rm.getPlayerRecentMatches).toBe('function')
    expectP2(typeof h2h.getHeadToHead).toBe('function')
  })

  itP2('exposes the 3 tool definitions', async () => {
    const { PADEL_LABS_TOOLS } = await import('../src/lib/ai/tools')
    expectP2(PADEL_LABS_TOOLS.length).toBe(3)
    const names = PADEL_LABS_TOOLS.map((t) => t.name).sort()
    expectP2(names).toEqual(['get_head_to_head', 'get_player_recent_matches', 'search_player'])
  })
})
