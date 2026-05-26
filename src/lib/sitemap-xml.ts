// src/lib/sitemap-xml.ts
// Shared XML serializers for the sitemap index + child sitemaps.
// Kept as pure functions so the route handlers in src/app/sitemap*.xml/
// can focus on data fetching.
//
// Schemas:
//   - urlset:       https://www.sitemaps.org/schemas/sitemap/0.9
//   - sitemapindex: https://www.sitemaps.org/schemas/sitemap/0.9
//   - xhtml:link:   https://developers.google.com/search/docs/specialty/international/localized-versions#sitemap

export interface SitemapAlternate {
  /** BCP 47 language tag (e.g. "en", "es") or "x-default". */
  hreflang: string
  /** Absolute URL for that locale variant. */
  href: string
}

export interface SitemapUrl {
  /** Absolute URL (e.g. https://padelnachos.com/match/abc). */
  loc: string
  /** ISO 8601 string. Optional but strongly recommended. */
  lastmod?: string
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  /** 0.0–1.0. Default 0.5 if omitted. */
  priority?: number
  /** Locale variants for this URL. Emitted as <xhtml:link rel="alternate"> children. */
  alternates?: SitemapAlternate[]
}

export interface SitemapIndexEntry {
  /** Absolute URL to the child sitemap. */
  loc: string
  /** Newest lastmod among the URLs in this child sitemap. */
  lastmod?: string
}

const LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const
type Locale = (typeof LOCALES)[number]

/** Escape `&`, `<`, `>`, `"`, `'` for safe XML embedding. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildUrlSet(urls: SitemapUrl[]): string {
  // Always declare the xhtml namespace — cheap, and lets callers add
  // alternates without having to think about the root attribute.
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ]
  for (const u of urls) {
    lines.push('  <url>')
    lines.push(`    <loc>${escapeXml(u.loc)}</loc>`)
    if (u.lastmod) lines.push(`    <lastmod>${escapeXml(u.lastmod)}</lastmod>`)
    if (u.changefreq) lines.push(`    <changefreq>${u.changefreq}</changefreq>`)
    if (typeof u.priority === 'number') lines.push(`    <priority>${u.priority.toFixed(1)}</priority>`)
    if (u.alternates) {
      for (const alt of u.alternates) {
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(alt.href)}"/>`,
        )
      }
    }
    lines.push('  </url>')
  }
  lines.push('</urlset>')
  return lines.join('\n')
}

export function buildSitemapIndex(entries: SitemapIndexEntry[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ]
  for (const e of entries) {
    lines.push('  <sitemap>')
    lines.push(`    <loc>${escapeXml(e.loc)}</loc>`)
    if (e.lastmod) lines.push(`    <lastmod>${escapeXml(e.lastmod)}</lastmod>`)
    lines.push('  </sitemap>')
  }
  lines.push('</sitemapindex>')
  return lines.join('\n')
}

/** Wrap a built XML string in a Response with correct headers. */
export function xmlResponse(body: string, maxAgeSeconds: number): Response {
  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // s-maxage caches at Vercel's edge for that many seconds; stale-while-revalidate
      // lets the old copy keep serving while we generate a fresh one.
      'cache-control': `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 2}`,
    },
  })
}

function urlForLocale(baseUrl: string, locale: Locale, path: string): string {
  return locale === 'en' ? `${baseUrl}${path}` : `${baseUrl}/${locale}${path}`
}

/**
 * Expand a single path into one SitemapUrl per locale, each carrying the
 * full hreflang block (every locale + x-default → English).
 *
 * Reference: https://developers.google.com/search/docs/specialty/international/localized-versions#sitemap
 */
export function expandPathForLocales(
  baseUrl: string,
  path: string,
  meta: Omit<SitemapUrl, 'loc' | 'alternates'> = {},
): SitemapUrl[] {
  // Empty path → bare base URL (no trailing slash). Otherwise ensure leading slash.
  const cleanPath = path === '' ? '' : path.startsWith('/') ? path : `/${path}`

  // Compute the hreflang block once and share it across all 5 variants —
  // every locale's <url> entry lists the same alternates.
  const alternates: SitemapAlternate[] = LOCALES.map(loc => ({
    hreflang: loc,
    href: urlForLocale(baseUrl, loc, cleanPath),
  }))
  alternates.push({ hreflang: 'x-default', href: urlForLocale(baseUrl, 'en', cleanPath) })

  return LOCALES.map(locale => ({
    ...meta,
    loc: urlForLocale(baseUrl, locale, cleanPath),
    alternates,
  }))
}
