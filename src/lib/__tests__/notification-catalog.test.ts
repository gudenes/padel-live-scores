// src/lib/__tests__/notification-catalog.test.ts
import { describe, it, expect } from 'vitest'
import { deriveCategoryStatus, buildCatalog, CATEGORY_RULES, type SendAgg } from '@/lib/notification-catalog'
import { KNOWN_CATEGORIES, CATEGORY_META } from '@/lib/notification-categories'

const NOW = Date.parse('2026-06-09T12:00:00Z')
const recent = '2026-06-08T12:00:00Z'   // 1 day ago
const old = '2026-05-01T00:00:00Z'      // >30 days ago

describe('deriveCategoryStatus', () => {
  it('live when fired within 7d', () => {
    expect(deriveCategoryStatus({ comingSoon: false, lastFiredAt: recent }, NOW)).toBe('live')
  })
  it('idle when has sender but no recent fire', () => {
    expect(deriveCategoryStatus({ comingSoon: false, lastFiredAt: old }, NOW)).toBe('idle')
    expect(deriveCategoryStatus({ comingSoon: false, lastFiredAt: null }, NOW)).toBe('idle')
  })
  it('soon when comingSoon and never fired', () => {
    expect(deriveCategoryStatus({ comingSoon: true, lastFiredAt: null }, NOW)).toBe('soon')
  })
  it('live overrides comingSoon if it actually fired recently', () => {
    expect(deriveCategoryStatus({ comingSoon: true, lastFiredAt: recent }, NOW)).toBe('live')
  })
})

describe('buildCatalog', () => {
  it('joins every known category with its aggregate + status', () => {
    const aggs: SendAgg[] = [{ category: 'match_finished', lastFiredAt: recent, count7d: 5, recipients7d: 50, failed7d: 1 }]
    const rows = buildCatalog(aggs, NOW)
    const finished = rows.find(r => r.key === 'match_finished')!
    expect(finished.status).toBe('live')
    expect(finished.count7d).toBe(5)
    const dark = rows.find(r => r.key === 'match_deciding_set')!  // comingSoon, no agg
    expect(dark.status).toBe('soon')
    expect(dark.count7d).toBe(0)
    expect(rows.length).toBe(KNOWN_CATEGORIES.length) // all known categories present
  })
})

describe('CATEGORY_RULES', () => {
  it('every known category has a non-empty rule + sample', () => {
    for (const key of KNOWN_CATEGORIES) {
      const r = CATEGORY_RULES[key]
      expect(r, key).toBeDefined()
      expect(r.rule.length, key).toBeGreaterThan(10)
      expect(r.sampleTitle.length, key).toBeGreaterThan(0)
      expect(r.sampleBody.length, key).toBeGreaterThan(0)
    }
  })
  it('buildCatalog carries description + sample', () => {
    const rows = buildCatalog([], Date.parse('2026-06-09T12:00:00Z'))
    const row = rows.find(r => r.key === 'tournament_starting')!
    expect(row.description).toBe(CATEGORY_RULES.tournament_starting.rule)
    expect(row.sample).toEqual({ title: CATEGORY_RULES.tournament_starting.sampleTitle, body: CATEGORY_RULES.tournament_starting.sampleBody })
  })
})

describe('projection_ready category', () => {
  it('is a free predictions category with a sender shipped', () => {
    expect(CATEGORY_META.projection_ready).toMatchObject({
      tier: 'free', group: 'predictions', comingSoon: false,
    })
  })

  it('appears in the built catalog with a rule + sample', () => {
    const rows = buildCatalog([], NOW)
    const row = rows.find((r) => r.key === 'projection_ready')
    expect(row).toBeTruthy()
    expect(row!.tier).toBe('free')
    expect(row!.group).toBe('predictions')
    expect(row!.description.length).toBeGreaterThan(0)
    expect(row!.sample.title).toContain('Predictions for')
  })
})
