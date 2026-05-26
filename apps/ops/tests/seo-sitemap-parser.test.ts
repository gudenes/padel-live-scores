// apps/ops/tests/seo-sitemap-parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseSitemapXml } from '../src/lib/seo/sitemap-parser'

describe('parseSitemapXml', () => {
  it('parses a sitemap index', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://padelnachos.com/sitemap-static.xml</loc></sitemap>
  <sitemap><loc>https://padelnachos.com/sitemap-matches.xml</loc></sitemap>
</sitemapindex>`
    const r = parseSitemapXml(xml)
    expect(r.kind).toBe('index')
    expect(r.urls).toEqual([
      'https://padelnachos.com/sitemap-static.xml',
      'https://padelnachos.com/sitemap-matches.xml',
    ])
  })

  it('parses a urlset', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://padelnachos.com/home</loc></url>
  <url><loc>https://padelnachos.com/matches</loc></url>
  <url><loc>https://padelnachos.com/es/home</loc></url>
</urlset>`
    const r = parseSitemapXml(xml)
    expect(r.kind).toBe('urlset')
    expect(r.urls).toEqual([
      'https://padelnachos.com/home',
      'https://padelnachos.com/matches',
      'https://padelnachos.com/es/home',
    ])
  })

  it('handles XML-escaped ampersands in URLs', () => {
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://padelnachos.com/q?a=1&amp;b=2</loc></url>
    </urlset>`
    const r = parseSitemapXml(xml)
    expect(r.urls).toEqual(['https://padelnachos.com/q?a=1&b=2'])
  })

  it('returns empty on garbage', () => {
    const r = parseSitemapXml('<html>not a sitemap</html>')
    expect(r.urls).toEqual([])
  })
})
