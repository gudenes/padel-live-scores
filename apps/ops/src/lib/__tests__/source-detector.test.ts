import { describe, it, expect } from 'vitest'
import { matchUrlPattern, parseFeedXml, extractLanguageFromTld, normalizeUrl } from '../source-detector'

describe('matchUrlPattern (no network)', () => {
  it('matches Google News RSS search', () => {
    expect(matchUrlPattern('https://news.google.com/rss/search?q=padel&hl=es')).toBe('google-news-search')
    expect(matchUrlPattern('https://news.google.com/rss/search?q=foo')).toBe('google-news-search')
  })

  it('matches WordPress JSON API', () => {
    expect(matchUrlPattern('https://example.com/wp-json/wp/v2/posts')).toBe('wp-api')
    expect(matchUrlPattern('https://example.com/wp-json/wp/v2/posts?per_page=10')).toBe('wp-api')
  })

  it('does NOT match WP-API on bogus suffix paths', () => {
    expect(matchUrlPattern('https://example.com/wp-json/wp/v2/posts-preview')).toBeNull()
    expect(matchUrlPattern('https://example.com/wp-json/wp/v2/posts-other-thing')).toBeNull()
  })

  it('also matches WP-API single-post path', () => {
    expect(matchUrlPattern('https://example.com/wp-json/wp/v2/posts/123')).toBe('wp-api')
  })

  it('matches common RSS shapes', () => {
    expect(matchUrlPattern('https://example.com/feed/')).toBe('rss')
    expect(matchUrlPattern('https://example.com/feed')).toBe('rss')
    expect(matchUrlPattern('https://example.com/rss/')).toBe('rss')
    expect(matchUrlPattern('https://example.com/rss')).toBe('rss')
    expect(matchUrlPattern('https://example.com/atom.xml')).toBe('rss')
    expect(matchUrlPattern('https://example.com/podcast.rss')).toBe('rss')
  })

  it('returns null for unmatched URLs', () => {
    expect(matchUrlPattern('https://example.com/')).toBeNull()
    expect(matchUrlPattern('https://example.com/news/article-123')).toBeNull()
  })
})

describe('parseFeedXml', () => {
  it('parses RSS 2.0 channel title + 3 items', () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
      <title>Sport · Más Deportes</title>
      <language>es-ES</language>
      <item><title>Item A</title><pubDate>Mon, 18 May 2026 10:00:00 GMT</pubDate><description>desc A</description></item>
      <item><title>Item B</title></item>
      <item><title>Item C</title></item>
      <item><title>Item D</title></item>
    </channel></rss>`
    const parsed = parseFeedXml(rss)
    expect(parsed).toEqual({
      type: 'rss',
      name: 'Sport · Más Deportes',
      language: 'es',
      sample: [
        { title: 'Item A', pubDate: 'Mon, 18 May 2026 10:00:00 GMT', snippet: 'desc A' },
        { title: 'Item B' },
        { title: 'Item C' },
      ],
    })
  })

  it('parses Atom feed title', () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <title>My Atom Feed</title>
      <entry><title>Entry 1</title><updated>2026-05-18T10:00:00Z</updated></entry>
    </feed>`
    const parsed = parseFeedXml(atom)
    expect(parsed?.type).toBe('rss')
    expect(parsed?.name).toBe('My Atom Feed')
    expect(parsed?.sample).toHaveLength(1)
    expect(parsed?.sample[0].title).toBe('Entry 1')
  })

  it('returns null for non-feed XML', () => {
    expect(parseFeedXml('<html><body>not a feed</body></html>')).toBeNull()
    expect(parseFeedXml('')).toBeNull()
  })
})

describe('extractLanguageFromTld', () => {
  it('maps known TLDs', () => {
    expect(extractLanguageFromTld('https://sport.es')).toBe('es')
    expect(extractLanguageFromTld('https://example.fr/path')).toBe('fr')
    expect(extractLanguageFromTld('https://example.it')).toBe('it')
    expect(extractLanguageFromTld('https://example.pt')).toBe('pt')
    expect(extractLanguageFromTld('https://example.com.br')).toBe('pt')
  })
  it('defaults to en for unknown TLDs', () => {
    expect(extractLanguageFromTld('https://example.com')).toBe('en')
    expect(extractLanguageFromTld('https://example.io')).toBe('en')
  })
})

describe('normalizeUrl', () => {
  it('lowercases host, strips trailing slash, strips utm_*', () => {
    expect(normalizeUrl('https://Sport.ES/padel/?utm_source=x&utm_campaign=y'))
      .toBe('https://sport.es/padel')
    expect(normalizeUrl('https://example.com/'))
      .toBe('https://example.com')
    expect(normalizeUrl('https://example.com/path/?keep=1&utm_source=x'))
      .toBe('https://example.com/path?keep=1')
  })
})

import { findFeedLinkInHtml, extractHtmlTitle, extractHtmlLang } from '../source-detector'

describe('findFeedLinkInHtml', () => {
  it('finds an absolute RSS link', () => {
    const html = `<head><link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml" title="Site Feed"></head>`
    expect(findFeedLinkInHtml(html, 'https://example.com/')).toBe('https://example.com/feed.xml')
  })

  it('resolves a relative RSS link against the page URL', () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="/feed/">`
    expect(findFeedLinkInHtml(html, 'https://example.com/section/padel/'))
      .toBe('https://example.com/feed/')
  })

  it('finds an Atom link if no RSS is present', () => {
    const html = `<link rel="alternate" type="application/atom+xml" href="/atom.xml">`
    expect(findFeedLinkInHtml(html, 'https://example.com')).toBe('https://example.com/atom.xml')
  })

  it('prefers RSS over Atom when both are declared', () => {
    const html = `
      <link rel="alternate" type="application/atom+xml" href="/atom.xml">
      <link rel="alternate" type="application/rss+xml" href="/feed/">
    `
    expect(findFeedLinkInHtml(html, 'https://example.com')).toBe('https://example.com/feed/')
  })

  it('returns null when no feed link is declared', () => {
    expect(findFeedLinkInHtml('<html><body>nothing</body></html>', 'https://example.com')).toBeNull()
  })
})

describe('extractHtmlTitle / extractHtmlLang', () => {
  it('extracts <title>', () => {
    expect(extractHtmlTitle('<html><head><title>Hello World</title></head></html>'))
      .toBe('Hello World')
  })
  it('extracts <html lang>', () => {
    expect(extractHtmlLang('<html lang="es-ES"><body></body></html>')).toBe('es')
    expect(extractHtmlLang('<html lang="en"><body></body></html>')).toBe('en')
    expect(extractHtmlLang('<html><body></body></html>')).toBeUndefined()
  })
})

import { detectSource } from '../source-detector'

function fakeFetch(responses: Record<string, { status: number; contentType?: string; body: string }>) {
  return async (url: string): Promise<Response> => {
    const r = responses[url]
    if (!r) return new Response('not found', { status: 404 })
    return new Response(r.body, {
      status: r.status,
      headers: r.contentType ? { 'content-type': r.contentType } : {},
    })
  }
}

describe('detectSource (full ladder)', () => {
  it('Step 1 fast-path: Google News URL needs no network', async () => {
    const fetcher = fakeFetch({}) // no responses needed — never called
    const result = await detectSource('https://news.google.com/rss/search?q=padel&hl=es', { fetcher })
    expect(result.type).toBe('google-news-search')
    expect(result.url).toBe('https://news.google.com/rss/search?q=padel&hl=es')
  })

  it('Step 2: content-sniff RSS returns rss with sample', async () => {
    const fetcher = fakeFetch({
      'https://blog.example.com/feed': {
        status: 200,
        contentType: 'application/rss+xml',
        body: `<rss><channel><title>Blog</title><language>en</language>
          <item><title>Post One</title></item>
          <item><title>Post Two</title></item>
          </channel></rss>`,
      },
    })
    const result = await detectSource('https://blog.example.com/feed', { fetcher })
    expect(result.type).toBe('rss')
    expect(result.name).toBe('Blog')
    expect(result.language).toBe('en')
    expect(result.sample).toHaveLength(2)
  })

  it('Step 3: HTML auto-discovery follows <link rel="alternate">', async () => {
    const fetcher = fakeFetch({
      'https://example.es/padel/': {
        status: 200,
        contentType: 'text/html',
        body: `<html lang="es"><head><title>Padel News</title>
          <link rel="alternate" type="application/rss+xml" href="/padel/feed.xml">
        </head><body>...</body></html>`,
      },
      'https://example.es/padel/feed.xml': {
        status: 200,
        contentType: 'application/rss+xml',
        body: `<rss><channel><title>Padel Feed</title>
          <item><title>News A</title></item></channel></rss>`,
      },
    })
    const result = await detectSource('https://example.es/padel/', { fetcher })
    expect(result.type).toBe('rss')
    expect(result.url).toBe('https://example.es/padel/feed.xml')
    expect(result.name).toBe('Padel Feed')
    expect(result.language).toBe('es')
  })

  it('Step 4: common-path fallback hits /feed/ when HTML had no alternate', async () => {
    const fetcher = fakeFetch({
      'https://example.com/': {
        status: 200,
        contentType: 'text/html',
        body: `<html><body>plain page no alternate</body></html>`,
      },
      'https://example.com/feed/': {
        status: 200,
        contentType: 'application/rss+xml',
        body: `<rss><channel><title>Fallback Feed</title>
          <item><title>Hi</title></item></channel></rss>`,
      },
    })
    const result = await detectSource('https://example.com/', { fetcher })
    expect(result.type).toBe('rss')
    expect(result.name).toBe('Fallback Feed')
  })

  it('Step 5: returns unknown with notes when everything fails', async () => {
    const fetcher = fakeFetch({
      'https://nothing.example/': { status: 200, contentType: 'text/html', body: '<html><body>nope</body></html>' },
    })
    const result = await detectSource('https://nothing.example/', { fetcher })
    expect(result.type).toBe('unknown')
    expect(result.notes).toMatch(/no feed/i)
  })

  it('returns unknown on invalid URL without throwing', async () => {
    const result = await detectSource('not a url', { fetcher: fakeFetch({}) })
    expect(result.type).toBe('unknown')
  })
})
