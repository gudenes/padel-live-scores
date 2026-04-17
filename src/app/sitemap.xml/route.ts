// src/app/sitemap.xml/route.ts
// Sitemap INDEX — the one URL referenced by robots.txt and submitted
// to Google Search Console. Points at the four child sitemaps. Google
// recursively fetches each child and discovers URLs in parallel.

import { buildSitemapIndex, xmlResponse } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'

/**
 * Refresh the index every 15 minutes. The index itself is tiny so
 * there's no cost to keeping it fresh. Individual child sitemaps
 * cache for longer (1 hour) — see each child route's revalidate value.
 */
export const revalidate = 900

export async function GET() {
  // Child sitemap lastmod is approximated as "now" because the actual
  // freshness is computed server-side when each child is built. Google
  // still re-fetches the child when it sees a new lastmod on the index.
  const now = new Date().toISOString()

  const body = buildSitemapIndex([
    { loc: `${BASE_URL}/sitemap-static.xml`, lastmod: now },
    { loc: `${BASE_URL}/sitemap-tournaments.xml`, lastmod: now },
    { loc: `${BASE_URL}/sitemap-matches.xml`, lastmod: now },
    { loc: `${BASE_URL}/sitemap-players.xml`, lastmod: now },
    { loc: `${BASE_URL}/sitemap-daily.xml`, lastmod: now },
  ])

  return xmlResponse(body, revalidate)
}
