// src/lib/sitemap-xml.ts
// Shared XML serializers for the sitemap index + child sitemaps.
// Kept as pure functions so the route handlers in src/app/sitemap*.xml/
// can focus on data fetching.
//
// Schemas:
//   - urlset:       https://www.sitemaps.org/schemas/sitemap/0.9
//   - sitemapindex: https://www.sitemaps.org/schemas/sitemap/0.9

export interface SitemapUrl {
  /** Absolute URL (e.g. https://padelnachos.com/match/abc). */
  loc: string
  /** ISO 8601 string. Optional but strongly recommended. */
  lastmod?: string
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  /** 0.0–1.0. Default 0.5 if omitted. */
  priority?: number
}

export interface SitemapIndexEntry {
  /** Absolute URL to the child sitemap. */
  loc: string
  /** Newest lastmod among the URLs in this child sitemap. */
  lastmod?: string
}

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
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ]
  for (const u of urls) {
    lines.push('  <url>')
    lines.push(`    <loc>${escapeXml(u.loc)}</loc>`)
    if (u.lastmod) lines.push(`    <lastmod>${escapeXml(u.lastmod)}</lastmod>`)
    if (u.changefreq) lines.push(`    <changefreq>${u.changefreq}</changefreq>`)
    if (typeof u.priority === 'number') lines.push(`    <priority>${u.priority.toFixed(1)}</priority>`)
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
