// src/app/sitemap-static.xml/route.ts
// Child sitemap — the handful of top-level marketing/index pages.
// Small, rarely changes; cache for an hour.

import { buildUrlSet, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'

// Rankings ships in 5 locales as a fully SSR'd page (see
// docs/superpowers/specs/2026-05-20-rankings-ssr-design.md). All 5
// variants are listed here so Google indexes each locale URL directly
// instead of relying solely on hreflang discovery from the English page.
const RANKINGS_LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const

export const revalidate = 3600

export async function GET() {
  const now = new Date().toISOString()

  const rankingsUrls: SitemapUrl[] = RANKINGS_LOCALES.map((loc) => ({
    loc: loc === 'en' ? `${BASE_URL}/rankings` : `${BASE_URL}/${loc}/rankings`,
    lastmod: now,
    changefreq: 'daily' as const,
    priority: 0.8,
  }))

  const urls: SitemapUrl[] = [
    { loc: BASE_URL, lastmod: now, changefreq: 'always', priority: 1.0 },
    { loc: `${BASE_URL}/home`, lastmod: now, changefreq: 'always', priority: 1.0 },
    { loc: `${BASE_URL}/matches`, lastmod: now, changefreq: 'always', priority: 0.9 },
    ...rankingsUrls,
    { loc: `${BASE_URL}/feed`, lastmod: now, changefreq: 'hourly', priority: 0.7 },
    { loc: `${BASE_URL}/about`, lastmod: now, changefreq: 'weekly', priority: 0.4 },
  ]

  return xmlResponse(buildUrlSet(urls), revalidate)
}
