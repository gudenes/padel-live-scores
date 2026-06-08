import { describe, it, expect } from 'vitest'
import { assessRankingsHealth, isoYearWeek, weekToDate } from '@/lib/rankings-health'

// Reference anchors (computed with the worker's isoYearWeek):
//   2026-06-08 (Mon) → ISO 2026-W24
//   2026-06-10 (Wed) → ISO 2026-W24
//   2026-06-01 (Mon) → ISO 2026-W23
const FULL = { official_men: 1000, official_women: 1000, race_men: 137, race_women: 130 }

describe('isoYearWeek (mirrors worker)', () => {
  it('maps known dates to ISO weeks', () => {
    expect(isoYearWeek(new Date('2026-06-08T09:00:00Z'))).toEqual({ year: 2026, week: 24 })
    expect(isoYearWeek(new Date('2026-06-01T00:00:00Z'))).toEqual({ year: 2026, week: 23 })
  })
})

describe('weekToDate (mirrors worker)', () => {
  it('returns ISO Mondays', () => {
    expect(weekToDate(2026, 24)).toBe('2026-06-08')
    expect(weekToDate(2026, 23)).toBe('2026-06-01')
  })
})

describe('assessRankingsHealth', () => {
  it('unknown when no snapshots', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-10T09:00:00Z'),
      latestYear: null, latestWeek: null, latestRankingDate: null,
      maxCapturedAt: null, buckets: { official_men: 0, official_women: 0, race_men: 0, race_women: 0 },
    })
    expect(r.status).toBe('unknown')
  })

  it('error when last capture older than 9 days', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-10T09:00:00Z'),
      latestYear: 2026, latestWeek: 24, latestRankingDate: '2026-06-08',
      maxCapturedAt: '2026-05-30T09:00:00Z', // 11 days
      buckets: FULL,
    })
    expect(r.status).toBe('error')
    expect(r.error_message).toMatch(/worker may be down/)
  })

  it('ok when current ISO week captured with all buckets', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-10T09:00:00Z'), // W24
      latestYear: 2026, latestWeek: 24, latestRankingDate: '2026-06-08',
      maxCapturedAt: '2026-06-08T08:00:00Z',
      buckets: FULL,
    })
    expect(r.status).toBe('ok')
    expect(r.meta.weeks_behind).toBe(0)
    expect(r.meta.latest_week).toBe('2026-W24')
    expect(r.meta.current_week).toBe('2026-W24')
  })

  it('partial when current week captured but a bucket is empty', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-10T09:00:00Z'),
      latestYear: 2026, latestWeek: 24, latestRankingDate: '2026-06-08',
      maxCapturedAt: '2026-06-08T08:00:00Z',
      buckets: { ...FULL, race_women: 0 },
    })
    expect(r.status).toBe('partial')
    expect(r.error_message).toMatch(/race_women/)
  })

  it('partial (grace) when one week behind on a Monday', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-08T09:00:00Z'), // Mon, W24
      latestYear: 2026, latestWeek: 23, latestRankingDate: '2026-06-01',
      maxCapturedAt: '2026-06-08T08:00:00Z',
      buckets: FULL,
    })
    expect(r.status).toBe('partial')
    expect(r.meta.weeks_behind).toBe(1)
    expect(r.error_message).toMatch(/Awaiting current week/)
  })

  it('error when one week behind mid-week (Wednesday)', () => {
    const r = assessRankingsHealth({
      now: new Date('2026-06-10T09:00:00Z'), // Wed, W24
      latestYear: 2026, latestWeek: 23, latestRankingDate: '2026-06-01',
      maxCapturedAt: '2026-06-08T08:00:00Z',
      buckets: FULL,
    })
    expect(r.status).toBe('error')
    expect(r.error_message).toMatch(/not captured/)
  })
})
