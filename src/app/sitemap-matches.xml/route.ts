// src/app/sitemap-matches.xml/route.ts
// Child sitemap — match detail pages from the last 90 days. Older
// matches age out to keep the sitemap lean and focus Google's crawl
// budget on content users are actually searching for.
//
// Each match expands to 5 <url> entries (one per locale) with hreflang
// alternates so Google indexes /es/match/X, /pt/match/X, etc.
//
// Hard-capped at 18,000 total URLs = 3,600 matches × 5 locales.
// Most recent matches are kept (ordered by scheduled_at DESC); older
// ones inside the 90-day window drop off first if the cap is hit.
//
// Why 18k: each <url> carries 5 hreflang <xhtml:link> alternates, so the
// rendered XML measures ~964 bytes/URL in production. The old 45k budget
// let the document reach 20.88 MB and trip Vercel's 19.07 MB ISR-fallback
// limit (FALLBACK_BODY_TOO_LARGE), failing every prod deploy whenever the
// 90-day match volume spiked. 18k URLs renders ~16.5 MB — a ~2.5 MB margin
// under the cap that holds even on the busiest tournament weeks. Matches
// dropped from the sitemap are still crawlable via internal links.

import { createServerClient } from '@/lib/supabase'
import { buildUrlSet, expandPathForLocales, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'
const LOCALES_COUNT = 5
const URL_BUDGET = 18_000
const MATCH_LIMIT = Math.floor(URL_BUDGET / LOCALES_COUNT) // 3,600

export const revalidate = 3600

export async function GET() {
  const supabase = createServerClient()

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const { data, error } = await supabase
    .from('matches')
    .select('id, finished_at, scheduled_at')
    .gte('scheduled_at', ninetyDaysAgo.toISOString())
    .order('scheduled_at', { ascending: false })
    .limit(MATCH_LIMIT)

  if (error) {
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const urls: SitemapUrl[] = (data ?? []).flatMap(m => {
    const lastmodRaw = m.finished_at ?? m.scheduled_at ?? null
    const lastmod = lastmodRaw ? new Date(lastmodRaw).toISOString() : undefined
    return expandPathForLocales(BASE_URL, `/match/${m.id}`, {
      lastmod,
      changefreq: 'daily',
      priority: 0.5,
    })
  })

  return xmlResponse(buildUrlSet(urls), revalidate)
}
