// src/app/sitemap-static.xml/route.ts
// Child sitemap — the handful of top-level marketing/index pages.
// Small, rarely changes; cache for an hour.

import { buildUrlSet, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'

export const revalidate = 3600

export async function GET() {
  const now = new Date().toISOString()

  const urls: SitemapUrl[] = [
    { loc: BASE_URL, lastmod: now, changefreq: 'always', priority: 1.0 },
    { loc: `${BASE_URL}/home`, lastmod: now, changefreq: 'always', priority: 1.0 },
    { loc: `${BASE_URL}/matches`, lastmod: now, changefreq: 'always', priority: 0.9 },
    { loc: `${BASE_URL}/rankings`, lastmod: now, changefreq: 'daily', priority: 0.8 },
    { loc: `${BASE_URL}/feed`, lastmod: now, changefreq: 'hourly', priority: 0.7 },
    { loc: `${BASE_URL}/about`, lastmod: now, changefreq: 'weekly', priority: 0.4 },
  ]

  return xmlResponse(buildUrlSet(urls), revalidate)
}
