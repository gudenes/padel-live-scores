// ISO-3166 alpha-2 → English country name, plus a flag-emoji helper.
// Covers the country codes used across `regions.ts`. Shared by the ops
// "Availability by Country" admin and any other surface that needs to show
// a friendly country label. Mirrored byte-for-byte into
// apps/ops/src/lib/where-to-watch/iso2-names.ts (apps/ops is a separate
// package with its own path alias).

export const COUNTRY_NAMES: Record<string, string> = {
  // Latin America
  ar: 'Argentina', bo: 'Bolivia', br: 'Brazil', cl: 'Chile', co: 'Colombia',
  cr: 'Costa Rica', cu: 'Cuba', do: 'Dominican Republic', ec: 'Ecuador',
  gt: 'Guatemala', hn: 'Honduras', mx: 'Mexico', ni: 'Nicaragua', pa: 'Panama',
  pe: 'Peru', pr: 'Puerto Rico', py: 'Paraguay', sv: 'El Salvador',
  uy: 'Uruguay', ve: 'Venezuela',
  // Europe
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', pt: 'Portugal',
  nl: 'Netherlands', be: 'Belgium', gb: 'United Kingdom', ie: 'Ireland',
  se: 'Sweden', no: 'Norway', dk: 'Denmark', fi: 'Finland', pl: 'Poland',
  cz: 'Czechia', at: 'Austria', ch: 'Switzerland', gr: 'Greece', ro: 'Romania',
  hu: 'Hungary', ua: 'Ukraine', rs: 'Serbia', hr: 'Croatia', bg: 'Bulgaria',
  sk: 'Slovakia',
  // Middle East & North Africa
  ae: 'United Arab Emirates', sa: 'Saudi Arabia', qa: 'Qatar', kw: 'Kuwait',
  bh: 'Bahrain', om: 'Oman', jo: 'Jordan', lb: 'Lebanon', il: 'Israel',
  eg: 'Egypt', ma: 'Morocco', tn: 'Tunisia', dz: 'Algeria',
  // Asia & Pacific
  jp: 'Japan', cn: 'China', kr: 'South Korea', in: 'India', id: 'Indonesia',
  th: 'Thailand', vn: 'Vietnam', ph: 'Philippines', my: 'Malaysia',
  sg: 'Singapore', au: 'Australia', nz: 'New Zealand', hk: 'Hong Kong',
  tw: 'Taiwan',
  // North America
  us: 'United States', ca: 'Canada',
  // Africa
  za: 'South Africa', ng: 'Nigeria', ke: 'Kenya', gh: 'Ghana', sn: 'Senegal',
  ci: 'Côte d’Ivoire', cm: 'Cameroon', ao: 'Angola', mz: 'Mozambique',
  tz: 'Tanzania',
  // Other common markets that may appear in rules / broadcaster data
  ru: 'Russia',
}

/** Friendly country name for an ISO-3166 alpha-2 code. Falls back to the
 *  uppercased code when unknown so the UI never renders blank. */
export function countryName(iso2: string): string {
  return COUNTRY_NAMES[iso2.toLowerCase()] ?? iso2.toUpperCase()
}

/** Flag emoji for a 2-letter country code, built from Unicode regional
 *  indicator symbols (no lookup table needed). Returns '' for malformed
 *  input so callers can render a plain label without a stray glyph. */
export function flagEmoji(iso2: string): string {
  const cc = iso2.trim().toLowerCase()
  if (!/^[a-z]{2}$/.test(cc)) return ''
  const base = 0x1f1e6 // regional indicator 'A'
  const a = 'a'.charCodeAt(0)
  return String.fromCodePoint(base + (cc.charCodeAt(0) - a), base + (cc.charCodeAt(1) - a))
}

/** Convenience: "🇦🇷 Argentina" (or just the name if no valid flag). */
export function countryLabel(iso2: string): string {
  const flag = flagEmoji(iso2)
  const name = countryName(iso2)
  return flag ? `${flag} ${name}` : name
}
