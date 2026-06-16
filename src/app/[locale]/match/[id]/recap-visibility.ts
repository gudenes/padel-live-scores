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

export type MatchDetailTabKey = 'recap' | 'live' | 'players' | 'h2h'

/**
 * Ordered match-detail sub-tab keys. `recap` and `live` are INDEPENDENT: a
 * finished match can show Live Feed without the Score Recap (e.g. a webtuga
 * match whose recap is hidden but whose point-by-point Live Feed stays).
 * Players + H2H always show.
 */
export function matchDetailTabKeys(opts: {
  isFinished: boolean
  isScheduled: boolean
  showRecap: boolean
  showLive: boolean
}): MatchDetailTabKey[] {
  if (opts.isFinished) {
    return [
      ...(opts.showRecap ? (['recap'] as const) : []),
      ...(opts.showLive ? (['live'] as const) : []),
      'players',
      'h2h',
    ]
  }
  if (opts.isScheduled) return ['players', 'h2h']
  // live / on-court / other in-progress states
  return [...(opts.showLive ? (['live'] as const) : []), 'players', 'h2h']
}
