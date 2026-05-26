// apps/ops/tests/seo-digest-rules.test.ts
import { describe, it, expect } from 'vitest'
import { computeBullets, type DigestSignals } from '../src/lib/seo/digest-rules'

const base: DigestSignals = {
  totalDirection: 'up',
  localeDeltas: { en: 20, es: 15, pt: 25, it: 10, fr: 5 },
  newLocaleGapCount: 0,
  sitemapSizeDeltaPct: 0,
}

describe('computeBullets', () => {
  it('returns the "all good" bullet when nothing fires', () => {
    expect(computeBullets(base)).toEqual([
      'Nothing flagged today — all metrics within normal bands.',
    ])
  })

  it('flags a locale moving opposite to total', () => {
    const r = computeBullets({ ...base, localeDeltas: { ...base.localeDeltas, es: -15 } })
    expect(r).toContainEqual(expect.stringContaining('es'))
    expect(r).toContainEqual(expect.stringContaining('down'))
  })

  it('flags ≥5 new locale-gap pages', () => {
    const r = computeBullets({ ...base, newLocaleGapCount: 14 })
    expect(r).toContainEqual(expect.stringContaining('14 new locale-gap pages'))
  })

  it('flags sitemap size shift >20%', () => {
    const r = computeBullets({ ...base, sitemapSizeDeltaPct: 35 })
    expect(r).toContainEqual(expect.stringContaining('Sitemap grew by 35%'))
  })

  it('flags sitemap shrink >20%', () => {
    const r = computeBullets({ ...base, sitemapSizeDeltaPct: -28 })
    expect(r).toContainEqual(expect.stringContaining('Sitemap shrank by 28%'))
  })

  it('multiple rules fire together (no "all good" bullet)', () => {
    const r = computeBullets({
      ...base,
      localeDeltas: { ...base.localeDeltas, es: -15 },
      newLocaleGapCount: 7,
    })
    expect(r.length).toBe(2)
    expect(r.some(x => x.includes('Nothing flagged'))).toBe(false)
  })
})
