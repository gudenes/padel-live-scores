// src/app/sitemap-projections.xml/route.ts
// Child sitemap — every computed projection (tournament-level + per-pair),
// one <url> per locale. Bounded by tournament_projections (only computed
// tournaments have rows). Emits nothing when the projection flag is off.

import { createServerClient } from '@/lib/supabase'
import { buildUrlSet, expandPathForLocales, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'
import { buildSlugIndex } from '@/lib/projection-slug'
import { isProjectionEnabledServer, fetchPlayerNames } from '@/lib/projection-server'
import { paginatedSelect } from '@/lib/db-paginate'

const BASE_URL = 'https://padelnachos.com'
export const revalidate = 3600

interface ProjRow { tournament_id: string; category: 'men' | 'women'; pair_key: string; pair_player_ids: string[]; computed_at: string | null }

export async function GET() {
  if (!(await isProjectionEnabledServer())) {
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const supabase = createServerClient()
  let rows: ProjRow[]
  try {
    rows = await paginatedSelect<ProjRow>(
      (start, end) => supabase
        .from('tournament_projections')
        .select('tournament_id, category, pair_key, pair_player_ids, computed_at')
        .range(start, end),
      { what: 'tournament_projections sitemap read' },
    )
  } catch {
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const nameById = await fetchPlayerNames(rows.flatMap((r) => r.pair_player_ids))

  // Tournament-level URLs: one per (tournament, category) present.
  const tournamentCategories = new Set<string>()
  for (const r of rows) tournamentCategories.add(`${r.tournament_id}::${r.category}`)

  const urls: SitemapUrl[] = []
  for (const key of tournamentCategories) {
    const [tid, category] = key.split('::')
    urls.push(...expandPathForLocales(BASE_URL, `/tournaments/${tid}/projection`, {
      changefreq: 'daily',
      priority: 0.6,
    }))
    // category is encoded as a query param on the canonical URL; the bare
    // path is the men/default. Women adds ?category=women.
    if (category === 'women') {
      urls.push(...expandPathForLocales(BASE_URL, `/tournaments/${tid}/projection?category=women`, {
        changefreq: 'daily',
        priority: 0.5,
      }))
    }
  }

  // Per-pair URLs, grouped by tournament so slugs resolve within their set.
  const byTournament = new Map<string, ProjRow[]>()
  for (const r of rows) {
    const arr = byTournament.get(r.tournament_id) ?? []
    arr.push(r)
    byTournament.set(r.tournament_id, arr)
  }
  for (const [tid, tRows] of byTournament) {
    const { pairKeyToSlug } = buildSlugIndex(tRows, nameById)
    for (const r of tRows) {
      const slug = pairKeyToSlug.get(r.pair_key)
      if (!slug) continue
      urls.push(...expandPathForLocales(BASE_URL, `/tournaments/${tid}/projection/${slug}`, {
        lastmod: r.computed_at ? new Date(r.computed_at).toISOString() : undefined,
        changefreq: 'daily',
        priority: 0.5,
      }))
    }
  }

  return xmlResponse(buildUrlSet(urls), revalidate)
}
