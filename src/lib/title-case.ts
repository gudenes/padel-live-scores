/**
 * Title-case a string with preservation of acronym tokens.
 * "FIP GOLD lisbon" → "FIP Gold Lisbon"
 */
const KEEP_UPPER = new Set(['FIP', 'P1', 'P2', 'WPT', 'APT', 'A1', 'II', 'III', 'IV', 'BNL'])

export function titleCase(s: string): string {
  return s.split(' ').map(word => {
    if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase()
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}
