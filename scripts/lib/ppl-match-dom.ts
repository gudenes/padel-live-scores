// The browser-side half of the PPL match scrape.
//
// `extractMatchDom` runs inside the page via page.evaluate(). It does no
// interpretation whatsoever — it lifts raw strings out of the DOM and hands
// them to ppl-match-parse.ts. Keeping it dumb is deliberate: everything that
// could be wrong about reading this page is then testable against a captured
// fixture, with no browser involved.
//
// Selectors verified against production on 2026-09-23. They are stable BEM
// classes, not positional guesses.
//
// THE TRAP: `waitUntil: 'networkidle'` never fires on these pages. They hold
// an open Firestore Listen long-poll for live updates, so there is never
// 500ms of network silence and the call hangs forever rather than erroring.
// Always `domcontentloaded` plus waitForSelector('.match-h2h-board__set-pill').

export interface RawPlayerCard {
  team: string | null
  slug: string | null
  name: string | null
  /** The card's full innerText, pipe-joined. Parsed downstream. */
  text: string | null
}

export interface RawScoreRow {
  team: string | null
  winner: boolean
  loser: boolean
  players: string[]
  /** Every cell in order. The final one is the W/L marker, flagged by `game`. */
  cells: Array<{ v: string; game: boolean }>
}

export interface RawMatchDom {
  url: string
  duration: string | null
  finalLabel: string | null
  meta: string | null
  setPills: string[]
  statRows: string[]
  scoreRows: RawScoreRow[]
  playerCards: RawPlayerCard[]
}

/**
 * Serialised and run inside the page. Must stay self-contained — it cannot
 * close over anything from this module.
 */
export function extractMatchDom(): RawMatchDom {
  const all = (s: string) => Array.from(document.querySelectorAll(s))
  const t = (el: Element | null | undefined) =>
    el ? (el as HTMLElement).innerText.replace(/\n/g, '|').trim() : null
  const one = (s: string) => document.querySelector(s)

  return {
    url: location.href,
    duration: t(one('.cc-bcast-duration-value')),
    finalLabel: t(one('.cc-bcast-final-label')),
    meta: t(one('.cc-bcast-meta')),
    setPills: all('.match-h2h-board__set-pill').map((e) => (e.textContent || '').trim()),
    statRows: all('.match-h2h-board__stat-row').map((e) => t(e) ?? ''),
    scoreRows: all('.match-detail-scoreboard .cc-bcast-row').map((r) => ({
      team: (r.querySelector('.cc-bcast-team-name')?.textContent || '').trim() || null,
      winner: r.className.includes('--winner'),
      loser: r.className.includes('--loser'),
      players: Array.from(r.querySelectorAll('.cc-bcast-player')).map((x) => (x.textContent || '').trim()),
      cells: Array.from(r.querySelectorAll('.cc-bcast-cell')).map((x) => ({
        v: (x.textContent || '').trim(),
        game: x.className.includes('--game'),
      })),
    })),
    playerCards: all('.player-spotlight__card--match-detail').map((card) => {
      const a = card.querySelector('a[href*="/player/"]')
      const href = a?.getAttribute('href') || ''
      return {
        team: (card.querySelector('.player-spotlight__team')?.textContent || '').trim() || null,
        slug: href ? href.replace(/.*\/player\/([^/]+).*/, '$1') : null,
        name: (card.querySelector('.player-spotlight__name')?.textContent || '').trim() || null,
        text: t(card),
      }
    }),
  }
}
