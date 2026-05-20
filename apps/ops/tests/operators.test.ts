import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pgPool — operators.ts queries through it.
const queryMock = vi.fn()
vi.mock('../src/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

import { isUserOperator } from '../src/lib/operators'

describe('isUserOperator', () => {
  beforeEach(() => queryMock.mockReset())

  it('returns true when a row exists', async () => {
    queryMock.mockResolvedValue({ rowCount: 1, rows: [{ '?column?': 1 }] })
    const r = await isUserOperator('00000000-0000-0000-0000-000000000001')
    expect(r).toBe(true)
    expect(queryMock).toHaveBeenCalledWith(
      'select 1 from public.operators where user_id = $1 limit 1',
      ['00000000-0000-0000-0000-000000000001'],
    )
  })

  it('returns false when no row exists', async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] })
    expect(await isUserOperator('any')).toBe(false)
  })

  it('returns false on a falsy userId', async () => {
    expect(await isUserOperator(undefined)).toBe(false)
    expect(await isUserOperator(null as unknown as string)).toBe(false)
    expect(await isUserOperator('')).toBe(false)
    expect(queryMock).not.toHaveBeenCalled()
  })
})
