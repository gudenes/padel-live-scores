import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock, countsMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  countsMock: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

vi.mock('../src/lib/needs-review-counts', () => ({
  getNeedsReviewCounts: countsMock,
}))

import { getTodayPayload } from '../src/lib/today-aggregator'

describe('getTodayPayload', () => {
  beforeEach(() => {
    queryMock.mockReset()
    countsMock.mockReset()
  })

  it('returns a complete payload shape', async () => {
    // Order the queries in the same order the aggregator calls them:
    // (live-count, live-rows, scheduled-today, finished-today, stale, schedule-buckets)
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })       // 1. live count
      .mockResolvedValueOnce({ rows: [] })                      // 2. live rows
      .mockResolvedValueOnce({ rows: [{ count: '12' }] })      // 3. scheduled today
      .mockResolvedValueOnce({ rows: [{ count: '8' }] })       // 4. finished today
      .mockResolvedValueOnce({ rows: [] })                      // 5. stale
      .mockResolvedValueOnce({ rows: [] })                      // 6. schedule buckets
    countsMock.mockResolvedValue({ duplicates: 5 })

    const p = await getTodayPayload()
    expect(p).toMatchObject({
      kpis: expect.objectContaining({
        liveMatches: 3,
        needsReview: 5,
      }),
      liveNow: [],
      requiresAttention: expect.any(Array),
      schedule: [],
      systemStatus: expect.stringMatching(/^(green|yellow|red)$/),
    })
  })

  it('marks systemStatus red when stale matches exist', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'm1', external_id: 'x', updated_at: '2026-05-20T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] })
    countsMock.mockResolvedValue({ duplicates: 0 })

    const p = await getTodayPayload()
    expect(p.systemStatus).toBe('red')
  })

  it('marks systemStatus green with no stale + no urgent flags', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    countsMock.mockResolvedValue({ duplicates: 0 })

    const p = await getTodayPayload()
    expect(p.systemStatus).toBe('green')
  })

  it('requires-attention includes the duplicates count', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    countsMock.mockResolvedValue({ duplicates: 7 })

    const p = await getTodayPayload()
    const dup = p.requiresAttention.find((r) => r.key === 'duplicates')
    expect(dup).toBeDefined()
    expect(dup?.count).toBe(7)
  })
})
