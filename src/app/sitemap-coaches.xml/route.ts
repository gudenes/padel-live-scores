// Child sitemap — the coaches index + every indexable coach page (players with
// > 0 pro points; zero-point coaches render noindex). 5 locales per URL.
import { createAnonServerClient } from '@/lib/supabase'
import { buildUrlSet, expandPathForLocales, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'
export const revalidate = 3600

export async function GET() {
  const { data, error } = await createAnonServerClient()
    .from('coach_rankings_public')
    .select('slug')
    .gt('total_points', 0)
    .order('total_points', { ascending: false })
    .limit(5000)
  if (error) return xmlResponse(buildUrlSet([]), revalidate)
  const urls: SitemapUrl[] = [
    ...expandPathForLocales(BASE_URL, '/coaches', { changefreq: 'weekly', priority: 0.6 }),
    ...(data ?? []).flatMap((c) => expandPathForLocales(BASE_URL, `/coach/${c.slug}`, { changefreq: 'weekly', priority: 0.5 })),
  ]
  return xmlResponse(buildUrlSet(urls), revalidate)
}
