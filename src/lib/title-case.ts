/**
 * Title-case a string: every \b\w+ token gets first-letter capitalized, rest lowercase.
 * "FIP GOLD lisbon" → "Fip Gold Lisbon"
 */
export function titleCase(s: string): string {
  return s.replace(/\b\w+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
}
