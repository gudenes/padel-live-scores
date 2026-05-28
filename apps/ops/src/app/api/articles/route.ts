import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'
import { clusterArticles } from '@/lib/feed-scoring'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

interface ArticleRow {
  id: string
  title: string
  source_name: string
  source_key: string
  url: string
  language: string | null
  published_at: string
  click_count: number
  enrichment_status: string
  summary_md: string | null
  title_translations: Record<string, string> | null
  summary_translations: Record<string, string> | null
}

type ClusterInfo = {
  role: 'unique' | 'primary' | 'sibling'
  siblingCount: number
  primaryId: string | null
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const page = Math.max(0, parseInt(sp.get('page') ?? '0', 10))
  const search = (sp.get('search') ?? '').trim()
  const sourceKey = sp.get('source_key') ?? ''
  const language = sp.get('language') ?? ''
  const enrichmentStatus = sp.get('enrichment_status') ?? ''

  const where: string[] = []
  const params: unknown[] = []
  if (search) { params.push(`%${search}%`); where.push(`title ILIKE $${params.length}`) }
  if (sourceKey) { params.push(sourceKey); where.push(`source_key = $${params.length}`) }
  if (language) { params.push(language); where.push(`language = $${params.length}`) }
  if (enrichmentStatus) { params.push(enrichmentStatus); where.push(`enrichment_status = $${params.length}`) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const offset = page * PAGE_SIZE
  params.push(PAGE_SIZE, offset)

  const { rows } = await pgPool().query<ArticleRow>(`
    SELECT id, title, source_name, source_key, url, language,
           published_at, click_count, enrichment_status, summary_md,
           title_translations, summary_translations
    FROM articles
    ${whereSql}
    ORDER BY published_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params)

  const { rows: countRows } = await pgPool().query<{ n: number }>(`
    SELECT count(*)::int AS n FROM articles ${whereSql}
  `, params.slice(0, -2))

  // Distinct values for filter dropdowns (only on page 0 to save bandwidth)
  let facets: { source_keys: Array<{ key: string; name: string }>; languages: string[]; enrichment_statuses: string[] } | undefined
  if (page === 0) {
    const [sources, languages, statuses] = await Promise.all([
      pgPool().query<{ key: string; name: string }>(`SELECT source_key AS key, MIN(source_name) AS name FROM articles GROUP BY source_key ORDER BY MIN(source_name)`),
      pgPool().query<{ language: string | null }>(`SELECT DISTINCT language FROM articles WHERE language IS NOT NULL ORDER BY language`),
      pgPool().query<{ enrichment_status: string }>(`SELECT DISTINCT enrichment_status FROM articles ORDER BY enrichment_status`),
    ])
    facets = {
      source_keys: sources.rows,
      languages: languages.rows.map(r => r.language!).filter(Boolean),
      enrichment_statuses: statuses.rows.map(r => r.enrichment_status),
    }
  }

  // Cluster the latest 200 enriched articles for cluster-role lookup
  const { rows: enrichedWindow } = await pgPool().query<{ id: string; title: string }>(`
    SELECT id, title
    FROM articles
    WHERE enrichment_status = 'enriched'
      AND status = 'active'
    ORDER BY published_at DESC
    LIMIT 200
  `)

  const clusters = clusterArticles(enrichedWindow)

  const clusterInfo = new Map<string, ClusterInfo>()
  for (const c of clusters) {
    if (c.siblings.length === 0) {
      clusterInfo.set(c.primary.id, { role: 'unique', siblingCount: 0, primaryId: null })
    } else {
      clusterInfo.set(c.primary.id, { role: 'primary', siblingCount: c.siblings.length, primaryId: null })
      for (const sib of c.siblings) {
        clusterInfo.set(sib.id, { role: 'sibling', siblingCount: 0, primaryId: c.primary.id })
      }
    }
  }

  const articlesWithCluster = (rows ?? []).map(r => ({
    ...r,
    cluster: clusterInfo.get(r.id) ?? { role: 'unique' as const, siblingCount: 0, primaryId: null },
  }))

  return NextResponse.json({
    articles: articlesWithCluster,
    total: countRows[0]?.n ?? 0,
    page,
    page_size: PAGE_SIZE,
    facets,
  }, { headers: { 'cache-control': 'no-store' } })
}
