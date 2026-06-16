// Pure decisions for the match-detail Score Recap tab. The Score Recap shows
// Crionet stats (or a breaks-only fallback). For webtuga-sourced matches the
// breaks are computed from a best-effort point log, so we hide the recap
// entirely — see docs/superpowers/specs/2026-06-16-hide-score-recap-webtuga-design.md.

export function shouldShowRecap(opts: {
  isPremier: boolean
  hasBreaks: boolean
  webtugaSourced: boolean
}): boolean {
  if (opts.webtugaSourced) return false
  return opts.isPremier || opts.hasBreaks
}

/** The tab a finished match should land on by default. */
export function defaultFinishedTab(opts: {
  isPremier: boolean
  webtugaSourced: boolean
}): 'recap' | 'players' {
  return opts.isPremier && !opts.webtugaSourced ? 'recap' : 'players'
}
