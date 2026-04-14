import type { MetadataRoute } from 'next'
import { createServerClient } from '@/lib/supabase'

const baseUrl = 'https://padelnachos.com'

const staticRoutes: MetadataRoute.Sitemap = [
  {
    url: baseUrl,
    lastModified: new Date(),
    changeFrequency: 'always',
    priority: 1,
  },
  {
    url: `${baseUrl}/home`,
    lastModified: new Date(),
    changeFrequency: 'always',
    priority: 1,
  },
  {
    url: `${baseUrl}/matches`,
    lastModified: new Date(),
    changeFrequency: 'always',
    priority: 0.9,
  },
  {
    url: `${baseUrl}/rankings`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 0.8,
  },
  {
    url: `${baseUrl}/feed`,
    lastModified: new Date(),
    changeFrequency: 'hourly',
    priority: 0.7,
  },
  {
    url: `${baseUrl}/about`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 0.4,
  },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const supabase = createServerClient()

    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const [tournamentsResult, matchesResult, playersResult] = await Promise.all([
      supabase
        .from('tournaments')
        .select('id, starts_at, ends_at')
        .order('starts_at', { ascending: false }),
      supabase
        .from('matches')
        .select('id, finished_at, scheduled_at')
        .gte('scheduled_at', ninetyDaysAgo.toISOString())
        .limit(2000),
      supabase
        .from('players')
        .select('id')
        .or('ranking.not.is.null,total_matches.gt.0')
        .limit(2000),
    ])

    const tournamentEntries: MetadataRoute.Sitemap = (tournamentsResult.data ?? []).map((t) => ({
      url: `${baseUrl}/tournaments/${t.id}`,
      lastModified: t.ends_at ? new Date(t.ends_at) : t.starts_at ? new Date(t.starts_at) : new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    }))

    const matchEntries: MetadataRoute.Sitemap = (matchesResult.data ?? []).map((m) => ({
      url: `${baseUrl}/match/${m.id}`,
      lastModified: m.finished_at ? new Date(m.finished_at) : m.scheduled_at ? new Date(m.scheduled_at) : new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.5,
    }))

    const playerEntries: MetadataRoute.Sitemap = (playersResult.data ?? []).map((p) => ({
      url: `${baseUrl}/player/${p.id}`,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }))

    return [...staticRoutes, ...tournamentEntries, ...matchEntries, ...playerEntries]
  } catch {
    return staticRoutes
  }
}
