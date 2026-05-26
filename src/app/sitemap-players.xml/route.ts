// src/app/sitemap-players.xml/route.ts
// Child sitemap — player profile pages. Only includes players who have
// a ranking OR at least one recorded match, which filters out thousands
// of never-played FIP records that would otherwise dilute the crawl.
//
// Each player expands to 5 <url> entries (one per locale) with hreflang
// alternates so Google indexes /es/player/X, /pt/player/X, etc.
//
// Hard-capped at 45,000 total URLs = 9,000 players × 5 locales. Ordered
// by ranking ascending so the highest-ranked (most-searched) players
// always make the cut; unranked-but-played profiles fill the tail.

import { createServerClient } from '@/lib/supabase'
import { buildUrlSet, expandPathForLocales, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'
const LOCALES_COUNT = 5
const URL_BUDGET = 45_000
const PLAYER_LIMIT = Math.floor(URL_BUDGET / LOCALES_COUNT) // 9,000

export const revalidate = 3600

export async function GET() {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('players')
    .select('id')
    .or('ranking.not.is.null,total_matches.gt.0')
    .order('ranking', { ascending: true, nullsFirst: false })
    .limit(PLAYER_LIMIT)

  if (error) {
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const urls: SitemapUrl[] = (data ?? []).flatMap(p =>
    expandPathForLocales(BASE_URL, `/player/${p.id}`, {
      changefreq: 'weekly',
      priority: 0.6,
    }),
  )

  return xmlResponse(buildUrlSet(urls), revalidate)
}
