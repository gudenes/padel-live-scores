// src/lib/country.ts
//
// Country-code normalisation for the public app. Pulls the canonical
// alpha-3 → alpha-2 mapping from `/shared/country-codes-3to2.json`
// (mirrored into `padelgod/src/lib/country-codes-3to2.json`; the
// drift test in `country-map-sync.test.ts` enforces sync).
//
// Lives in a leaf file with no other deps so browser components like
// `FlagImage` and `thin-match-player` can import it without dragging
// in `player-resolver.ts`'s Supabase client. `player-resolver.ts`
// re-exports `normalizeCountry` from here so its existing call sites
// don't need to move.
//
// Unknown-code policy: return NULL (not pass-through). The DB has a
// CHECK constraint `country IS NULL OR length(country) = 2`, so any
// pass-through would hard-fail the write. Null is the "unknown
// country" signal; ops data-quality views surface null-country rows
// for manual triage.

import COUNTRY_3TO2_JSON from '../../shared/country-codes-3to2.json'

const COUNTRY_3TO2: Record<string, string> = COUNTRY_3TO2_JSON

/**
 * Normalise an arbitrary country string (alpha-2 or alpha-3, mixed
 * case) to the canonical alpha-2 representation we store in
 * `players.country`. Returns null when the input is empty/unknown so
 * callers can render a no-flag fallback instead of a broken image.
 *
 * Logs a console.warn on unknown alpha-3 codes so they show up in
 * Vercel function logs / browser devtools — adding new codes to
 * `shared/country-codes-3to2.json` is the standard fix.
 */
export function normalizeCountry(c: string | null | undefined): string | null {
  if (!c) return null
  const trimmed = c.trim()
  if (trimmed.length === 0) return null
  const up = trimmed.toUpperCase()
  if (up.length === 2) return up
  const mapped = COUNTRY_3TO2[up]
  if (mapped) return mapped
  // eslint-disable-next-line no-console
  console.warn(
    `[country] unknown code "${up}" → null (add to shared/country-codes-3to2.json)`,
  )
  return null
}
