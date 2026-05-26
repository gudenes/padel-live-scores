// apps/ops/src/lib/seo/digest-rules.ts
// Pure rule engine for the "Worth a look" bullets in the daily digest.
// Each rule returns either a string (fires) or null (no bullet today).

export interface DigestSignals {
  totalDirection: 'up' | 'down' | 'flat'
  localeDeltas: Record<'en' | 'es' | 'pt' | 'it' | 'fr', number>
  newLocaleGapCount: number      // # of new locale-gap rows vs yesterday
  sitemapSizeDeltaPct: number    // signed pct change in sitemap URL count
}

type Rule = (s: DigestSignals) => string | null

const ruleLocaleOpposite: Rule = (s) => {
  if (s.totalDirection === 'flat') return null
  const opposites: string[] = []
  for (const [locale, delta] of Object.entries(s.localeDeltas)) {
    const dir = delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat'
    if (
      (s.totalDirection === 'up'   && dir === 'down') ||
      (s.totalDirection === 'down' && dir === 'up')
    ) {
      opposites.push(`${locale} is ${dir} ${Math.abs(delta)}% week-on-week while overall is ${s.totalDirection}`)
    }
  }
  return opposites.length > 0 ? opposites.join('; ') : null
}

const ruleNewLocaleGaps: Rule = (s) =>
  s.newLocaleGapCount >= 5
    ? `${s.newLocaleGapCount} new locale-gap pages flagged today`
    : null

const ruleSitemapShift: Rule = (s) => {
  if (Math.abs(s.sitemapSizeDeltaPct) <= 20) return null
  const verb = s.sitemapSizeDeltaPct > 0 ? 'grew' : 'shrank'
  return `Sitemap ${verb} by ${Math.abs(s.sitemapSizeDeltaPct)}% today — check the deploy`
}

const ALL_RULES: Rule[] = [ruleLocaleOpposite, ruleNewLocaleGaps, ruleSitemapShift]

export function computeBullets(s: DigestSignals): string[] {
  const fired = ALL_RULES.map(r => r(s)).filter((x): x is string => !!x)
  if (fired.length === 0) return ['Nothing flagged today — all metrics within normal bands.']
  return fired
}
