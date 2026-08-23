/**
 * Title-case a string with preservation of acronym tokens.
 * "FIP GOLD lisbon" → "FIP Gold Lisbon"
 */
const KEEP_UPPER = new Set(['FIP', 'P1', 'P2', 'WPT', 'APT', 'A1', 'BNL'])
// Roman numerals must survive title-casing — FIP names events like
// "XX MEDITERRANEAN GAMES", and "Xx Mediterranean Games" reads as a typo.
// Enumerating II/III/IV (the old approach) missed everything else, so match
// the grammar instead. Deliberately strict, and deliberately without M/D, so
// ordinary words built from numeral letters aren't shouted: LIVE, CIVIL and
// MIX are all rejected; I, IV, IX, VIII and XX match.
const ROMAN_NUMERAL = /^C{0,3}(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/

export function titleCase(s: string): string {
  return s.split(' ').map(word => {
    const upper = word.toUpperCase()
    if (KEEP_UPPER.has(upper)) return upper
    if (upper.length > 0 && ROMAN_NUMERAL.test(upper)) return upper
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}
