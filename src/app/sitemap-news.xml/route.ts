// src/app/sitemap-news.xml/route.ts
// Sitemap for first-party news posts. One entry per (post, locale) where
// a translation exists, plus the localized index pages.

import { createServerClient } from '@/lib/supabase'
import { buildUrlSet, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'
import { NEWS_LOCALES } from '@/types/news'

const BASE_URL = 'https://padelnachos.com'

export const revalidate = 3600

interface NewsRow {
  locale: string
  slug: string
  updated_at: string
}

export async function GET() {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('news_posts')
    .select('locale, slug, updated_at')
    .eq('status', 'published')

  if (error) {
    console.error('[sitemap-news] query failed:', error.message)
    return xmlResponse(buildUrlSet([]), 60)
  }

  const rows = (data as NewsRow[]) ?? []
  const entries: SitemapUrl[] = rows.map((row) => {
    const path = row.locale === 'en' ? `/news/${row.slug}` : `/${row.locale}/news/${row.slug}`
    return {
      loc: `${BASE_URL}${path}`,
      lastmod: row.updated_at,
      changefreq: 'monthly' as const,
      priority: 0.7,
    }
  })

  for (const locale of NEWS_LOCALES) {
    const path = locale === 'en' ? '/news' : `/${locale}/news`
    entries.push({
      loc: `${BASE_URL}${path}`,
      lastmod: new Date().toISOString(),
      changefreq: 'weekly' as const,
      priority: 0.6,
    })
  }

  return xmlResponse(buildUrlSet(entries), revalidate)
}
