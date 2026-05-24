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
    // Track resolution order. Both should be awaited together — if they
    // were sequential the second mock would never be invoked before the
    // first resolves.
    queryMock.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ rows: [{ count: '2' }] }), 10)))
    rangeMock.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: [], error: null }), 10)))
    const start = Date.now()
    await getNeedsReviewCounts()
    const elapsed = Date.now() - start
    // Sequential would be ~20ms, parallel ~10ms. Leave headroom for CI jitter.
    expect(elapsed).toBeLessThan(18)
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(rangeMock).toHaveBeenCalledTimes(1)
  })
})
