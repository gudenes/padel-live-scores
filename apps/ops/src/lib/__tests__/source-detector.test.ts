import { describe, it, expect } from 'vitest'
import { matchUrlPattern } from '../source-detector'

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
