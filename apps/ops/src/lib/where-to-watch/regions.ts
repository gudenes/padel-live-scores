// Static ISO-3166 region groupings for the Where-to-Watch geo-rules admin.
// Used by the "block a whole region" picker and the rules-table region filter.
// Not exhaustive — a pragmatic set covering the markets we operate in.
// `mx` is intentionally listed under both Latin America and North America for
// the picker; the reverse map (`regionForCountry`) resolves it to Latin America.

export const REGIONS = {
  'Latin America': [
    'ar','bo','br','cl','co','cr','cu','do','ec','gt',
    'hn','mx','ni','pa','pe','pr','py','sv','uy','ve',
  ],
  'Europe': [
    'es','it','fr','de','pt','nl','be','gb','ie','se','no','dk','fi',
    'pl','cz','at','ch','gr','ro','hu','ua','rs','hr','bg','sk',
  ],
  'Middle East & North Africa': [
    'ae','sa','qa','kw','bh','om','jo','lb','il','eg','ma','tn','dz',
  ],
  'Asia & Pacific': [
    'jp','cn','kr','in','id','th','vn','ph','my','sg','au','nz','hk','tw',
  ],
  'North America': ['us','ca','mx'],
  'Africa': ['za','ng','ke','gh','sn','ci','cm','ao','mz','tz'],
} as const

export type RegionName = keyof typeof REGIONS

export const REGION_NAMES = Object.keys(REGIONS) as RegionName[]

export function countriesForRegion(region: RegionName): string[] {
  return [...REGIONS[region]]
}

// Reverse lookup. When a country is in more than one region (e.g. `mx`),
// the FIRST region in declaration order wins as canonical.
const COUNTRY_TO_REGION: Record<string, RegionName> = (() => {
  const map: Record<string, RegionName> = {}
  for (const region of REGION_NAMES) {
    for (const cc of REGIONS[region]) {
      if (!(cc in map)) map[cc] = region
    }
  }
  return map
})()

export function regionForCountry(iso2: string): RegionName | null {
  return COUNTRY_TO_REGION[iso2.toLowerCase()] ?? null
}
