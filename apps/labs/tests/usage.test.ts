import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockChain = {
  eq: vi.fn(function (this: any) {
    return this
  }),
  gte: vi.fn(() => ({ then: (cb: any) => cb({ count: 0, error: null }) })),
}

const mockSelect = vi.fn(() => mockChain)
const mockInsert = vi.fn()
const mockDelete = vi.fn(() => ({
  eq: vi.fn(() => Promise.resolve({ error: null })),
}))
const mockSupabase = {
  from: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
  })),
}

vi.mock('../src/lib/db', () => ({
  supabaseService: () => mockSupabase,
  pgPool: () => ({}),
  supabaseAnon: {},
}))

import { checkUsage, recordUsage, FREE_DAILY_QUOTA } from '../src/lib/usage'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkUsage', () => {
  it('allows when count is 0', async () => {
    mockChain.gte.mockReturnValue({
      then: (cb: any) => cb({ count: 0, error: null }),
    })

    const r = await checkUsage({ userId: 'u1' })
    expect(r.allowed).toBe(true)
    expect(r.used).toBe(0)
    expect(r.quota).toBe(FREE_DAILY_QUOTA)
  })

  it('denies when count >= quota', async () => {
    mockChain.gte.mockReturnValue({
      then: (cb: any) => cb({ count: FREE_DAILY_QUOTA, error: null }),
    })

    const r = await checkUsage({ userId: 'u1' })
    expect(r.allowed).toBe(false)
    expect(r.used).toBe(FREE_DAILY_QUOTA)
    expect(r.quota).toBe(FREE_DAILY_QUOTA)
  })

  it('does NOT call insert — it is the gate only', async () => {
    mockChain.gte.mockReturnValue({
      then: (cb: any) => cb({ count: 0, error: null }),
    })

    await checkUsage({ userId: 'u1' })
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

describe('recordUsage', () => {
  it('calls insert on success', async () => {
    // First gte call (post-insert recount): under quota
    mockChain.gte.mockReturnValue({
      then: (cb: any) => cb({ count: 1, error: null }),
    })
    mockInsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: { id: 'evt-1' }, error: null })),
      })),
    })

    await recordUsage({ userId: 'u1' })
    expect(mockInsert).toHaveBeenCalledOnce()
  })

  it('deletes the inserted row when post-insert count exceeds quota (race guard)', async () => {
    // Post-insert recount shows over quota
    mockChain.gte.mockReturnValue({
      then: (cb: any) => cb({ count: FREE_DAILY_QUOTA + 1, error: null }),
    })
    const mockEq = vi.fn(() => Promise.resolve({ error: null }))
    mockDelete.mockReturnValue({ eq: mockEq })
    mockInsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: { id: 'evt-race' }, error: null })),
      })),
    })

    await recordUsage({ userId: 'u1' })
    expect(mockDelete).toHaveBeenCalledOnce()
    expect(mockEq).toHaveBeenCalledWith('id', 'evt-race')
  })
})
