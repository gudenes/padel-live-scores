import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockChain = {
  eq: vi.fn(function (this: any) {
    return this
  }),
  gte: vi.fn(() => ({ then: (cb: any) => cb({ count: 0, error: null }) })),
}

const mockSelect = vi.fn(() => mockChain)
const mockInsert = vi.fn()
const mockSupabase = {
  from: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
  })),
}

vi.mock('../src/lib/db', () => ({
  supabaseService: () => mockSupabase,
  pgPool: () => ({}),
  supabaseAnon: {},
}))

import { checkAndRecordUsage, FREE_DAILY_QUOTA } from '../src/lib/usage'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkAndRecordUsage', () => {
  it('allows the first request of the day', async () => {
    // Reset the mock chain for this test
    mockChain.gte.mockReturnValue({
      then: (cb: any) => cb({ count: 0, error: null }),
    })
    mockInsert.mockReturnValue({
      then: (cb: any) => cb({ error: null }),
    })

    const r = await checkAndRecordUsage({ userId: 'u1' })
    expect(r.allowed).toBe(true)
    expect(r.used).toBe(1)
    expect(r.quota).toBe(FREE_DAILY_QUOTA)
    expect(mockInsert).toHaveBeenCalledOnce()
  })

  it('denies the 11th request', async () => {
    // Reset the mock chain for this test
    mockChain.gte.mockReturnValue({
      then: (cb: any) => cb({ count: FREE_DAILY_QUOTA, error: null }),
    })

    const r = await checkAndRecordUsage({ userId: 'u1' })
    expect(r.allowed).toBe(false)
    expect(r.used).toBe(FREE_DAILY_QUOTA)
    expect(r.quota).toBe(FREE_DAILY_QUOTA)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
