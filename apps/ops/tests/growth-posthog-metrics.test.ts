// apps/ops/tests/growth-posthog-metrics.test.ts
import { describe, it, expect, vi } from 'vitest'
import {
  classifyChannel, parseChannels, parseRetention, parseDauSeries, collectPosthogRows, q,
} from '../src/lib/growth/posthog-metrics'
import { buildRetentionMatrix, weightedRetention } from '../src/lib/growth/growth-compute'

describe('classifyChannel', () => {
  it.each([
    ['', '', 'Direct'],
    ['$direct', '', 'Direct'],
    ['www.google.com', '', 'Organic search'],
    ['l.instagram.com', '', 'Social'],
    ['t.co', '', 'Social'],
    ['somenewsite.com', '', 'Referral'],
    ['$direct', 'instagram', 'Social'],   // utm_source wins
    ['www.google.es', 'newsletter', 'Referral'],
  ])('%s / %s → %s', (ref, utm, expected) => {
    expect(classifyChannel(ref, utm)).toBe(expected)
  })
})

describe('parsers', () => {
  it('merges referrers into channel totals', () => {
    const rows = parseChannels('2026-09-29', [
      ['www.google.com', '', 10], ['www.bing.com', '', 5], ['$direct', '', 7],
    ])
    expect(rows).toContainEqual({ day: '2026-09-29', metric: 'channel', dimension: 'Organic search', value: 15 })
    expect(rows).toContainEqual({ day: '2026-09-29', metric: 'channel', dimension: 'Direct', value: 7 })
  })
  it('normalises datetime strings to dates', () => {
    expect(parseDauSeries([['2026-09-01 00:00:00', 12]])[0]).toMatchObject({ day: '2026-09-01', value: 12 })
  })
  it('keys retention cells by cohort:week', () => {
    const rows = parseRetention('2026-09-29', [['2026-09-07', 100]], [['2026-09-07', 1, 40]])
    expect(rows.map(r => [r.metric, r.dimension, r.value])).toEqual([
      ['retention_cohort', '2026-09-07', 100],
      ['retention', '2026-09-07:1', 40],
    ])
  })
})

describe('queries', () => {
  it('reject non-date input (no HogQL injection)', () => {
    expect(() => q.trailingActive("2026-09-01'; drop", 7)).toThrow('invalid day')
  })
})

describe('retention matrix', () => {
  const rows = [
    { day: 'd', metric: 'retention_cohort', dimension: '2026-09-01', value: 100 },
    { day: 'd', metric: 'retention', dimension: '2026-09-01:0', value: 100 },
    { day: 'd', metric: 'retention', dimension: '2026-09-01:1', value: 40 },
    { day: 'd', metric: 'retention_cohort', dimension: '2026-09-22', value: 50 },
    { day: 'd', metric: 'retention', dimension: '2026-09-22:0', value: 50 },
  ]
  const m = buildRetentionMatrix(rows, '2026-09-29', 3)
  it('nulls weeks that have not elapsed', () => {
    expect(m[0].pcts).toEqual([100, 40, 0, 0])      // 4 weeks elapsed → W0..W3 real
    expect(m[1].pcts).toEqual([100, null, null, null]) // 1 week elapsed: W0 only... W1 not yet
  })
  it('weights retention by cohort size over elapsed cohorts only', () => {
    expect(weightedRetention(m, 1)).toBe(40) // only the first cohort has W1
    expect(weightedRetention(m, 3)).toBe(0)
  })
})

describe('collectPosthogRows', () => {
  it('runs all queries and emits wau/mau rows', async () => {
    const run = vi.fn(async (query: string) => {
      if (query.includes('group by d order by d')) return [['2026-09-29', 10]]
      if (query.includes('- 7')) return [[70]]
      if (query.includes('- 30') && query.includes('count(distinct person_id)\n      from events')) return [[300]]
      return []
    })
    const rows = await collectPosthogRows(run, '2026-09-29')
    expect(run).toHaveBeenCalledTimes(7)
    expect(rows.find(r => r.metric === 'wau')?.value).toBe(70)
    expect(rows.find(r => r.metric === 'mau')?.value).toBe(300)
  })
})
