// src/lib/matches-sitemap.ts
// Pure builder for the daily-match sitemap URLs. Covers the last 14 and
// next 7 days per locale, EXCLUDING today — today is served by the
// permanent /matches hub (listed in sitemap-static.xml), so listing the
// dated today URL here would advertise a URL that canonicalizes away.

import { addDaysIso, getLocaleHomeTz, getLocaleTodayIso } from '@/lib/locale-time'
import type { SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'
const LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const
const PAST_DAYS = 14
const FUTURE_DAYS = 7

export function buildDailyMatchSitemapUrls(now: Date): SitemapUrl[] {
  const nowIso = now.toISOString()
  const urls: SitemapUrl[] = []

  for (const locale of LOCALES) {
    const tz = getLocaleHomeTz(locale)
    const todayIso = getLocaleTodayIso(locale, now)

    for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset++) {
      if (offset === 0) continue // today → permanent /matches hub
      const iso = addDaysIso(todayIso, offset, tz)
      const localePrefix = locale === 'en' ? '' : `/${locale}`
      const loc = `${BASE_URL}${localePrefix}/matches/${iso}`

      // Past days are stable — lastmod = that date. Future gets nowIso.
      const lastmod = offset < 0 ? `${iso}T00:00:00.000Z` : nowIso

      urls.push({
        loc,
        lastmod,
        changefreq: offset < 0 ? 'weekly' : 'daily',
        priority: Math.abs(offset) <= 3 ? 0.7 : 0.5,
      })
    }
  }

  return urls
}
