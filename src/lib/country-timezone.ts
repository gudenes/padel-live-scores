// src/lib/country-timezone.ts
//
// Static map from ISO 3166-1 alpha-2 country codes to IANA timezone
// identifiers, scoped to the padel circuit. Used as a fallback when
// `tournaments.timezone` is null — common for padelapi-imported rows
// (Premier tour) that the FIP enricher doesn't touch, and for any
// FIP-tier row landing before its hourly enrich pass.
//
// Second consumer (added post-Cloudflare cutover): `request-geo.ts` uses
// the same map to guess a VISITOR's timezone when no edge timezone header
// arrives. That's why the table now covers effectively every ISO code
// rather than just tournament venues — an unmapped country used to mean
// "this visitor sees UTC". The tournament-venue semantics below still
// govern which zone we pick for a multi-timezone country.
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
  BO: 'America/La_Paz',
  BR: 'America/Sao_Paulo',
  CL: 'America/Santiago',
  CO: 'America/Bogota',
  EC: 'America/Guayaquil',
  FK: 'Atlantic/Stanley',
  GF: 'America/Cayenne',
  GY: 'America/Guyana',
  PE: 'America/Lima',
  PY: 'America/Asuncion',
  SR: 'America/Paramaribo',
  UY: 'America/Montevideo',
  VE: 'America/Caracas',

  // North + Central America
  BZ: 'America/Belize',
  CA: 'America/Toronto',
  CR: 'America/Costa_Rica',
  GL: 'America/Nuuk',
  GT: 'America/Guatemala',
  HN: 'America/Tegucigalpa',
  MX: 'America/Mexico_City',
  NI: 'America/Managua',
  PA: 'America/Panama',
  PM: 'America/Miquelon',
  SV: 'America/El_Salvador',
  US: 'America/New_York',

  // Caribbean
  AG: 'America/Antigua',
  AI: 'America/Anguilla',
  AW: 'America/Aruba',
  BB: 'America/Barbados',
  BL: 'America/St_Barthelemy',
  BM: 'Atlantic/Bermuda',
  BQ: 'America/Kralendijk',
  BS: 'America/Nassau',
  CU: 'America/Havana',
  CW: 'America/Curacao',
  DM: 'America/Dominica',
  DO: 'America/Santo_Domingo',
  GD: 'America/Grenada',
  GP: 'America/Guadeloupe',
  HT: 'America/Port-au-Prince',
  JM: 'America/Jamaica',
  KN: 'America/St_Kitts',
  KY: 'America/Cayman',
  LC: 'America/St_Lucia',
  MF: 'America/Marigot',
  MQ: 'America/Martinique',
  MS: 'America/Montserrat',
  PR: 'America/Puerto_Rico',
  SX: 'America/Lower_Princes',
  TC: 'America/Grand_Turk',
  TT: 'America/Port_of_Spain',
  VC: 'America/St_Vincent',
  VG: 'America/Tortola',
  VI: 'America/St_Thomas',

  // Western Europe
  AT: 'Europe/Vienna',
  AX: 'Europe/Mariehamn',
  BE: 'Europe/Brussels',
  CH: 'Europe/Zurich',
  DE: 'Europe/Berlin',
  DK: 'Europe/Copenhagen',
  ES: 'Europe/Madrid',
  FI: 'Europe/Helsinki',
  FO: 'Atlantic/Faroe',
  FR: 'Europe/Paris',
  GB: 'Europe/London',
  GG: 'Europe/Guernsey',
  GI: 'Europe/Gibraltar',
  IE: 'Europe/Dublin',
  IM: 'Europe/Isle_of_Man',
  IS: 'Atlantic/Reykjavik',
  IT: 'Europe/Rome',
  JE: 'Europe/Jersey',
  LU: 'Europe/Luxembourg',
  MT: 'Europe/Malta',
  NL: 'Europe/Amsterdam',
  NO: 'Europe/Oslo',
  PT: 'Europe/Lisbon',
  SE: 'Europe/Stockholm',
  SJ: 'Arctic/Longyearbyen',

  // Eastern Europe + Mediterranean
  AL: 'Europe/Tirane',
  BA: 'Europe/Sarajevo',
  BG: 'Europe/Sofia',
  BY: 'Europe/Minsk',
  CY: 'Asia/Nicosia',
  CZ: 'Europe/Prague',
  EE: 'Europe/Tallinn',
  GR: 'Europe/Athens',
  HR: 'Europe/Zagreb',
  HU: 'Europe/Budapest',
  LT: 'Europe/Vilnius',
  LV: 'Europe/Riga',
  MD: 'Europe/Chisinau',
  ME: 'Europe/Podgorica',
  MK: 'Europe/Skopje',
  PL: 'Europe/Warsaw',
  RO: 'Europe/Bucharest',
  RS: 'Europe/Belgrade',
  RU: 'Europe/Moscow', // multi-tz — Moscow is where the padel scene sits
  SI: 'Europe/Ljubljana',
  SK: 'Europe/Bratislava',
  TR: 'Europe/Istanbul',
  UA: 'Europe/Kyiv',
  XK: 'Europe/Belgrade', // Kosovo — uses CET, sharing tz with Belgrade

  // Middle East
  AE: 'Asia/Dubai',
  BH: 'Asia/Bahrain',
  EG: 'Africa/Cairo',
  IL: 'Asia/Jerusalem',
  IQ: 'Asia/Baghdad',
  IR: 'Asia/Tehran',
  JO: 'Asia/Amman',
  KW: 'Asia/Kuwait',
  LB: 'Asia/Beirut',
  OM: 'Asia/Muscat',
  PS: 'Asia/Hebron',
  QA: 'Asia/Qatar',
  SA: 'Asia/Riyadh',
  SY: 'Asia/Damascus',
  YE: 'Asia/Aden',

  // Caucasus + Central Asia
  AF: 'Asia/Kabul',
  AM: 'Asia/Yerevan',
  AZ: 'Asia/Baku',
  GE: 'Asia/Tbilisi', // Georgia — FIP PROMISES Tbilisi
  KG: 'Asia/Bishkek',
  KZ: 'Asia/Almaty', // multi-tz — Almaty is the largest city
  MN: 'Asia/Ulaanbaatar',
  TJ: 'Asia/Dushanbe',
  TM: 'Asia/Ashgabat',
  UZ: 'Asia/Tashkent',

  // Africa
  AO: 'Africa/Luanda',
  BF: 'Africa/Ouagadougou',
  BI: 'Africa/Bujumbura',
  BJ: 'Africa/Porto-Novo',
  BW: 'Africa/Gaborone',
  CD: 'Africa/Kinshasa', // multi-tz — Kinshasa is the capital
  CF: 'Africa/Bangui',
  CG: 'Africa/Brazzaville',
  CI: 'Africa/Abidjan', // Côte d'Ivoire — UTC+0, no DST. FIP GOLD Abidjan
  CM: 'Africa/Douala',
  CV: 'Atlantic/Cape_Verde',
  DJ: 'Africa/Djibouti',
  DZ: 'Africa/Algiers',
  EH: 'Africa/El_Aaiun',
  ER: 'Africa/Asmara',
  ET: 'Africa/Addis_Ababa',
  GA: 'Africa/Libreville',
  GH: 'Africa/Accra',
  GM: 'Africa/Banjul',
  GN: 'Africa/Conakry',
  GQ: 'Africa/Malabo',
  GW: 'Africa/Bissau',
  KE: 'Africa/Nairobi',
  KM: 'Indian/Comoro',
  LR: 'Africa/Monrovia',
  LS: 'Africa/Maseru',
  LY: 'Africa/Tripoli',
  MA: 'Africa/Casablanca',
  MG: 'Indian/Antananarivo',
  ML: 'Africa/Bamako',
  MR: 'Africa/Nouakchott',
  MU: 'Indian/Mauritius',
  MW: 'Africa/Blantyre',
  MZ: 'Africa/Maputo',
  NA: 'Africa/Windhoek',
  NE: 'Africa/Niamey',
  NG: 'Africa/Lagos',
  RE: 'Indian/Reunion',
  RW: 'Africa/Kigali',
  SC: 'Indian/Mahe',
  SD: 'Africa/Khartoum',
  SH: 'Atlantic/St_Helena',
  SL: 'Africa/Freetown',
  SN: 'Africa/Dakar', // Senegal — FIP BRONZE Dakar
  SO: 'Africa/Mogadishu',
  SS: 'Africa/Juba',
  ST: 'Africa/Sao_Tome',
  SZ: 'Africa/Mbabane',
  TD: 'Africa/Ndjamena',
  TG: 'Africa/Lome',
  TN: 'Africa/Tunis',
  TZ: 'Africa/Dar_es_Salaam',
  UG: 'Africa/Kampala',
  YT: 'Indian/Mayotte',
  ZA: 'Africa/Johannesburg',
  ZM: 'Africa/Lusaka',
  ZW: 'Africa/Harare',

  // Asia
  BD: 'Asia/Dhaka',
  BN: 'Asia/Brunei',
  BT: 'Asia/Thimphu',
  CN: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
  ID: 'Asia/Jakarta', // multi-tz — Jakarta is the capital
  IN: 'Asia/Kolkata',
  JP: 'Asia/Tokyo',
  KH: 'Asia/Phnom_Penh',
  KP: 'Asia/Pyongyang',
  KR: 'Asia/Seoul',
  LA: 'Asia/Vientiane',
  LK: 'Asia/Colombo',
  MM: 'Asia/Yangon',
  MO: 'Asia/Macau',
  MV: 'Indian/Maldives',
  MY: 'Asia/Kuala_Lumpur',
  NP: 'Asia/Kathmandu',
  PH: 'Asia/Manila',
  PK: 'Asia/Karachi',
  SG: 'Asia/Singapore',
  TH: 'Asia/Bangkok',
  TL: 'Asia/Dili',
  TW: 'Asia/Taipei',
  VN: 'Asia/Ho_Chi_Minh',

  // Oceania + Indian Ocean territories
  AS: 'Pacific/Pago_Pago',
  AU: 'Australia/Sydney',
  CC: 'Indian/Cocos',
  CK: 'Pacific/Rarotonga',
  CX: 'Indian/Christmas',
  FJ: 'Pacific/Fiji',
  FM: 'Pacific/Chuuk',
  GU: 'Pacific/Guam',
  IO: 'Indian/Chagos',
  KI: 'Pacific/Tarawa',
  MH: 'Pacific/Majuro',
  MP: 'Pacific/Saipan',
  NC: 'Pacific/Noumea',
  NF: 'Pacific/Norfolk',
  NR: 'Pacific/Nauru',
  NU: 'Pacific/Niue',
  NZ: 'Pacific/Auckland',
  PF: 'Pacific/Tahiti',
  PG: 'Pacific/Port_Moresby',
  PN: 'Pacific/Pitcairn',
  PW: 'Pacific/Palau',
  SB: 'Pacific/Guadalcanal',
  TK: 'Pacific/Fakaofo',
  TO: 'Pacific/Tongatapu',
  TV: 'Pacific/Funafuti',
  VU: 'Pacific/Efate',
  WF: 'Pacific/Wallis',
  WS: 'Pacific/Apia',

  // Tiny European states common on the FIP calendar
  AD: 'Europe/Andorra',
  LI: 'Europe/Vaduz',
  MC: 'Europe/Monaco',
  SM: 'Europe/San_Marino',
  VA: 'Europe/Vatican',
}

/**
 * Returns the IANA timezone for a country code, or null when the code
 * is unknown / null / empty. Case-insensitive on the input.
 */
export function countryToTimezone(country: string | null | undefined): string | null {
  if (!country) return null
  return COUNTRY_TZ[country.toUpperCase()] ?? null
}
