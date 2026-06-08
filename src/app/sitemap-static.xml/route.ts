// src/app/sitemap-static.xml/route.ts
// Child sitemap — the handful of top-level marketing/index pages.
// Small, rarely changes; cache for an hour.
//
// Each path is emitted as one <url> per locale (5x) with full hreflang
// alternates, so Google can index /es/home, /pt/home, etc.

import { buildUrlSet, expandPathForLocales, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'

export const revalidate = 3600

export async function GET() {
  const now = new Date().toISOString()

  const paths: Array<{
    path: string
    changefreq: SitemapUrl['changefreq']
    priority: number
  }> = [
    // /home is the real 200 page (the apex `/` permanently redirects to it),
    // so advertise /home — not `/` — to point Google at the canonical URL.
    { path: '/home', changefreq: 'always', priority: 1.0 },
    { path: '/matches', changefreq: 'always', priority: 0.9 },
    { path: '/rankings', changefreq: 'daily', priority: 0.8 },
    { path: '/feed', changefreq: 'hourly', priority: 0.7 },
    { path: '/about', changefreq: 'weekly', priority: 0.4 },
  ]

  const urls: SitemapUrl[] = paths.flatMap(({ path, changefreq, priority }) =>
    expandPathForLocales(BASE_URL, path, {
      lastmod: now,
      changefreq,
      priority,
    }),
  )

  return xmlResponse(buildUrlSet(urls), revalidate)
}
