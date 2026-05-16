// Pure structural builder for the sr-only "where to watch" sentence.
// Groups broadcasters by name, sorts by country coverage, applies caps,
// and returns data the layout passes to next-intl's translator.

const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom',
  us: 'United States', ar: 'Argentina', mx: 'Mexico', br: 'Brazil',
  pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', se: 'Sweden', no: 'Norway',
  dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  ie: 'Ireland', gr: 'Greece', tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia',
  ae: 'UAE', qa: 'Qatar', eg: 'Egypt', ma: 'Morocco', za: 'South Africa',
  jp: 'Japan', kr: 'South Korea', cn: 'China', in: 'India', au: 'Australia',
}

export interface BroadcasterForSummary {
  name: string
  country_iso2: string
}

export interface NamedBroadcaster {
  name: string
  countriesShown: string[]
  extraCountryCount: number
}

export interface SeoSummaryData {
  named: NamedBroadcaster[]
  remainingCount: number
}

export interface BuildSeoSummaryInput {
  broadcasters: BroadcasterForSummary[]
  maxNamedBroadcasters?: number
  maxCountriesPerBroadcaster?: number
}

function countryName(iso2: string): string {
  return ISO2_TO_NAME[iso2.toLowerCase()] ?? iso2.toUpperCase()
}

export function buildSeoSummary(input: BuildSeoSummaryInput): SeoSummaryData {
  const {
    broadcasters,
    maxNamedBroadcasters = 5,
    maxCountriesPerBroadcaster = 4,
  } = input

  // Group by broadcaster name preserving first-seen country order.
  const byName = new Map<string, string[]>()
  for (const b of broadcasters) {
    const arr = byName.get(b.name) ?? []
    const country = countryName(b.country_iso2)
    if (!arr.includes(country)) arr.push(country)
    byName.set(b.name, arr)
  }

  // Sort broadcasters by descending country count, then by name for stability.
  const sortedNames = [...byName.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length
    return a[0].localeCompare(b[0])
  })

  const named: NamedBroadcaster[] = sortedNames
    .slice(0, maxNamedBroadcasters)
    .map(([name, countries]) => ({
      name,
      countriesShown: countries.slice(0, maxCountriesPerBroadcaster),
      extraCountryCount: Math.max(0, countries.length - maxCountriesPerBroadcaster),
    }))

  const remainingCount = Math.max(0, sortedNames.length - maxNamedBroadcasters)

  return { named, remainingCount }
}
