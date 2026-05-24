// Source detector — shared between paste-and-detect (Add drawer), public
// submissions, and AI source discovery candidate verification.

export type DetectedType = 'rss' | 'wp-api' | 'google-news-search' | 'unknown'

export interface DetectedSource {
  type: DetectedType
  url: string
  name?: string
  language?: string
  sample: Array<{
    title: string
    pubDate?: string
    snippet?: string
  }>
  notes?: string
}

/**
 * Step 1 of the detection ladder — pure URL pattern matching, no network.
 * Returns the inferred type, or null if nothing matched (caller should fall
 * through to content sniffing).
 */
export function matchUrlPattern(input: string): DetectedType | null {
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return null
  }

  if (u.hostname === 'news.google.com' && u.pathname.startsWith('/rss/search')) {
    return 'google-news-search'
  }
  if (u.pathname === '/wp-json/wp/v2/posts' || u.pathname.startsWith('/wp-json/wp/v2/posts/')) {
    return 'wp-api'
  }
  // /feed, /feed/, /rss, /rss/, /atom.xml, *.rss
  if (
    /(^|\/)(feed|rss)\/?$/.test(u.pathname) ||
    /\.rss$/.test(u.pathname) ||
    /atom\.xml$/.test(u.pathname)
  ) {
    return 'rss'
  }
  return null
}
