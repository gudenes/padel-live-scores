// src/app/sitemap-teams.xml/route.ts
// Child sitemap — team pages. One entry per team, expanded across the five
// locales with hreflang alternates, mirroring sitemap-players.xml.

import { createAnonServerClient } from '@/lib/supabase'
import { buildUrlSet, expandPathForLocales, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'

export const revalidate = 3600

export async function GET() {
  const supabase = createAnonServerClient()

  const { data, error } = await supabase
    .from('teams')
    .select('slug')
    .eq('source', 'snp')

  if (error) {
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const urls: SitemapUrl[] = (data ?? []).flatMap(t =>
    expandPathForLocales(BASE_URL, `/snp/${t.slug}`, {
      changefreq: 'weekly',
      priority: 0.6,
    }),
  )

  return xmlResponse(buildUrlSet(urls), revalidate)
}
