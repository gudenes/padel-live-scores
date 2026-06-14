// src/app/sitemap-daily.xml/route.ts
// Child sitemap — daily match ARCHIVE pages (last 14 + next 7 days, all
// locales), EXCLUDING today. Today is the permanent /matches hub, listed
// in sitemap-static.xml. These dated URLs give Google a crawl beacon for
// date-specific queries ("resultados padel ayer", "calendario padel mañana").
//
// 21 days × 5 locales = 105 URLs per generation. Well under the 50,000 cap.

import { buildUrlSet, xmlResponse } from '@/lib/sitemap-xml'
import { buildDailyMatchSitemapUrls } from '@/lib/matches-sitemap'

export const revalidate = 3600

export async function GET() {
  const urls = buildDailyMatchSitemapUrls(new Date())
  return xmlResponse(buildUrlSet(urls), revalidate)
}
