// apps/ops/tests/growth-beta-signups.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../src/lib/db', () => ({ pgPool: () => ({ query: queryMock }) }))

import { getBetaSignupStats } from '../src/lib/growth/beta-signups'
import { daysUntil } from '../src/lib/growth/growth-compute'
import { BETA_SIGNUPS_CLOSE_AT, betaSignupsClosed } from '../src/../../../src/lib/beta-schedule'

describe('beta campaign close date', () => {
  it('is the end of October 7 in Madrid', () => {
    expect(Date.parse(BETA_SIGNUPS_CLOSE_AT)).toBe(Date.parse('2026-10-07T21:59:59Z'))
  })
  it('stays open on Oct 7 evening and closes right after', () => {
    expect(betaSignupsClosed(Date.parse('2026-10-07T21:59:58Z'))).toBe(false)
    expect(betaSignupsClosed(Date.parse('2026-10-07T21:59:59Z'))).toBe(true)
  })
})

describe('daysUntil', () => {
  it('rounds up and floors at 0', () => {
    expect(daysUntil('2026-10-07T21:59:59Z', Date.parse('2026-09-30T21:59:59Z'))).toBe(7)
    expect(daysUntil('2026-10-07T21:59:59Z', Date.parse('2026-10-07T20:00:00Z'))).toBe(1)
    expect(daysUntil('2026-10-07T21:59:59Z', Date.parse('2026-10-08T00:00:00Z'))).toBe(0)
  })
})

describe('getBetaSignupStats', () => {
  beforeEach(() => { queryMock.mockReset() })

  it('returns aggregates only', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: 14, last24h: 2, with_whatsapp: 5 }] })
      .mockResolvedValueOnce({ rows: [{ day: '2026-09-30', n: 2 }] })
      .mockResolvedValueOnce({ rows: [{ language: 'es', n: 8 }] })
    expect(await getBetaSignupStats(30)).toEqual({
      total: 14, last24h: 2, withWhatsapp: 5,
      byDay: [{ day: '2026-09-30', n: 2 }], byLanguage: [{ language: 'es', n: 8 }],
    })
    for (const call of queryMock.mock.calls) expect(String(call[0])).not.toMatch(/\b(email|name|whatsapp\s*,|select\s+whatsapp)\b/i)
  })

  it('returns null when the table is missing, rethrows other errors', async () => {
    queryMock.mockImplementation(async () => { throw Object.assign(new Error('x'), { code: '42P01' }) })
    expect(await getBetaSignupStats(30)).toBeNull()
    queryMock.mockImplementation(async () => { throw Object.assign(new Error('boom'), { code: '08006' }) })
    await expect(getBetaSignupStats(30)).rejects.toThrow('boom')
  })
})
