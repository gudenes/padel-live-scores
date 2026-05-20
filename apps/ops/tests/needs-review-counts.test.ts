import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn()
vi.mock('../src/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

import { getNeedsReviewCounts } from '../src/lib/needs-review-counts'

describe('getNeedsReviewCounts', () => {
  beforeEach(() => queryMock.mockReset())

  it('returns the duplicate-cluster count from the query', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '5' }] })
    const r = await getNeedsReviewCounts()
    expect(r).toEqual({ duplicates: 5 })
  })

  it('returns 0 when no clusters exist', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '0' }] })
    expect(await getNeedsReviewCounts()).toEqual({ duplicates: 0 })
  })

  it('coerces null/undefined count to 0', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: null }] })
    expect(await getNeedsReviewCounts()).toEqual({ duplicates: 0 })
  })

  it('issues exactly one query', async () => {
    queryMock.mockResolvedValue({ rows: [{ count: '3' }] })
    await getNeedsReviewCounts()
    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})
