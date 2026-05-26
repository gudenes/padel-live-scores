// apps/ops/src/app/api/internal/player-equipment/[id]/__tests__/delete.test.ts
// Tests for DELETE /api/internal/player-equipment/[id]. Two modes:
//   - ?end=true  → soft-end: UPDATE ended_at = today (preserve history)
//   - (default)  → hard delete: DELETE the row outright
//
// Both modes are idempotent — Supabase returns no error when zero rows match
// the .eq() filter, so we don't bother with an existence pre-check.
//
// Mocks: Auth.js + Supabase. Supabase mock dispatches by table name, mirroring
// the aggregator.test.ts pattern from Task A1. Every assertion captures BOTH
// the mutation argument (update payload / delete call) AND the .eq('id', ...)
// value so a regression that drops the .eq() filter would fail loudly.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock, tableHandlers } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  tableHandlers: new Map<string, () => unknown>(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { DELETE } from '../route'

beforeEach(() => {
  authMock.mockReset()
  serviceClientMock.mockReset()
  tableHandlers.clear()
  serviceClientMock.mockReturnValue({
    from: (table: string) => {
      const handler = tableHandlers.get(table)
      if (!handler) {
        throw new Error(`No stub registered for table: ${table}`)
      }
      return handler()
    },
  })
  authMock.mockResolvedValue({ user: { id: 'operator-1', isOperator: true } })
})

// Chainable Supabase query stub. `eq()` is the final step in both code paths
// (.update().eq() and .delete().eq()), so we resolve to `result` when awaited
// after eq() is called. Tracks calls so tests can assert on update/delete/eq.
function buildQueryStub(result: { data?: unknown; error?: unknown }) {
  const stub: Record<string, unknown> = {}
  stub.update = vi.fn(() => stub)
  stub.delete = vi.fn(() => stub)
  stub.eq = vi.fn(() => stub)
  stub.select = vi.fn(() => stub)
  stub.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled)
  return stub
}

function makeRequest(
  url = 'http://localhost/api/internal/player-equipment/eq-1',
  init?: RequestInit,
): Request {
  return new Request(url, { method: 'DELETE', ...init })
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('DELETE /api/internal/player-equipment/[id]', () => {
  it('?end=true → updates ended_at to today (YYYY-MM-DD) and uses .eq(id)', async () => {
    const chain = buildQueryStub({ data: null, error: null })
    tableHandlers.set('player_equipment', () => chain)

    const res = await DELETE(
      makeRequest('http://localhost/api/internal/player-equipment/eq-1?end=true'),
      makeCtx('eq-1'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // 1. update() was called with { ended_at: <today YYYY-MM-DD> }
    expect(chain.update).toHaveBeenCalledTimes(1)
    const updateArg = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(updateArg.ended_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Sanity: matches today's UTC date (allow ±1 day for runtime tz drift around midnight)
    const today = new Date().toISOString().slice(0, 10)
    expect(updateArg.ended_at).toBe(today)

    // 2. .eq('id', 'eq-1') was applied — must guard against regressions
    //    where the filter is forgotten and update runs against the whole table.
    expect(chain.eq).toHaveBeenCalledWith('id', 'eq-1')

    // 3. delete() was NOT called on the soft-end path
    expect(chain.delete).not.toHaveBeenCalled()
  })

  it('no ?end query → hard-deletes the row and uses .eq(id)', async () => {
    const chain = buildQueryStub({ data: null, error: null })
    tableHandlers.set('player_equipment', () => chain)

    const res = await DELETE(
      makeRequest('http://localhost/api/internal/player-equipment/eq-1'),
      makeCtx('eq-1'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // 1. delete() was called (no payload — Supabase .delete() takes no args)
    expect(chain.delete).toHaveBeenCalledTimes(1)
    // 2. .eq('id', 'eq-1') was applied
    expect(chain.eq).toHaveBeenCalledWith('id', 'eq-1')
    // 3. update() was NOT called on the hard-delete path
    expect(chain.update).not.toHaveBeenCalled()
  })

  it('returns 401 when the caller is not an operator', async () => {
    authMock.mockResolvedValue(null)
    const res = await DELETE(
      makeRequest('http://localhost/api/internal/player-equipment/eq-1?end=true'),
      makeCtx('eq-1'),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('returns 500 with Supabase error message when the update fails', async () => {
    const chain = buildQueryStub({ data: null, error: { message: 'db down' } })
    tableHandlers.set('player_equipment', () => chain)

    const res = await DELETE(
      makeRequest('http://localhost/api/internal/player-equipment/eq-1?end=true'),
      makeCtx('eq-1'),
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'db down' })
  })
})
