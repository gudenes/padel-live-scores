// Canonical, shareable URL for a player profile.
//
// Built from the locale and the id rather than window.location.href: the
// live URL accumulates ?tab= and ?season= as the visitor navigates, and
// sharing those hands someone a view they never chose to share.

import { routing } from '@/i18n/routing'

const BASE_URL = 'https://padelnachos.com'

/**
 * `localePrefix` is 'as-needed', so the default locale has NO prefix:
 * /player/<id> resolves, /en/player/<id> is a 307. An unknown locale falls
 * back to the unprefixed form, which always resolves.
 */
export function buildShareUrl(locale: string, playerId: string): string {
  const known = (routing.locales as readonly string[]).includes(locale)
  const prefix = known && locale !== routing.defaultLocale ? `/${locale}` : ''
  return `${BASE_URL}${prefix}/player/${playerId}`
}
