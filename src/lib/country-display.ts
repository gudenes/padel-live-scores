// Shared country display helpers (name + local flag path) for rankings-style rows.

// ── Country code → full name ───────────────────────────────────
const COUNTRY_NAMES: Record<string, string> = {
  ES: 'Spain', AR: 'Argentina', BR: 'Brazil', PT: 'Portugal',
  FR: 'France', IT: 'Italy', BE: 'Belgium', NL: 'Netherlands',
  DE: 'Germany', GB: 'Great Britain', DK: 'Denmark', SE: 'Sweden',
  UY: 'Uruguay', PY: 'Paraguay', CL: 'Chile', MX: 'Mexico',
  US: 'United States', AU: 'Australia', QA: 'Qatar',
  ESP: 'Spain', ARG: 'Argentina', BRA: 'Brazil', POR: 'Portugal',
  FRA: 'France', ITA: 'Italy', BEL: 'Belgium', NLD: 'Netherlands',
  GER: 'Germany', GBR: 'Great Britain', DEN: 'Denmark', SWE: 'Sweden',
  URU: 'Uruguay', PAR: 'Paraguay', CHI: 'Chile', MEX: 'Mexico',
  USA: 'United States', AUS: 'Australia',
}

// ISO-2 mapping for flags (3-letter codes → 2-letter)
const ISO3_TO_2: Record<string, string> = {
  ESP: 'es', ARG: 'ar', BRA: 'br', POR: 'pt', FRA: 'fr', ITA: 'it',
  BEL: 'be', NLD: 'nl', GER: 'de', GBR: 'gb', DEN: 'dk', SWE: 'se',
  URU: 'uy', PAR: 'py', CHI: 'cl', MEX: 'mx', USA: 'us', AUS: 'au',
}

export function countryName(code: string | null): string {
  if (!code) return 'Unknown'
  return COUNTRY_NAMES[code.toUpperCase()] ?? code
}

export function countryFlagUrl(code: string | null): string | null {
  if (!code) return null
  const upper = code.toUpperCase()
  const iso2 = ISO3_TO_2[upper] ?? (upper.length === 2 ? upper.toLowerCase() : null)
  if (!iso2) return null
  return `/flags/${iso2}.png`
}

