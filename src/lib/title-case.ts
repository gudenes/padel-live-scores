// Tournament-name casing.
//
// Extracted from components/home/shared.tsx so it can be tested: that file
// imports next-intl navigation, which pulls Next's router into any test that
// touches it. The function itself is pure and was only ever there by
// accident of where it was first needed.
//
// It re-cases EVERY tournament name in the app and lowercases anything it
// does not recognise, so an unlisted acronym is rendered as a typo — that is
// how "Los Angeles PPL II" reached the Events tab as "Los Angeles Ppl II".

const KEEP_UPPER = new Set(['FIP', 'P1', 'P2', 'WPT', 'APT', 'A1', 'BNL', 'PPL'])
// Roman numerals must survive title-casing — FIP names events like
// "XX MEDITERRANEAN GAMES", and "Xx Mediterranean Games" reads as a typo.
// Enumerating II/III/IV (the old approach) missed everything else, so match
// the grammar instead. Deliberately strict, and deliberately without M/D, so
// ordinary words built from numeral letters aren't shouted: LIVE, CIVIL and
// MIX are all rejected; I, IV, IX, VIII and XX match.
const ROMAN_NUMERAL = /^C{0,3}(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/
export function titleCase(name: string): string {
  return name.split(' ').map(word => {
    const upper = word.toUpperCase()
    if (KEEP_UPPER.has(upper)) return upper
    if (upper.length > 0 && ROMAN_NUMERAL.test(upper)) return upper
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}
