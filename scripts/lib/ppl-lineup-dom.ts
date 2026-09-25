// The browser-side half of the Pro Padel League line-up scrape.
//
// Runs inside the page via page.evaluate(). Lifts raw strings only —
// everything that could be wrong about INTERPRETING them lives in
// ppl-lineup-parse.ts, which is testable without a browser.
//
// Selectors verified against the live Playa del Carmen schedule page on
// 2026-09-24.
//
// THE TRAP, and it is a quiet one: a `.cc-upcoming-match` contains exactly
// ONE `.cc-live-match__row`, and that single row holds BOTH franchises as two
// `.cc-live-match__team` children. Iterating rows therefore yields one
// element per match and only the home side — a scrape that looks like it is
// working right up until you notice every away pairing is missing. Iterate
// TEAMS, not rows.
//
// Same long-poll caveat as the other PPL pages: `waitUntil: 'networkidle'`
// never fires, so use `domcontentloaded` plus
// waitForSelector('.cc-live-match__team').

export interface RawLineupSideDom {
  rank: string
  team: string
  players: string[]
}

export interface RawLineupCourtDom {
  stage: string
  label: string
  gender: string
  sides: RawLineupSideDom[]
}

export function extractLineupDom(): RawLineupCourtDom[] {
  const txt = (el: Element | null | undefined): string =>
    ((el as HTMLElement | null)?.innerText ?? el?.textContent ?? '').trim()

  const out: RawLineupCourtDom[] = []

  for (const session of Array.from(document.querySelectorAll('.session'))) {
    const stage = txt(session.querySelector('.session__eyebrow'))

    for (const group of Array.from(session.querySelectorAll('.matchgroup'))) {
      // Upstream's own tie label ("MATCHUP #1"). It is the join key back to
      // our league_ties rows for this session.
      const label = txt(group.querySelector('.matchgroup__lbl-title'))

      for (const card of Array.from(group.querySelectorAll('.cc-upcoming-match'))) {
        const gender = txt(card.querySelector('.cc-upcoming-match__badge-gender'))

        const sides: RawLineupSideDom[] = Array.from(
          card.querySelectorAll('.cc-live-match__team'),
        ).map((team) => ({
          rank: txt(team.querySelector('.cc-match-team-rank')),
          team: txt(team.querySelector('.cc-live-match__team-name')),
          players: Array.from(
            team.querySelector('.cc-live-match__players')?.querySelectorAll('span') ?? [],
          ).map((s) => txt(s)).filter(Boolean),
        }))

        out.push({ stage, label, gender, sides })
      }
    }
  }

  return out
}
