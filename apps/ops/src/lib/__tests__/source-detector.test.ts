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
