// src/app/sitemap-players.xml/route.ts
// Child sitemap — player profile pages. Only includes players who have
// a ranking OR at least one recorded match, which filters out thousands
// of never-played FIP records that would otherwise dilute the crawl.
//
// Hard-capped at 45,000 URLs.

import { createServerClient } from '@/lib/supabase'
import { buildUrlSet, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'

export const revalidate = 3600

export async function GET() {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('players')
    .select('id')
    .or('ranking.not.is.null,total_matches.gt.0')
    .limit(45_000)

  if (error) {
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const urls: SitemapUrl[] = (data ?? []).map(p => ({
    loc: `${BASE_URL}/player/${p.id}`,
    changefreq: 'weekly',
    priority: 0.6,
  }))

  return xmlResponse(buildUrlSet(urls), revalidate)
}
