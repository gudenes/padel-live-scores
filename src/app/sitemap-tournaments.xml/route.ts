// src/app/sitemap-tournaments.xml/route.ts
// Child sitemap — every tournament in the database. Tournament detail
// pages are high-value for organic discovery (users search for event
// names like "Riyadh Season P1 2026").
//
// Each tournament expands to 5 <url> entries (one per locale) with
// hreflang alternates so Google indexes /es/tournaments/X, /pt/..., etc.
//
// Per Google: single sitemap ≤ 50,000 URLs and ≤ 50 MB uncompressed.
// We cap at 45,000 total URLs as a safety margin — that's 9,000 tournaments
// × 5 locales. Oldest tournaments are dropped first via DB order. If the
// catalog ever grows past that, split by year here.

import { createServerClient } from '@/lib/supabase'
import { buildUrlSet, expandPathForLocales, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'
const LOCALES_COUNT = 5
const URL_BUDGET = 45_000
const TOURNAMENT_LIMIT = Math.floor(URL_BUDGET / LOCALES_COUNT) // 9,000

export const revalidate = 3600

export async function GET() {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('tournaments')
    .select('id, starts_at, ends_at, updated_at')
    // Skip ghost rows that leak into the index — empty-name or
    // dateless tournaments render as "Tournament Detail" with all
    // stats as em-dashes. Filtering at the sitemap level stops new
    // discovery; layout.tsx handles existing indexed pages with
    // robots: noindex.
    .not('name', 'is', null)
    .neq('name', '')
    .not('starts_at', 'is', null)
    .order('starts_at', { ascending: false })
    .limit(TOURNAMENT_LIMIT)

  if (error) {
    // Empty urlset is still valid XML — better than a 500 for Googlebot
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const urls: SitemapUrl[] = (data ?? []).flatMap(t => {
    const lastmodRaw =
      (t as { updated_at?: string | null }).updated_at ??
      t.ends_at ??
      t.starts_at ??
      null
    const lastmod = lastmodRaw ? new Date(lastmodRaw).toISOString() : undefined
    return expandPathForLocales(BASE_URL, `/tournaments/${t.id}`, {
      lastmod,
      changefreq: 'daily',
      priority: 0.7,
    })
  })

  return xmlResponse(buildUrlSet(urls), revalidate)
}
