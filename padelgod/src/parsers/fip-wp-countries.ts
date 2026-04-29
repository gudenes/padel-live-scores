// Parses the response from `https://www.padelfip.com/wp-json/wp/v2/country`.
//
// The `country` taxonomy on padelfip.com keys events by a 3-letter code
// in either `name` (FIP's own variant — e.g. "SIN" for Singapore) or
// `acf.standard_cio` (proper ISO 3166-1 alpha-3 — e.g. "SGP"). Both
// resolve through `normalizeCountry` to alpha-2, which is what the
// `tournaments.country` column stores. We prefer `acf.standard_cio`
// when it's present and non-empty since it's the official code.

import { normalizeCountry } from '../lib/country.js';

export interface RawCountryTerm {
  id: number;
  name?: string;
  slug?: string;
  acf?: {
    standard_cio?: string | null;
    full_name?: string | null;
  };
}

/**
 * Build a `termId → alpha-2` map. Terms whose code can't be normalised
 * (unknown 3-letter code) land in the map as `null` — callers should
 * treat that the same as a missing entry.
 */
export function parseFipWpCountries(
  terms: RawCountryTerm[],
): Map<number, string | null> {
  const out = new Map<number, string | null>();
  if (!Array.isArray(terms)) return out;
  for (const t of terms) {
    if (typeof t?.id !== 'number') continue;
    const cio = t.acf?.standard_cio?.trim();
    const name = t.name?.trim();
    const code = cio && cio.length > 0 ? cio : name;
    out.set(t.id, normalizeCountry(code ?? null));
  }
  return out;
}
