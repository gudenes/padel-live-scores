// Pure builder for the in-page Projection tab query string. Used by the
// tournament page to shallow-sync the active projection view into the URL
// (?tab=projection&category=<cat>[&pair=<slug>]) so it's deep-linkable
// without a route navigation.

export function buildProjectionQuery(
  category: 'men' | 'women',
  pairSlug: string | null,
): string {
  const base = `?tab=projection&category=${category}`
  return pairSlug ? `${base}&pair=${encodeURIComponent(pairSlug)}` : base
}

/** Absolute canonical URL for a pair's projection page.
 *  Mirrors next-intl `localePrefix: 'as-needed'` — English ('en') gets no prefix. */
export function buildProjectionShareUrl(
  origin: string,
  locale: string,
  tournamentId: string,
  pairSlug: string,
): string {
  const prefix = locale === 'en' ? '' : `/${locale}`
  return `${origin}${prefix}/tournaments/${tournamentId}/projection/${pairSlug}`
}

export interface ProjectionShareInput {
  pair: string
  tournamentName: string
  status: 'active' | 'eliminated' | 'champion'
}

/** Localized {title,text} for the share sheet, adapting to the pair's status.
 *  Deliberately percentage-free — a low/0% title chance reads badly when shared,
 *  so active pairs get a "road to the title" framing instead of the odds. */
export function buildProjectionSharePayload(
  input: ProjectionShareInput,
  t: (key: string, values?: Record<string, string | number | Date>) => string,
): { title: string; text: string } {
  const title = t('shareTitle', { pair: input.pair })
  const text =
    input.status === 'champion'
      ? t('shareTextChampion', { name: input.tournamentName })
      : input.status === 'eliminated'
      ? t('shareTextEliminated', { name: input.tournamentName })
      : t('shareTextContender', { pair: input.pair, name: input.tournamentName })
  return { title, text }
}
