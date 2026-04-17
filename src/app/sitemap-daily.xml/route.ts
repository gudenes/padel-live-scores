// src/app/sitemap-daily.xml/route.ts
// Child sitemap — daily match pages for every supported locale, covering
// the last 14 days and next 7 days. These rotate every day and give Google
// a crawl beacon for the highest-intent queries ("partidos de pádel hoy",
// "resultados padel ayer", "calendario padel mañana").
//
// 22 days × 5 locales = 110 URLs per generation. Well under the 50,000 cap.

import { buildUrlSet, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'
import { addDaysIso, getLocaleHomeTz, getLocaleTodayIso } from '@/lib/locale-time'

const BASE_URL = 'https://padelnachos.com'
const LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const
const PAST_DAYS = 14
const FUTURE_DAYS = 7

export const revalidate = 3600

export async function GET() {
  const now = new Date()
  const nowIso = now.toISOString()
  const urls: SitemapUrl[] = []

  for (const locale of LOCALES) {
    const tz = getLocaleHomeTz(locale)
    const todayIso = getLocaleTodayIso(locale, now)

    for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset++) {
      const iso = addDaysIso(todayIso, offset, tz)
      const localePrefix = locale === 'en' ? '' : `/${locale}`
      const loc = `${BASE_URL}${localePrefix}/matches/${iso}`

      // Past days are stable — lastmod = that date. Today + future get nowIso.
      const lastmod = offset < 0
        ? `${iso}T00:00:00.000Z`
        : nowIso

      urls.push({
        loc,
        lastmod,
        // Today changes constantly; other days less so
        changefreq: offset === 0 ? 'hourly' : offset < 0 ? 'weekly' : 'daily',
        // Today and near-future are the highest-intent pages
        priority: offset === 0 ? 0.9 : (Math.abs(offset) <= 3 ? 0.7 : 0.5),
      })
    }
  }

  return xmlResponse(buildUrlSet(urls), revalidate)
}
