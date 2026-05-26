// apps/ops/src/app/api/internal/player-equipment/__tests__/post-auto-end.test.ts
// Tests for POST /api/internal/player-equipment. Locks the auto-end-previous
// behavior introduced in Task B4 along with the backdate guard and notes
// pass-through. Covers:
//   - Same-day auto-end: when an active row exists, its ended_at is set to
//     the new started_at BEFORE the new row is inserted (contiguous history,
//     no overlap, no one-day gap).
//   - Backdate guard: rejects 400 when the proposed started_at is earlier
//     than the current active row's started_at (would write ended_at <
//     started_at and corrupt history).
//   - Notes pass-through: the optional notes field lands on the insert payload.
//   - First-time assignment: no active row → skip the update step, just insert.
//   - Auth gate: 401 when no operator session.
//
// Mocks: Auth.js + Supabase. The Supabase mock is a single dispatcher that
// returns one query stub per .from('player_equipment') call so tests can
// distinguish the "select active row" call from the "update auto-end" call
// from the "insert new row" call. Each stub records its terminal payload
// (select/update/insert args) for assertions.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, serviceClientMock, fromCalls } = vi.hoisted(() => ({
  authMock: vi.fn(),
  serviceClientMock: vi.fn(),
  fromCalls: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/supabase', () => ({ serviceClient: serviceClientMock }))

import { POST } from '../route'

// Build a chainable Supabase query stub. The route uses three distinct chains:
//   1. .from(...).select(...).eq(...).is(...).maybeSingle()  → active-row lookup
//   2. .from(...).update(...).eq(...).is(...)                → auto-end-previous
//   3. .from(...).insert(...).select(...).single()           → new assignment
// `maybeSingleResult` is returned from .maybeSingle() (used by chain 1).
// `singleResult`     is returned from .single()     (used by chain 3).
// Chain 2 resolves via the thenable when awaited after .is().
function buildQueryStub(opts: {
  maybeSingleResult?: { data?: unknown; error?: unknown }
  singleResult?: { data?: unknown; error?: unknown }
  thenResult?: { data?: unknown; error?: unknown }
} = {}) {
  const stub: Record<string, unknown> = {}
  // Chainable methods all return the stub
  for (const k of ['select', 'eq', 'is', 'update', 'insert'] as const) {
    stub[k] = vi.fn(() => stub)
  }
  // Terminal-ish methods
  stub.maybeSingle = vi.fn(() =>
    Promise.resolve(opts.maybeSingleResult ?? { data: null, error: null }),
  )
  stub.single = vi.fn(() =>
    Promise.resolve(opts.singleResult ?? { data: null, error: null }),
  )
  // Awaitable directly (for chain 2: .update().eq().is() — no terminal)
  stub.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(opts.thenResult ?? { data: null, error: null }).then(onFulfilled)
  return stub
}

beforeEach(() => {
  authMock.mockReset()
  serviceClientMock.mockReset()
  fromCalls.length = 0
  authMock.mockResolvedValue({ user: { id: 'operator-1', isOperator: true } })
})

// Build a multi-call dispatcher. Each call to .from('player_equipment') pops
// the next stub from `stubs` and returns it. This lets each test stage all
// three expected calls (select / update / insert) in order.
function installFromSequence(stubs: Array<Record<string, unknown>>) {
  let i = 0
  serviceClientMock.mockReturnValue({
    from: (table: string) => {
      if (table !== 'player_equipment') {
        throw new Error(`Unexpected table: ${table}`)
      }
      const stub = stubs[i]
      if (!stub) {
        throw new Error(`No stub registered for .from() call #${i + 1}`)
      }
      fromCalls.push(stub)
      i++
      return stub
    },
  })
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/internal/player-equipment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/internal/player-equipment', () => {
  it('updates active row ended_at to new started_at before inserting (same-day auto-end)', async () => {
    const selectStub = buildQueryStub({
      maybeSingleResult: { data: { started_at: '2025-01-01' }, error: null },
    })
    const updateStub = buildQueryStub({ thenResult: { data: null, error: null } })
    const insertStub = buildQueryStub({
      singleResult: { data: { id: 'eq-new' }, error: null },
    })
    installFromSequence([selectStub, updateStub, insertStub])

    const res = await POST(
      makeRequest({
        player_id: 'p1',
        racket_id: 'r1',
        started_at: '2026-05-22',
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ assignment: { id: 'eq-new' } })

    // Auto-end: update was called with ended_at == new started_at
    expect(updateStub.update).toHaveBeenCalledTimes(1)
    const updateArg = (updateStub.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>
    expect(updateArg).toEqual({ ended_at: '2026-05-22' })
    // ...filtered to this player + only the active (null ended_at) row
    expect(updateStub.eq).toHaveBeenCalledWith('player_id', 'p1')
    expect(updateStub.is).toHaveBeenCalledWith('ended_at', null)

    // Insert: new row carries the same started_at
    expect(insertStub.insert).toHaveBeenCalledTimes(1)
    const insertArg = (insertStub.insert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>
    expect(insertArg).toMatchObject({
      player_id: 'p1',
      racket_id: 'r1',
      started_at: '2026-05-22',
      ended_at: null,
    })
  })

  it('rejects 400 when started_at is earlier than active row started_at (backdate guard)', async () => {
    const selectStub = buildQueryStub({
      maybeSingleResult: { data: { started_at: '2025-01-01' }, error: null },
    })
    // No update/insert stubs — if the route reaches them, the dispatcher throws
    installFromSequence([selectStub])

    const res = await POST(
      makeRequest({
        player_id: 'p1',
        racket_id: 'r1',
        started_at: '2024-06-01',
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Cannot create assignment/i)
    expect(body.error).toContain('2024-06-01')
    expect(body.error).toContain('2025-01-01')

    // No write side-effects on the rejection path
    expect(selectStub.update).not.toHaveBeenCalled()
    expect(selectStub.insert).not.toHaveBeenCalled()
  })

  it('persists notes field on insert', async () => {
    const selectStub = buildQueryStub({
      maybeSingleResult: { data: null, error: null },
    })
    const updateStub = buildQueryStub({ thenResult: { data: null, error: null } })
    const insertStub = buildQueryStub({
      singleResult: { data: { id: 'eq-new' }, error: null },
    })
    installFromSequence([selectStub, updateStub, insertStub])

    const res = await POST(
      makeRequest({
        player_id: 'p1',
        racket_id: 'r1',
        started_at: '2026-05-22',
        notes: 'switched after injury',
      }),
    )
    expect(res.status).toBe(200)

    const insertArg = (insertStub.insert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>
    expect(insertArg.notes).toBe('switched after injury')
  })

  it('handles no current active row (first-time assignment)', async () => {
    const selectStub = buildQueryStub({
      maybeSingleResult: { data: null, error: null },
    })
    // Update still runs against zero rows (no-op at the DB level) — that's
    // the route's current shape. We just need to confirm the insert lands
    // and the backdate guard doesn't fire when no active row exists.
    const updateStub = buildQueryStub({ thenResult: { data: null, error: null } })
    const insertStub = buildQueryStub({
      singleResult: { data: { id: 'eq-new' }, error: null },
    })
    installFromSequence([selectStub, updateStub, insertStub])

    const res = await POST(
      makeRequest({
        player_id: 'p1',
        racket_id: 'r1',
        started_at: '2024-06-01', // would be backdated IF there was an active row
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ assignment: { id: 'eq-new' } })

    // Insert ran with the requested started_at
    expect(insertStub.insert).toHaveBeenCalledTimes(1)
    const insertArg = (insertStub.insert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>
    expect(insertArg).toMatchObject({
      player_id: 'p1',
      racket_id: 'r1',
      started_at: '2024-06-01',
      ended_at: null,
      notes: null,
    })
  })

  it('returns 401 on no session', async () => {
    authMock.mockResolvedValueOnce(null)
    const res = await POST(
      makeRequest({ player_id: 'p1', racket_id: 'r1' }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('returns 400 when required fields are missing', async () => {
    // Sanity coverage: route validates player_id + racket_id before any DB call.
    const res = await POST(makeRequest({ player_id: 'p1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Missing required fields/i)
  })
})
