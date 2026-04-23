// Country-code normalization for padelgod captures.
//
// Every source we scrape emits country codes in one of two formats:
//
//   - `alpha-2` (ISO 3166-1 alpha-2)  — "ES", "AR", "BR"
//       Used by padelapi.org and the web platform at large (HTML lang,
//       flag emoji, Intl APIs, most CDN flag libraries).
//
//   - `alpha-3` (ISO 3166-1 alpha-3) — "ESP", "ARG", "BRA"
//       What padelfip.com and matchscorerlive.com (Crionet) emit from
//       their flag-image URLs (e.g. /images/flags/ESP.jpg).
//
// Historically we stored whatever the source returned, which produced
// a mixed-format column. Downstream consumers like flag-emoji renderers
// only understand alpha-2, so 93 % of Brussels players rendered no flag
// until we added a display-time shim (`countryFlag` in
// `src/types/match.ts`).
//
// Canonical choice going forward: **alpha-2**. This module is the
// write-time normalization point for every padelgod capture — parsers
// call `normalizeCountry()` before returning, so the shape of
// `entry_list_snapshots.country`, `draw_snapshots.team1_country`, etc.
// is uniform. The Next.js-side display shim stays as defense-in-depth.
//
// Mapping covers every 3-letter code we've actually seen in our data
// plus FIFA-style aliases FIP occasionally returns (POR/NED/GER/SUI…).
// Unknown inputs pass through unchanged, upper-cased — so the column
// stays queryable even if we add a new source that emits a code we
// haven't seen before. Unknown codes trigger no rendering but also
// don't throw; they're visible in the Ops data-quality view for manual
// triage.

const CC3_TO_CC2: Record<string, string> = {
  // Iberia + Americas
  ESP: 'ES', ARG: 'AR', BRA: 'BR', PRT: 'PT', POR: 'PT',
  URY: 'UY', URU: 'UY', PRY: 'PY', PAR: 'PY',
  CHL: 'CL', CHI: 'CL', MEX: 'MX', USA: 'US',
  COL: 'CO', PER: 'PE', CRI: 'CR', CRC: 'CR',
  ECU: 'EC', BOL: 'BO',

  // Western Europe
  FRA: 'FR', ITA: 'IT', BEL: 'BE', NLD: 'NL', NED: 'NL',
  DEU: 'DE', GER: 'DE', GBR: 'GB', DNK: 'DK', DEN: 'DK',
  SWE: 'SE', FIN: 'FI', NOR: 'NO', AUT: 'AT',
  CHE: 'CH', SUI: 'CH', IRL: 'IE', GRC: 'GR', GRE: 'GR',

  // Central/Eastern Europe
  POL: 'PL', CZE: 'CZ', HRV: 'HR', CRO: 'HR',
  ROU: 'RO', UKR: 'UA',

  // Middle East + Africa
  QAT: 'QA', ARE: 'AE', UAE: 'AE', EGY: 'EG',
  SAU: 'SA', BHR: 'BH', KWT: 'KW', MAR: 'MA',
  ZAF: 'ZA', RSA: 'ZA',

  // Asia-Pacific
  JPN: 'JP', KOR: 'KR', CHN: 'CN', IND: 'IN', AUS: 'AU',
};

/**
 * Normalize a country code to ISO 3166-1 alpha-2, or null when empty.
 *
 * Behaviour:
 *   - null / undefined / '' → null
 *   - alpha-2 (already) → upper-cased pass-through
 *   - known alpha-3 → mapped to alpha-2
 *   - unknown → upper-cased pass-through (won't render as a flag but
 *     preserved for debuggability)
 *
 * Intended for use at every WRITE site where a scraped country lands
 * in a DB column. Never called at read time — the DB should already
 * hold normalized values after this module rolls out.
 */
export function normalizeCountry(c: string | null | undefined): string | null {
  if (c == null) return null;
  const trimmed = c.trim();
  if (trimmed.length === 0) return null;
  const up = trimmed.toUpperCase();
  if (up.length === 2) return up;
  return CC3_TO_CC2[up] ?? up;
}
