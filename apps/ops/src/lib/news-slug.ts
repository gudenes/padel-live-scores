// apps/ops/src/lib/news-slug.ts
// Convert arbitrary title text into a URL-safe slug.
// Used in the ops authoring UI (auto-fill from title) and by the
// translator when generating slugs for non-EN locales.

const MAX_SLUG_LENGTH = 80

/** Generates a kebab-case ASCII slug from arbitrary text. */
export function generateSlug(input: string): string {
  if (!input) return ''

  // Normalize and strip diacritics (NFD splits composed chars; the regex
  // strips the combining marks left behind).
  const normalized = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

  // Replace anything not [a-z0-9] with a hyphen
  const hyphenated = normalized.replace(/[^a-z0-9]+/g, '-')

  // Collapse runs and trim
  const cleaned = hyphenated.replace(/-+/g, '-').replace(/^-|-$/g, '')

  if (cleaned.length <= MAX_SLUG_LENGTH) return cleaned

  // Truncate on a word boundary
  const truncated = cleaned.slice(0, MAX_SLUG_LENGTH)
  const lastHyphen = truncated.lastIndexOf('-')
  if (lastHyphen > 0) return truncated.slice(0, lastHyphen)
  return truncated
}
