// apps/ops/src/app/api/internal/player/[id]/__tests__/aggregator.test.ts
// Tests for the full-profile player aggregator route. Covers:
//   - GET 404 when the player does not exist
//   - GET 200 happy path returning { player, equipment, recentMatches, earnings }
//
// We mock Auth.js + Supabase. The Supabase mock dispatches by table name,
// so each handler can stub a specific .from('<table>') chain. This mirrors
// how the route composes its calls (one per table: players, player_equipment,
// matches, player_tournament_earnings).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock, tableHandlers } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  tableHandlers: new Map<string, () => unknown>(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { GET, PATCH } from '../route'

// Reset state between tests
beforeEach(() => {
  authMock.mockReset()
  serviceClientMock.mockReset()
  tableHandlers.clear()
  // Default Supabase client: dispatches .from(table) to a per-test handler.
  serviceClientMock.mockReturnValue({
    from: (table: string) => {
      const handler = tableHandlers.get(table)
      if (!handler) {
        throw new Error(`No stub registered for table: ${table}`)
      }
      return handler()
    },
  })
  // Default to an authorized operator. Individual tests can override.
  authMock.mockResolvedValue({ user: { id: 'operator-1', isOperator: true } })
})

// Helper: build a chainable Supabase query stub. Every method on the stub
// returns the same stub so callers can chain .select().eq().order().range()
// in any order. Terminal awaits resolve to the configured result.
function buildQueryStub(result: { data?: unknown; error?: unknown; count?: number }) {
  const stub: Record<string, unknown> = {}
  const chainable = ['select', 'eq', 'or', 'order', 'range', 'limit', 'in', 'is', 'ilike']
  const terminal = ['single', 'maybeSingle']
  for (const k of chainable) {
    stub[k] = vi.fn(() => stub)
  }
  for (const k of terminal) {
    stub[k] = vi.fn(() => Promise.resolve(result))
  }
  // Also resolve when awaited directly (no terminal call, e.g. .from(...).select().eq().order())
  stub.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled)
  // Add update() for PATCH path. Returns chainable with .eq() that resolves.
  stub.update = vi.fn(() => stub)
  return stub
}

function makeRequest(url = 'http://localhost/api/internal/player/p1', init?: RequestInit): Request {
  return new Request(url, init)
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/internal/player/[id]', () => {
  it('returns 404 when the player does not exist (null data, null error)', async () => {
    // Defensive fallback path: some clients/mocks return data:null with no error.
    tableHandlers.set('players', () => buildQueryStub({ data: null, error: null }))

    const res = await GET(makeRequest(), makeCtx('p-missing'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toMatchObject({ error: expect.stringMatching(/not found/i) })
  })

  it('returns 404 when PostgREST returns PGRST116 (real "no rows" shape)', async () => {
    // Real PostgREST .single() returns this exact shape when the row is missing.
    // Exercises the `error.code === 'PGRST116'` branch in the route.
    tableHandlers.set('players', () =>
      buildQueryStub({ data: null, error: { code: 'PGRST116', message: 'Not found' } }),
    )

    const res = await GET(makeRequest(), makeCtx('p-missing'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toMatchObject({ error: expect.stringMatching(/not found/i) })
  })

  it('returns 200 with { player, equipment, recentMatches, earnings } on happy path', async () => {
    const player = {
      id: 'p1',
      name: 'Test Player',
      display_name: null,
      country: 'ES',
      category: 'men',
      ranking: 42,
      points: 1234,
      ranking_move: 0,
      race_ranking: null,
      race_points: null,
      race_move: null,
      external_id: 'ext-1',
      fip_id: 'P12345',
      avatar_url: null,
      profile_url: null,
      side: 'right',
      height: 180,
      birthdate: '1995-01-01',
      birthplace: 'Madrid',
      hand: 'right',
      titles: 0,
      finals: 0,
      semifinals: 0,
      win_rate: 0.5,
      total_matches: 100,
      equipment: null,
      public_id: 'plr_abc',
      slug: 'test-player',
      coaches: ['Coach A'],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    }
    const equipment = [
      { id: 'eq1', player_id: 'p1', racket_id: 'r1', started_at: '2026-01-01', ended_at: null,
        racket: { id: 'r1', model: 'Pro V8', year: 2026, brand: { id: 'b1', name: 'Bullpadel', logo_url: null } } },
    ]
    const recentMatches = [
      { id: 'm1', status: 'finished', scheduled_at: '2026-05-10T00:00:00Z',
        tournament: { id: 't1', name: 'Madrid P1', logo_url: null } },
    ]
    const earnings = [
      { id: 'e1', player_id: 'p1', tournament_id: 't1', category: 'men',
        round_eliminated: 'SF', per_player_eur: 12000, source: 'premier_rulebook',
        earned_at: '2026-05-10T00:00:00Z',
        tournament: { name: 'Madrid P1', level: 'P1' } },
    ]

    tableHandlers.set('players', () => buildQueryStub({ data: player, error: null }))
    tableHandlers.set('player_equipment', () => buildQueryStub({ data: equipment, error: null }))
    tableHandlers.set('matches', () => buildQueryStub({ data: recentMatches, error: null }))
    tableHandlers.set('player_tournament_earnings', () => buildQueryStub({ data: earnings, error: null }))

    const res = await GET(makeRequest(), makeCtx('p1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      player: expect.objectContaining({ id: 'p1', name: 'Test Player' }),
      equipment: expect.any(Array),
      recentMatches: expect.any(Array),
      earnings: expect.any(Array),
    })
    expect(body.equipment).toHaveLength(1)
    expect(body.recentMatches).toHaveLength(1)
    expect(body.earnings).toHaveLength(1)
  })

  it('returns 401 when the caller is not an operator', async () => {
    authMock.mockResolvedValue(null)
    const res = await GET(makeRequest(), makeCtx('p1'))
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/internal/player/[id]', () => {
  it('updates allow-listed fields and returns { ok: true }', async () => {
    const updateChain = buildQueryStub({ data: null, error: null })
    tableHandlers.set('players', () => updateChain)

    const res = await PATCH(
      makeRequest('http://localhost/api/internal/player/p1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New Name', country: 'PT', coaches: ['New Coach'] }),
      }),
      makeCtx('p1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(updateChain.update).toHaveBeenCalledTimes(1)
    // Confirm allow-list fields made it through to update()
    const updateArg = (updateChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updateArg).toMatchObject({ name: 'New Name', country: 'PT', coaches: ['New Coach'] })
    expect(updateArg.updated_at).toBeTypeOf('string')
  })

  it('rejects unknown fields with 400', async () => {
    const res = await PATCH(
      makeRequest('http://localhost/api/internal/player/p1', {
        method: 'PATCH',
        body: JSON.stringify({ malicious_field: 'x' }),
      }),
      makeCtx('p1'),
    )
    expect(res.status).toBe(400)
  })

  it('rejects array body payloads with 400', async () => {
    // Arrays satisfy `typeof === 'object'` so a bare Array.isArray check
    // is required to keep them out of the update path.
    const res = await PATCH(
      makeRequest('http://localhost/api/internal/player/p1', {
        method: 'PATCH',
        body: JSON.stringify([{ name: 'x' }]),
      }),
      makeCtx('p1'),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: expect.stringMatching(/empty or invalid/i) })
  })

  it('returns 401 when the caller is not an operator', async () => {
    authMock.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest('http://localhost/api/internal/player/p1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'x' }),
      }),
      makeCtx('p1'),
    )
    expect(res.status).toBe(401)
  })
})
