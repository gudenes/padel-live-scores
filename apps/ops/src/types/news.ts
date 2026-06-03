// apps/ops/src/types/news.ts
// Shared types for the first-party news section.

export type NewsCategory = 'announcements' | 'product' | 'insights'
export type NewsLocale = 'en' | 'es' | 'pt' | 'it' | 'fr'
export type NewsStatus = 'draft' | 'published'

export const NEWS_CATEGORIES: NewsCategory[] = ['announcements', 'product', 'insights']
export const NEWS_LOCALES: NewsLocale[] = ['en', 'es', 'pt', 'it', 'fr']
export const NON_EN_LOCALES: NewsLocale[] = ['es', 'pt', 'it', 'fr']

export interface NewsPost {
  id: string
  category: NewsCategory
  locale: NewsLocale
  slug: string
  title: string
  body_md: string
  cover_image_url: string | null
  translated_from: string | null
  status: NewsStatus
  published_at: string | null
  created_at: string
  updated_at: string
  model: string | null
}

/** Translation status for a single non-EN locale of an EN post. */
export interface NewsTranslationStatus {
  locale: NewsLocale  // one of NON_EN_LOCALES
  state: 'translated' | 'pending' | 'error'
  errorMessage?: string
}
