// src/app/sitemap-tournaments.xml/route.ts
// Child sitemap — every tournament in the database. Tournament detail
// pages are high-value for organic discovery (users search for event
// names like "Riyadh Season P1 2026").
//
// Per Google: single sitemap ≤ 50,000 URLs and ≤ 50 MB uncompressed.
// We cap at 45,000 as a safety margin; if the catalog ever grows past
// that, split by year here.

import { createServerClient } from '@/lib/supabase'
import { buildUrlSet, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'

export const revalidate = 3600

export async function GET() {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('tournaments')
    .select('id, starts_at, ends_at, updated_at')
    .order('starts_at', { ascending: false })
    .limit(45_000)

  if (error) {
    // Empty urlset is still valid XML — better than a 500 for Googlebot
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const urls: SitemapUrl[] = (data ?? []).map(t => {
    const lastmod =
      (t as { updated_at?: string | null }).updated_at ??
      t.ends_at ??
      t.starts_at ??
      null
    return {
      loc: `${BASE_URL}/tournaments/${t.id}`,
      lastmod: lastmod ? new Date(lastmod).toISOString() : undefined,
      changefreq: 'daily',
      priority: 0.7,
    }
  })

  return xmlResponse(buildUrlSet(urls), revalidate)
}
