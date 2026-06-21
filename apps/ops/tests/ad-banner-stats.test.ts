// apps/ops/tests/ad-banner-stats.test.ts
import { describe, it, expect } from 'vitest'
import { mergeBannerStats, formatCount, formatCtr } from '../src/lib/ad-banner-stats'

describe('formatCount', () => {
  it('adds thousands separators', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
  })
  it('renders zero as 0', () => {
    expect(formatCount(0)).toBe('0')
  })
})

describe('formatCtr', () => {
  it('returns an em dash when there are no impressions', () => {
    expect(formatCtr(0, 0)).toBe('—')
    expect(formatCtr(5, 0)).toBe('—')
  })
  it('formats a percentage with one decimal', () => {
    expect(formatCtr(3, 100)).toBe('3.0%')
  })
  it('rounds to one decimal', () => {
    expect(formatCtr(1, 3)).toBe('33.3%')
  })
  it('returns 0.0% when there are clicks-less impressions', () => {
    expect(formatCtr(0, 100)).toBe('0.0%')
  })
})

describe('mergeBannerStats', () => {
  it('merges counts onto banners by id', () => {
    const banners = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    const stats = [
      { banner_id: 'a', impressions: 10, clicks: 2 },
      { banner_id: 'b', impressions: 0, clicks: 0 },
    ]
    expect(mergeBannerStats(banners, stats)).toEqual([
      { id: 'a', name: 'A', impressions: 10, clicks: 2 },
      { id: 'b', name: 'B', impressions: 0, clicks: 0 },
    ])
  })
  it('zero-fills banners with no stats row', () => {
    const result = mergeBannerStats([{ id: 'x' }], [])
    expect(result).toEqual([{ id: 'x', impressions: 0, clicks: 0 }])
  })
  it('coerces string counts (pg bigint) to numbers', () => {
    const result = mergeBannerStats(
      [{ id: 'a' }],
      [{ banner_id: 'a', impressions: '42' as unknown as number, clicks: '7' as unknown as number }],
    )
    expect(result[0]).toEqual({ id: 'a', impressions: 42, clicks: 7 })
  })
})
