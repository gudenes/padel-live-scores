// src/lib/road-to-olympics/beats.ts
//
// Olympic-keyword filter for the BeatsFeed component. During Soft Launch we
// don't tag articles in the database — we just regex-filter the existing
// articles table. Hardening Wave introduces an articles.topic column and a
// dedicated tag-olympics-articles cron, at which point this filter becomes
// a fallback for un-tagged historical articles.
//
// Word boundaries on every alternative — keep "olympic" from matching
// "metropolitan" or "polymer".

export const OLYMPIC_KEYWORD_REGEX =
  /\b(olympic|olympics|ioc|brisbane\s*2032|asoif|anoc|aichi[-\s]?nagoya|aimag|fisu)\b/i

export function isOlympicArticle(article: {
  title: string | null
  summary: string | null
}): boolean {
  const haystack = `${article.title ?? ''} ${article.summary ?? ''}`
  return OLYMPIC_KEYWORD_REGEX.test(haystack)
}

/** Read recent Olympic-keyword articles from Supabase.
 *  Returns at most `limit` rows newest-first.
 *
 *  Caller passes the supabase client (server-side, anon or service key).
 *  We can't import from `@/lib/supabase` at module top-level because this
 *  module is shared between server pages and route handlers with different
 *  client lifetimes.
 */
export async function fetchOlympicBeats(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  limit = 6,
): Promise<Array<{
  id: string
  title: string
  summary: string | null
  source_url: string
  source_name: string
  published_at: string
}>> {
  // We can't push the regex into Postgres easily, so we over-fetch and filter
  // in JS. ~50 candidates × 6 weeks of news is a few KB; well within budget.
  const { data, error } = await supabase
    .from('articles')
    .select('id, title, summary, source_url, source_name, published_at')
    .gte('published_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
    .order('published_at', { ascending: false })
    .limit(50)
  if (error) {
    console.error('[road-to-olympics] fetchOlympicBeats failed:', error.message)
    return []
  }
  return (data ?? [])
    .filter((row) => isOlympicArticle({ title: row.title, summary: row.summary }))
    .slice(0, limit)
}
