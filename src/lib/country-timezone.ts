// src/lib/country-timezone.ts
//
// Static map from ISO 3166-1 alpha-2 country codes to IANA timezone
// identifiers, scoped to the padel circuit. Used as a fallback when
// `tournaments.timezone` is null — common for padelapi-imported rows
// (Premier tour) that the FIP enricher doesn't touch, and for any
// FIP-tier row landing before its hourly enrich pass.
//
// For multi-timezone countries (US, BR, RU, AU, CA, MX, KZ) the value
// is the timezone for the city where padel tournaments most plausibly
// run — east coast for the US (Miami / NYC), São Paulo for Brazil, etc.
// If a future tournament lands in a different region within a multi-tz
// country, the canonical fix is to populate `tournaments.timezone`
// upstream rather than expand this table.

const COUNTRY_TZ: Record<string, string> = {
  // South America
  AR: 'America/Argentina/Buenos_Aires',
  BR: 'America/Sao_Paulo',
  CL: 'America/Santiago',
  CO: 'America/Bogota',
  EC: 'America/Guayaquil',
  PE: 'America/Lima',
  PY: 'America/Asuncion',
  UY: 'America/Montevideo',
  VE: 'America/Caracas',

  // North + Central America
  CA: 'America/Toronto',
  CR: 'America/Costa_Rica',
  DO: 'America/Santo_Domingo',
  GT: 'America/Guatemala',
  MX: 'America/Mexico_City',
  PA: 'America/Panama',
  US: 'America/New_York',

  // Western Europe
  AT: 'Europe/Vienna',
  BE: 'Europe/Brussels',
  CH: 'Europe/Zurich',
  DE: 'Europe/Berlin',
  DK: 'Europe/Copenhagen',
  ES: 'Europe/Madrid',
  FI: 'Europe/Helsinki',
  FR: 'Europe/Paris',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  IS: 'Atlantic/Reykjavik',
  IT: 'Europe/Rome',
  LU: 'Europe/Luxembourg',
  MT: 'Europe/Malta',
  NL: 'Europe/Amsterdam',
  NO: 'Europe/Oslo',
  PT: 'Europe/Lisbon',
  SE: 'Europe/Stockholm',

  // Eastern Europe + Mediterranean
  AL: 'Europe/Tirane',
  BG: 'Europe/Sofia',
  CY: 'Asia/Nicosia',
  CZ: 'Europe/Prague',
  GR: 'Europe/Athens',
  HR: 'Europe/Zagreb',
  HU: 'Europe/Budapest',
  PL: 'Europe/Warsaw',
  RO: 'Europe/Bucharest',
  RS: 'Europe/Belgrade',
  SI: 'Europe/Ljubljana',
  SK: 'Europe/Bratislava',
  TR: 'Europe/Istanbul',
  UA: 'Europe/Kyiv',
  XK: 'Europe/Belgrade', // Kosovo — uses CET, sharing tz with Belgrade

  // Middle East
  AE: 'Asia/Dubai',
  BH: 'Asia/Bahrain',
  EG: 'Africa/Cairo',
  GE: 'Asia/Tbilisi', // Georgia — FIP PROMISES Tbilisi
  IL: 'Asia/Jerusalem',
  JO: 'Asia/Amman',
  KW: 'Asia/Kuwait',
  LB: 'Asia/Beirut',
  QA: 'Asia/Qatar',
  SA: 'Asia/Riyadh',

  // Africa
  CI: 'Africa/Abidjan', // Côte d'Ivoire — UTC+0, no DST. FIP GOLD Abidjan
  MA: 'Africa/Casablanca',
  SN: 'Africa/Dakar', // Senegal — FIP BRONZE Dakar
  TN: 'Africa/Tunis',
  ZA: 'Africa/Johannesburg',

  // Asia + Oceania
  AU: 'Australia/Sydney',
  CN: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
  ID: 'Asia/Jakarta',
  IN: 'Asia/Kolkata',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  MY: 'Asia/Kuala_Lumpur',
  NZ: 'Pacific/Auckland',
  PH: 'Asia/Manila',
  SG: 'Asia/Singapore',
  TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh',

  // Tiny European states common on the FIP calendar
  AD: 'Europe/Andorra',
  MC: 'Europe/Monaco',
  SM: 'Europe/San_Marino',
}

/**
 * Returns the IANA timezone for a country code, or null when the code
 * is unknown / null / empty. Case-insensitive on the input.
 */
export function countryToTimezone(country: string | null | undefined): string | null {
  if (!country) return null
  return COUNTRY_TZ[country.toUpperCase()] ?? null
}
