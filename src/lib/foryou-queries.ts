// src/lib/foryou-queries.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ForYouArticleRow {
  id: string
  title: string
  source_url: string
  source_name: string | null
  favicon_url: string | null
  image_url: string | null
  published_at: string | null
  language: string | null
  summary_md: string | null
  summary_translations: Record<string, string>
  tournament_level: string | null
}

/**
 * V1 query — articles enriched by the news pipeline, latest 50.
 *
 * No tournament_level resolution in V1: `articles` has no FK to tournaments.
 * Tournament-tier mapping would require a join through article_entities.
 * The topic chip falls back to "PADEL NEWS" when tournament_level is null.
 * V2 can add the join via article_entities when chip visibility is reconsidered.
 *
 * NOTE: The DB column is `url`; we alias it to `source_url` here so the
 * output matches the `ForYouArticle` interface that ForYouCard expects.
 */
export async function loadForYouArticles(
  supabase: SupabaseClient,
  _locale: string,
): Promise<ForYouArticleRow[]> {
  const { data } = await supabase
    .from('articles')
    .select(`
      id, title, source_url:url, source_name, favicon_url, image_url,
      published_at, language, summary_md, summary_translations
    `)
    .eq('enrichment_status', 'enriched')
    .order('published_at', { ascending: false })
    .limit(50)
  return (data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    source_url: r.source_url,
    source_name: r.source_name,
    favicon_url: r.favicon_url,
    image_url: r.image_url,
    published_at: r.published_at,
    language: r.language,
    summary_md: r.summary_md,
    summary_translations: r.summary_translations ?? {},
    tournament_level: null,
  }))
}
