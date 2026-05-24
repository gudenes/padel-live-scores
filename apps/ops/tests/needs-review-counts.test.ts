import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn()
const rangeMock = vi.fn()

vi.mock('../src/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

vi.mock('../src/lib/supabase', () => ({
  serviceClient: () => ({
    from: () => ({
      select: () => ({
        range: rangeMock,
      }),
    }),
  }),
}))

import { getNeedsReviewCounts } from '../src/lib/needs-review-counts'

describe('getNeedsReviewCounts', () => {
  beforeEach(() => {
    queryMock.mockReset()
    rangeMock.mockReset()
  })

  it('returns the duplicate-cluster count from the query', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '5' }] })
    rangeMock.mockResolvedValue({ data: [], error: null })
    const r = await getNeedsReviewCounts()
    expect(r.duplicates).toBe(5)
  })

  it('returns 0 when no clusters exist', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '0' }] })
    rangeMock.mockResolvedValue({ data: [], error: null })
    const r = await getNeedsReviewCounts()
    expect(r.duplicates).toBe(0)
    expect(r.duplicatePlayers).toBe(0)
  })

  it('coerces null/undefined count to 0', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: null }] })
    rangeMock.mockResolvedValue({ data: [], error: null })
    const r = await getNeedsReviewCounts()
    expect(r.duplicates).toBe(0)
  })

  it('issues exactly one tournament query', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '3' }] })
    rangeMock.mockResolvedValue({ data: [], error: null })
    await getNeedsReviewCounts()
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('returns both duplicates and duplicatePlayers when present', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '7' }] })
    rangeMock.mockResolvedValue({
      data: [
        { id: '1', name: 'Paula', country: 'ES', ranking: null, points: null, category: null, avatar_url: null, fip_id: 'P1', external_id: null },
        { id: '2', name: 'Paula', country: 'ES', ranking: null, points: null, category: null, avatar_url: null, fip_id: 'P1', external_id: null },
      ],
      error: null,
    })
    const r = await getNeedsReviewCounts()
    expect(r.duplicates).toBe(7)
    expect(r.duplicatePlayers).toBe(1)
  })

  it('returns 0 duplicatePlayers when no players have collisions', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '0' }] })
    rangeMock.mockResolvedValue({ data: [], error: null })
    const r = await getNeedsReviewCounts()
    expect(r.duplicates).toBe(0)
    expect(r.duplicatePlayers).toBe(0)
  })

  it('returns 0 duplicatePlayers when supabase errors', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '3' }] })
    rangeMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const r = await getNeedsReviewCounts()
    expect(r.duplicates).toBe(3)
    expect(r.duplicatePlayers).toBe(0)
  })

  it('runs both queries in parallel via Promise.all', async () => {
    // Assert START timestamps are within a few ms of each other — not that
    // total elapsed time is under a threshold (flaky on CI). If the calls
    // were sequential, the second start would be ~20ms after the first.
    const callTimestamps: { source: 'pg' | 'supabase'; t: number }[] = []
    queryMock.mockImplementation(async () => {
      callTimestamps.push({ source: 'pg', t: Date.now() })
      await new Promise(r => setTimeout(r, 20))
      return { rows: [{ count: '2' }] }
    })
    rangeMock.mockImplementation(async () => {
      callTimestamps.push({ source: 'supabase', t: Date.now() })
      await new Promise(r => setTimeout(r, 20))
      return { data: [], error: null }
    })
    await getNeedsReviewCounts()
    // Both must have started before either finished — i.e. the start-time gap
    // must be much less than the 20ms each call takes.
    expect(callTimestamps).toHaveLength(2)
    const gap = Math.abs(callTimestamps[1].t - callTimestamps[0].t)
    expect(gap).toBeLessThan(5) // well under the 20ms each call takes
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(rangeMock).toHaveBeenCalledTimes(1)
  })
})
