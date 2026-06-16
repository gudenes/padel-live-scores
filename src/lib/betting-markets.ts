// Single source of truth for "where is the betting odds unit allowed to appear".
// Adding/removing a launch market is a one-line edit here — no component changes.
//
// A market is LIVE only when enabled:true AND legal + provider coverage have been
// confirmed for that country (see the spec's Compliance Actions). Seed new markets
// as enabled:false ("staged") so copy can land before launch.
//
// disclaimerKey points at country-specific mandated wording under
// `betting.disclaimers.<key>` in src/messages/*.json. These are NOT translations
// of each other — each is the legally prescribed responsible-gambling text for
// that regime, and must be lawyer-approved before the market is enabled.

export interface BettingMarket {
  enabled: boolean
  minAge: number
  disclaimerKey: string
}

export const BETTING_MARKETS: Record<string, BettingMarket> = {
  ES: { enabled: true,  minAge: 18, disclaimerKey: 'es' }, // Spain — DGOJ
  CO: { enabled: false, minAge: 18, disclaimerKey: 'co' }, // Colombia — Coljuegos
  MX: { enabled: false, minAge: 18, disclaimerKey: 'mx' }, // Mexico — SEGOB
  PE: { enabled: false, minAge: 18, disclaimerKey: 'pe' }, // Peru
  CL: { enabled: false, minAge: 18, disclaimerKey: 'cl' }, // Chile
  BR: { enabled: false, minAge: 18, disclaimerKey: 'br' }, // Brazil — federal
}

/**
 * Returns the market config for an ISO alpha-2 country, but ONLY when that
 * market is enabled. Disabled/unknown/nullish → null. Case-insensitive.
 */
export function getBettingMarket(country: string | null | undefined): BettingMarket | null {
  if (!country) return null
  const m = BETTING_MARKETS[country.toUpperCase()]
  return m && m.enabled ? m : null
}

export function isBettingMarket(country: string | null | undefined): boolean {
  return getBettingMarket(country) !== null
}
