// The browser-side half of the PPL standings scrape.
//
// Runs inside the page via page.evaluate(). Like extractMatchDom, it does no
// interpretation — it lifts raw strings and hands them to
// ppl-standings-parse.ts, so every judgement about what a cell MEANS is
// testable against a fixture with no browser involved.
//
// The standings table is not in the static _next/data payload. That endpoint
// returns ~276 bytes of CMS scaffolding; the table itself is fetched from
// Firestore at runtime and exists only in the rendered DOM. Measured, not
// assumed — a plain fetch was tried first.
//
// Selectors verified against production on 2026-09-23: `.standings-table__table`
// with a thead/tbody, and a team link at `a[href*="/league/team/"]` whose
// last path segment is the slug we store as teams.external_id.
//
// THE TRAP, same as the match pages: `waitUntil: 'networkidle'` never fires.
// These pages hold an open Firestore long-poll, so there is never 500ms of
// network silence and the call hangs rather than erroring. Use
// `domcontentloaded` plus waitForSelector('.standings-table__table tbody tr').

export interface RawStandingsRow {
  slug: string | null
  cells: Record<string, string>
}

export interface RawStandingsDom {
  headers: string[]
  rows: RawStandingsRow[]
}

export function extractStandingsDom(): RawStandingsDom {
  const table = document.querySelector('.standings-table__table')
  if (!table) return { headers: [], rows: [] }

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
    norm((th as HTMLElement).innerText ?? th.textContent ?? ''),
  )

  const rows: RawStandingsRow[] = []
  for (const tr of Array.from(table.querySelectorAll('tbody tr'))) {
    const tds = Array.from(tr.querySelectorAll('td'))
    const link = tr.querySelector('a[href*="/league/team/"]')
    const href = link?.getAttribute('href') ?? ''
    const slug = href.split('/').filter(Boolean).pop() ?? null

    const cells: Record<string, string> = {}
    headers.forEach((h, i) => {
      const td = tds[i]
      if (!td) return
      // innerText, not textContent: the rank cell stacks "1 / GS 1 / 1ST" on
      // separate lines, and textContent would run them together as "1GS 11ST"
      // with no separator to split on.
      cells[h] = ((td as HTMLElement).innerText ?? td.textContent ?? '').trim()
    })

    rows.push({ slug, cells })
  }

  return { headers, rows }
}
