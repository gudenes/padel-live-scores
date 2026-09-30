// apps/ops/tests/growth-queries-missing-table.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../src/lib/db', () => ({ pgPool: () => ({ query: queryMock }) }))

import { getLatestPosthogSnapshot, getDauSeries, getActiveHistory } from '../src/lib/growth/growth-queries'

const missing = () => Object.assign(new Error('relation "public.growth_snapshots" does not exist'), { code: '42P01' })

describe('growth_snapshots reads before the migration is applied', () => {
  beforeEach(() => { queryMock.mockReset() })

  it('return empty results on undefined_table', async () => {
    queryMock.mockImplementation(async () => { throw missing() })
    expect(await getLatestPosthogSnapshot()).toBeNull()
    expect(await getDauSeries(30)).toEqual([])
    expect(await getActiveHistory(90)).toEqual([])
  })

  it('still throws other database errors', async () => {
    queryMock.mockImplementation(async () => { throw Object.assign(new Error('boom'), { code: '08006' }) })
    await expect(getDauSeries(30)).rejects.toThrow('boom')
  })
})
