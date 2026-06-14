import { describe, it, expect } from 'vitest'
import { buildDailyMatchSitemapUrls } from '../matches-sitemap'
import { getLocaleHomeTz, getLocaleTodayIso, addDaysIso } from '../locale-time'

describe('buildDailyMatchSitemapUrls', () => {
  const now = new Date('2026-06-14T12:00:00Z')

  it('excludes today — it lives at the permanent /matches hub', () => {
    const urls = buildDailyMatchSitemapUrls(now)
    const todayIso = getLocaleTodayIso('en', now)
    expect(
      urls.some(u => u.loc === `https://padelnachos.com/matches/${todayIso}`),
    ).toBe(false)
  })

  it('includes yesterday and tomorrow (en)', () => {
    const urls = buildDailyMatchSitemapUrls(now)
    const tz = getLocaleHomeTz('en')
    const today = getLocaleTodayIso('en', now)
    const yIso = addDaysIso(today, -1, tz)
    const tIso = addDaysIso(today, 1, tz)
    expect(urls.some(u => u.loc === `https://padelnachos.com/matches/${yIso}`)).toBe(true)
    expect(urls.some(u => u.loc === `https://padelnachos.com/matches/${tIso}`)).toBe(true)
  })

  it('never lists the bare /matches hub (that belongs to sitemap-static)', () => {
    const urls = buildDailyMatchSitemapUrls(now)
    expect(urls.some(u => u.loc === 'https://padelnachos.com/matches')).toBe(false)
  })

  it('emits 21 days × 5 locales (22-day window minus today)', () => {
    const urls = buildDailyMatchSitemapUrls(now)
    expect(urls.length).toBe((14 + 7) * 5)
  })
})
