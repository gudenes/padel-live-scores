// src/lib/seo-helpers.ts
// Shared SEO utilities for generating canonical URLs and i18n alternates.

const BASE_URL = 'https://padelnachos.com'
const LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const

/**
 * Build alternates metadata for a given path.
 * Generates a self-canonical URL for the active locale and hreflang entries
 * pointing at each locale's own URL. `x-default` points at the English URL.
 *
 * Usage in generateMetadata():
 *   return { ...buildAlternates('/match/abc-123', locale) }
 *
 * If `locale` is omitted, canonical defaults to the English URL for
 * backward compatibility with legacy call sites that don't yet pass locale.
 *
 * On /es/match/abc-123: canonical = https://padelnachos.com/es/match/abc-123
 * On /match/abc-123:    canonical = https://padelnachos.com/match/abc-123
 */
export function buildAlternates(path: string, locale?: string) {
  // Ensure path starts with /
  const cleanPath = path.startsWith('/') ? path : `/${path}`

  const urlFor = (loc: string): string =>
    loc === 'en' ? `${BASE_URL}${cleanPath}` : `${BASE_URL}/${loc}${cleanPath}`

  const languages: Record<string, string> = {}
  for (const loc of LOCALES) {
    languages[loc] = urlFor(loc)
  }
  languages['x-default'] = `${BASE_URL}${cleanPath}`

  const canonical = locale && (LOCALES as readonly string[]).includes(locale)
    ? urlFor(locale)
    : `${BASE_URL}${cleanPath}`

  return {
    alternates: {
      canonical,
      languages,
    },
  }
}
