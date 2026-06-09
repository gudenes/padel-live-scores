// ISO-3166 alpha-2 → English country name, plus a flag-emoji helper.
// Names come from the platform's built-in `Intl.DisplayNames` (full ICU data
// ships with modern Node + every evergreen browser), so EVERY valid country
// code resolves — no hand-maintained list to fall out of date.
// Shared by the ops "Availability by Country" admin. Mirrored byte-for-byte
// into apps/ops/src/lib/where-to-watch/iso2-names.ts (apps/ops is a separate
// package with its own path alias).

// A few short, friendlier labels where the CLDR canonical name is long.
const NAME_OVERRIDES: Record<string, string> = {
  us: 'United States',
  gb: 'United Kingdom',
  ae: 'United Arab Emirates',
}

let _display: Intl.DisplayNames | null | undefined
function regionDisplay(): Intl.DisplayNames | null {
  if (_display !== undefined) return _display
  try {
    _display = new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    _display = null // environment without ICU region data
  }
  return _display
}

/** Friendly country name for an ISO-3166 alpha-2 code. Falls back to the
 *  uppercased code when the code is malformed or unknown so the UI never
 *  renders blank or a misleading "Unknown Region" label. */
export function countryName(iso2: string): string {
  const cc = iso2.trim().toLowerCase()
  if (!/^[a-z]{2}$/.test(cc)) return iso2.trim().toUpperCase()
  if (NAME_OVERRIDES[cc]) return NAME_OVERRIDES[cc]
  const upper = cc.toUpperCase()
  try {
    const name = regionDisplay()?.of(upper)
    // Intl returns the input code for unknown regions, and "Unknown Region"
    // for the reserved placeholders (zz, qo, …) — treat both as "no name".
    if (name && name !== upper && !/unknown/i.test(name)) return name
  } catch {
    // RangeError on a structurally-invalid code — fall through.
  }
  return upper
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
