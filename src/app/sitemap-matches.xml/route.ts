// src/app/sitemap-matches.xml/route.ts
// Child sitemap — match detail pages from the last 90 days. Older
// matches age out to keep the sitemap lean and focus Google's crawl
// budget on content users are actually searching for.
//
// Hard-capped at 45,000 URLs.

import { createServerClient } from '@/lib/supabase'
import { buildUrlSet, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'

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
    .limit(45_000)

  if (error) {
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const urls: SitemapUrl[] = (data ?? []).map(m => {
    const lastmod = m.finished_at ?? m.scheduled_at ?? null
    return {
      loc: `${BASE_URL}/match/${m.id}`,
      lastmod: lastmod ? new Date(lastmod).toISOString() : undefined,
      changefreq: 'daily',
      priority: 0.5,
    }
  })

  return xmlResponse(buildUrlSet(urls), revalidate)
}
