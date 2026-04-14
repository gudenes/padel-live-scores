// src/lib/seo-helpers.ts
// Shared SEO utilities for generating canonical URLs and i18n alternates.

const BASE_URL = 'https://padelnachos.com'
const LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const

/**
 * Build alternates metadata for a given path.
 * Generates canonical URL (English, no prefix) and hreflang entries for all locales.
 *
 * Usage in generateMetadata():
 *   return { ...buildAlternates('/match/abc-123') }
 *
 * For English (default): https://padelnachos.com/match/abc-123
 * For Spanish: https://padelnachos.com/es/match/abc-123
 */
export function buildAlternates(path: string) {
  // Ensure path starts with /
  const cleanPath = path.startsWith('/') ? path : `/${path}`

  const languages: Record<string, string> = {}
  for (const locale of LOCALES) {
    if (locale === 'en') {
      languages[locale] = `${BASE_URL}${cleanPath}`
    } else {
      languages[locale] = `${BASE_URL}/${locale}${cleanPath}`
    }
  }
  languages['x-default'] = `${BASE_URL}${cleanPath}`

  return {
    alternates: {
      canonical: `${BASE_URL}${cleanPath}`,
      languages,
    },
  }
}
