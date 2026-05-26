// apps/ops/src/lib/seo/url-classifier.ts
// Shared helper: parse a padelnachos.com URL into locale + page_type.
// Used by GSC ingest (seo_top_pages) and sitemap crawl (sitemap_url_snapshot)
// so both classifications are byte-identical and joinable.

export type Locale = 'en' | 'es' | 'pt' | 'it' | 'fr'
export type PageType = 'home' | 'matches' | 'match' | 'player' | 'tournament' | 'news' | 'other'

export interface UrlClassification {
  locale: Locale
  page_type: PageType
}

const LOCALE_PREFIX_RE = /^\/(es|pt|it|fr)(\/|$)/

export function parseLocaleFromUrl(url: string): UrlClassification {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return { locale: 'en', page_type: 'other' }
  }

  const m = path.match(LOCALE_PREFIX_RE)
  const locale: Locale = m ? (m[1] as Locale) : 'en'
  // The regex captures the locale prefix WITH its trailing '/' or end-of-string
  // anchor (e.g. matches "/es/" or "/es"). We slice m[0].length - 1 to KEEP the
  // leading '/' so the page_type regexes below can match against '/home',
  // '/matches', etc. uniformly. For the bare-locale case '/es' (no trailing /),
  // the resulting `rest` is 's' — which intentionally falls through to
  // page_type='other', the correct answer for a content-less locale root.
  const rest = m ? path.slice(m[0].length - 1) : path

  let page_type: PageType = 'other'
  if (rest === '/' || rest === '/home') page_type = 'home'
  else if (/^\/matches(\/|$)/.test(rest)) page_type = 'matches'
  else if (/^\/match\//.test(rest)) page_type = 'match'
  else if (/^\/player\//.test(rest)) page_type = 'player'
  else if (/^\/tournaments\//.test(rest)) page_type = 'tournament'
  else if (/^\/news(\/|$)/.test(rest)) page_type = 'news'

  return { locale, page_type }
}
