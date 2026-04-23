// Country-code normalization for padelgod captures.
//
// Canonical storage format: ISO 3166-1 alpha-2 ("ES"). Every source
// we scrape emits either alpha-2 (padelapi) or alpha-3 (Crionet flag
// filenames, padelfip WP events + search API, ranking tables). This
// module lives at the WRITE boundary — parsers call `normalizeCountry`
// before returning, so downstream tables receive a uniform alpha-2.
//
// Canonical mapping table: `country-codes-3to2.json` (sibling file).
// The same JSON is duplicated at `/shared/country-codes-3to2.json`
// for Next.js consumption (padelgod's tsconfig `rootDir: ./src`
// prevents reaching outside this directory). A vitest drift check in
// `__tests__/lib/country-map-sync.test.ts` fails CI if the two copies
// diverge — keep them in sync.
//
// Why alpha-2
// -----------
// 1. Flag emoji are built from alpha-2 regional-indicator pairs.
// 2. Padelapi already writes alpha-2 — aligning with the primary
//    source costs nothing.
// 3. Web conventions (HTML lang, Intl APIs) are alpha-2.
//
// Unknown codes policy
// --------------------
// Unmapped 3-letter codes return `null`, NOT pass-through upper-cased.
// The `country` columns have a CHECK constraint
//   `country IS NULL OR length(country) = 2`
// so pass-through would hard-fail the write. Null is the "unknown
// country" signal; ops data-quality views surface null-country rows
// for manual triage + adding to the shared map.
//
// A `console.warn` also fires so unknown codes are visible in Railway
// logs. Production log pipelines can grep for `[country] unknown
// code` to trigger a mapping update PR.

import CC3_TO_CC2 from './country-codes-3to2.json' with { type: 'json' };

export function normalizeCountry(c: string | null | undefined): string | null {
  if (c == null) return null;
  const trimmed = c.trim();
  if (trimmed.length === 0) return null;
  const up = trimmed.toUpperCase();
  if (up.length === 2) return up;
  const mapped = (CC3_TO_CC2 as Record<string, string>)[up];
  if (mapped) return mapped;
  // Unknown 3+ letter code. Surface + return null so the row lands
  // with country=null instead of violating the CHECK constraint.
  // eslint-disable-next-line no-console
  console.warn(
    `[country] unknown code "${up}" → null (add to shared/country-codes-3to2.json + padelgod/src/lib/country-codes-3to2.json)`
  );
  return null;
}

// Re-export the loaded JSON so the drift test can compare it against
// the `/shared/` copy without round-tripping through normalizeCountry.
export const COUNTRY_MAP = CC3_TO_CC2 as Record<string, string>;
