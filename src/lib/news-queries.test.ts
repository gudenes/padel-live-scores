// src/lib/news-queries.test.ts
import { describe, expect, it } from 'vitest'
import { mergeWithFallback } from './news-queries'
import type { NewsPost } from '@/types/news'

const makePost = (over: Partial<NewsPost>): NewsPost => ({
  id: 'id-' + Math.random(),
  category: 'announcements',
  locale: 'en',
  slug: 'slug',
  title: 'Title',
  body_md: 'Body',
  cover_image_url: null,
  translated_from: null,
  status: 'published',
  published_at: '2026-05-08T00:00:00Z',
  created_at: '2026-05-08T00:00:00Z',
  updated_at: '2026-05-08T00:00:00Z',
  model: null,
  ...over,
})

describe('mergeWithFallback', () => {
  it('returns localized rows when all posts have translations', () => {
    const en = [makePost({ id: 'en-1', locale: 'en', slug: 'a' })]
    const localized = [makePost({ id: 'es-1', locale: 'es', slug: 'a-es', translated_from: 'en-1' })]
    expect(mergeWithFallback(en, localized).map(p => p.id)).toEqual(['es-1'])
  })

  it('falls back to EN for posts without a translation', () => {
    const en = [makePost({ id: 'en-1', locale: 'en', slug: 'a' })]
    const localized: NewsPost[] = []
    expect(mergeWithFallback(en, localized).map(p => p.id)).toEqual(['en-1'])
  })

  it('mixes translated and EN-fallback rows correctly', () => {
    const en = [
      makePost({ id: 'en-1', locale: 'en', slug: 'a', published_at: '2026-05-08T00:00:00Z' }),
      makePost({ id: 'en-2', locale: 'en', slug: 'b', published_at: '2026-05-07T00:00:00Z' }),
    ]
    const localized = [
      makePost({ id: 'es-1', locale: 'es', slug: 'a-es', translated_from: 'en-1', published_at: '2026-05-08T00:00:00Z' }),
    ]
    const result = mergeWithFallback(en, localized)
    expect(result.map(p => p.id)).toEqual(['es-1', 'en-2'])
  })

  it('sorts by published_at descending', () => {
    const en = [
      makePost({ id: 'en-old', locale: 'en', slug: 'old', published_at: '2026-01-01T00:00:00Z' }),
      makePost({ id: 'en-new', locale: 'en', slug: 'new', published_at: '2026-05-08T00:00:00Z' }),
    ]
    expect(mergeWithFallback(en, []).map(p => p.id)).toEqual(['en-new', 'en-old'])
  })

  it('returns empty array when both inputs are empty', () => {
    expect(mergeWithFallback([], [])).toEqual([])
  })
})
