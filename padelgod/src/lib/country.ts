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

// Non-standard alpha-2 codes some upstreams emit, remapped to the real
// ISO 3166-1 alpha-2. The 2-char branch below otherwise trusts any
// two-letter input verbatim, so a source quirk would persist an invalid
// code in `tournaments.country` / `players.country` — and no flag asset
// (local PNG or flagcdn) exists for it, so the UI renders no flag.
//   - IV: padelapi's code for Côte d'Ivoire (ISO is CI). Caught the
//     2026 FIP Gold Abidjan event showing no flag.
// Keep in sync with src/lib/country.ts (same const).
const ALPHA2_ALIASES: Record<string, string> = {
  IV: 'CI', // Côte d'Ivoire (padelapi non-standard)
};

export function normalizeCountry(c: string | null | undefined): string | null {
  if (c == null) return null;
  const trimmed = c.trim();
  if (trimmed.length === 0) return null;
  const up = trimmed.toUpperCase();
  if (up.length === 2) return ALPHA2_ALIASES[up] ?? up;
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

// ─── FIP event-page country-name map ────────────────────────────────────────
//
// padelfip.com encodes countries in flag image filenames using English-ish
// country NAMES (not ISO codes). Examples:
//   .../Spain_Fip.jpg        → "SPAIN"
//   .../Argentina_Fip.jpg    → "ARGENTINA"
//   .../TheNetherlands_Fip.jpg → "THENETHERLANDS"
//   .../Marocco_Fip.jpg      → "MAROCCO"  (Italian spelling)
//   .../Israele_Fip.jpg      → "ISRAELE"  (Italian spelling)
//
// `normalizeCountry` above only knows alpha-3 codes. Running FIP names
// through it returns null AND emits one `console.warn` per team, which
// Railway classifies as ERROR severity — the 2026-04-23 Brussels dry-run
// produced 995 spurious "errors" in 2 minutes with zero actual problems.
//
// This map is the FIP-specific layer. Keyed by the UPPERCASED filename
// stem (whatever appears before `_Fip.jpg`), value is ISO 3166-1 alpha-2.
// Populated initially from the distinct values observed in the Brussels
// dry-run logs (30 countries) plus a reasonable padding of major padel
// nations we haven't seen yet but certainly will.
//
// Unknown keys return null SILENTLY (no warn). Rationale: the FIP layer
// is append-only via scheduled cron, so an unknown key lands `country=null`
// and ops can surface it via a data-quality view. Log spam at error
// severity would drown real issues.
const FIP_NAME_TO_ALPHA2: Record<string, string> = {
  // Seen in Brussels 2026-04-23 logs (sorted; FIP's odd spellings preserved):
  ARGENTINA: 'AR',
  ARMENIA: 'AM',
  AUSTRALIA: 'AU',
  BELGIUM: 'BE',
  BRAZIL: 'BR',
  CANADA: 'CA',
  CHILE: 'CL',
  CHINA: 'CN',
  DENMARK: 'DK',
  EGYPT: 'EG',
  FRANCE: 'FR',
  GERMANY: 'DE',
  GREATBRITAIN: 'GB',
  IRAN: 'IR',
  ISRAELE: 'IL',       // Italian spelling FIP uses
  ITALY: 'IT',
  JAPAN: 'JP',
  LUXEMBURG: 'LU',     // non-standard English spelling
  MAROCCO: 'MA',       // Italian spelling FIP uses
  MEXICO: 'MX',
  PARAGUAY: 'PY',
  POLAND: 'PL',
  PORTUGAL: 'PT',
  ROMANIA: 'RO',
  SLOVENIA: 'SI',
  SPAIN: 'ES',
  SWEDEN: 'SE',
  THENETHERLANDS: 'NL',
  UKRAINE: 'UA',
  VENEZUELA: 'VE',
  // Additional common padel nations not yet observed but likely to appear:
  ANDORRA: 'AD',
  AUSTRIA: 'AT',
  BULGARIA: 'BG',
  CROATIA: 'HR',
  CYPRUS: 'CY',
  CZECHREPUBLIC: 'CZ',
  DOMINICANREPUBLIC: 'DO',
  ECUADOR: 'EC',
  ESTONIA: 'EE',
  FINLAND: 'FI',
  GREECE: 'GR',
  HUNGARY: 'HU',
  INDIA: 'IN',
  INDONESIA: 'ID',
  IRELAND: 'IE',
  KAZAKHSTAN: 'KZ',
  KUWAIT: 'KW',
  LATVIA: 'LV',
  LITHUANIA: 'LT',
  MALAYSIA: 'MY',
  NETHERLANDS: 'NL',   // alternate spelling without "The"
  NEWZEALAND: 'NZ',
  NORWAY: 'NO',
  PANAMA: 'PA',
  PERU: 'PE',
  PHILIPPINES: 'PH',
  QATAR: 'QA',
  RUSSIA: 'RU',
  SAUDIARABIA: 'SA',
  SERBIA: 'RS',
  SINGAPORE: 'SG',
  SLOVAKIA: 'SK',
  SOUTHAFRICA: 'ZA',
  SOUTHKOREA: 'KR',
  SWITZERLAND: 'CH',
  THAILAND: 'TH',
  TUNISIA: 'TN',
  TURKEY: 'TR',
  UAE: 'AE',
  UK: 'GB',
  UNITEDKINGDOM: 'GB',
  UNITEDSTATES: 'US',
  URUGUAY: 'UY',
  USA: 'US',
};

/**
 * Map a padelfip.com flag-filename country NAME (e.g. "Spain", "TheNetherlands",
 * "Marocco") to ISO 3166-1 alpha-2. Returns null for unknown names (silently —
 * use the data-quality view `null_country_fip_draw_rows` to surface them).
 *
 * Case-insensitive — callers can pass either the raw filename stem or an
 * already-uppercased string.
 */
export function fipCountryNameToAlpha2(name: string | null | undefined): string | null {
  if (name == null) return null;
  const key = name.trim().toUpperCase();
  if (key.length === 0) return null;
  return FIP_NAME_TO_ALPHA2[key] ?? null;
}
